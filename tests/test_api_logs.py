"""GET /logs 端点测试。"""

from __future__ import annotations

import json
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def log_file_dir(tmp_path: Path) -> Path:
    """创建包含示例日志文件的临时目录。"""
    log_dir = tmp_path / "test_profile"
    log_dir.mkdir()
    log_path = log_dir / "glasscortex.log"

    entries = [
        {"ts": "2026-06-23T10:00:00", "level": "INFO", "logger": "t.m", "msg": "msg1"},
        {"ts": "2026-06-23T10:00:01", "level": "DEBUG", "logger": "t.d", "msg": "dbg"},
        {"ts": "2026-06-23T10:00:02", "level": "WARNING", "logger": "t.w", "msg": "warn"},
        {"ts": "2026-06-23T10:00:03", "level": "ERROR", "logger": "t.e", "msg": "err"},
        {"ts": "2026-06-23T10:00:04", "level": "INFO", "logger": "t.m", "msg": "msg2"},
        {"ts": "2026-06-23T10:00:05", "level": "CRITICAL", "logger": "t.c", "msg": "fatal"},
    ]
    key_map = {"ts": "timestamp", "logger": "logger", "level": "level", "msg": "message"}
    with open(log_path, "w", encoding="utf-8") as f:
        for entry in entries:
            mapped = {key_map.get(k, k): v for k, v in entry.items()}
            f.write(json.dumps(mapped, ensure_ascii=False) + "\n")
        f.write("not valid json\n")

    return log_dir


@pytest.fixture
def client_with_logs(
    log_file_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient]:
    """创建 TestClient，用临时目录覆盖全局 settings。"""
    from src.config import Settings

    test_settings = Settings.from_flat(data_dir=log_file_dir.parent, user_profile="test_profile")
    monkeypatch.setattr("src.config.settings", test_settings)

    from api.main import app

    with TestClient(app) as client:
        yield client


class TestLogsEndpoint:
    """GET /logs 端点集成测试。"""

    def test_returns_all_entries(self, client_with_logs: TestClient) -> None:
        """默认参数应返回所有有效条目（畸形行被标记为 PARSE_ERROR）。"""
        resp = client_with_logs.get("/logs", params={"tail_n": 10})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_lines"] == 7  # 6 valid + 1 malformed
        assert len(data["entries"]) == 7

    def test_pagination(self, client_with_logs: TestClient) -> None:
        """分页参数应正确切分结果。"""
        resp = client_with_logs.get("/logs", params={"tail_n": 10, "page_size": 3, "page": 1})
        assert resp.status_code == 200
        assert len(resp.json()["entries"]) == 3

        resp2 = client_with_logs.get("/logs", params={"tail_n": 10, "page_size": 3, "page": 2})
        assert len(resp2.json()["entries"]) == 3

    def test_level_filter(self, client_with_logs: TestClient) -> None:
        """level 筛选应只返回匹配级别的条目。"""
        resp = client_with_logs.get("/logs", params={"tail_n": 10, "level": "ERROR"})
        assert resp.status_code == 200
        entries = resp.json()["entries"]
        assert all(e["level"] == "ERROR" for e in entries)
        assert len(entries) == 1

    def test_keyword_filter(self, client_with_logs: TestClient) -> None:
        """keyword 搜索应在消息和 logger 中匹配。"""
        resp = client_with_logs.get("/logs", params={"tail_n": 10, "keyword": "warn"})
        assert resp.status_code == 200
        entries = resp.json()["entries"]
        assert len(entries) == 1
        assert "warn" in entries[0]["message"]

    def test_malformed_json_handled(self, client_with_logs: TestClient) -> None:
        """畸形 JSON 行应标记为 PARSE_ERROR 而非崩溃。"""
        resp = client_with_logs.get("/logs", params={"tail_n": 10})
        entries = resp.json()["entries"]
        parse_errors = [e for e in entries if e["level"] == "PARSE_ERROR"]
        assert len(parse_errors) == 1

    def test_missing_log_file_returns_empty(
        self,
        client_with_logs: TestClient,
    ) -> None:
        """日志文件不存在时返回空结果而非 500。"""
        from src.config import Settings

        client_with_logs.app.state.settings = Settings.from_flat(  # type: ignore[attr-defined]
            data_dir=Path("/nonexistent"),
            user_profile="ghost",
        )
        resp = client_with_logs.get("/logs")
        assert resp.status_code == 200
        assert resp.json()["entries"] == []

    def test_file_size_reported(self, client_with_logs: TestClient) -> None:
        """响应应包含文件大小。"""
        resp = client_with_logs.get("/logs", params={"tail_n": 10})
        assert resp.json()["file_size_bytes"] > 0

    def test_level_validation_rejects_invalid(
        self,
        client_with_logs: TestClient,
    ) -> None:
        """无效 level 值应返回 422。"""
        resp = client_with_logs.get("/logs", params={"level": "INVALID"})
        assert resp.status_code == 422


class TestLogDetailEndpoint:
    """GET /logs/{id} 单条日志详情端点测试。"""

    def test_returns_single_entry(self, client_with_logs: TestClient) -> None:
        """按行号获取单条日志应返回完整详情。"""
        resp = client_with_logs.get("/logs/1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == 1
        assert data["message"] == "msg1"
        assert data["level"] == "INFO"
        assert "raw" in data
        assert data["total_lines"] == 7

    def test_prev_next_navigation(self, client_with_logs: TestClient) -> None:
        """首条日志 prev_id 为 None，next_id 为 2。"""
        resp = client_with_logs.get("/logs/1")
        data = resp.json()
        assert data["prev_id"] is None
        assert data["next_id"] == 2

    def test_last_entry_next_id_none(self, client_with_logs: TestClient) -> None:
        """末条日志 next_id 为 None。"""
        resp = client_with_logs.get("/logs/7")  # 第 7 行是畸形行
        data = resp.json()
        assert data["next_id"] is None
        assert data["prev_id"] == 6

    def test_malformed_json_returns_parse_error(self, client_with_logs: TestClient) -> None:
        """畸形 JSON 行返回 PARSE_ERROR 级别而非 500。"""
        resp = client_with_logs.get("/logs/7")
        assert resp.status_code == 200
        data = resp.json()
        assert data["level"] == "PARSE_ERROR"

    def test_out_of_range_returns_404(self, client_with_logs: TestClient) -> None:
        """行号超出范围应返回 404。"""
        resp = client_with_logs.get("/logs/999")
        assert resp.status_code == 404

    def test_zero_id_returns_404(self, client_with_logs: TestClient) -> None:
        """行号 0 应返回 404（1-indexed）。"""
        resp = client_with_logs.get("/logs/0")
        assert resp.status_code == 404

    def test_entry_has_id_in_list(self, client_with_logs: TestClient) -> None:
        """列表端点返回的条目应包含 id 字段。"""
        resp = client_with_logs.get("/logs", params={"tail_n": 10})
        entries = resp.json()["entries"]
        assert len(entries) > 0
        for entry in entries:
            assert "id" in entry
            assert isinstance(entry["id"], int)
            assert entry["id"] >= 1

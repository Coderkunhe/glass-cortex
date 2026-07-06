"""测试 src/health.py — 主动健康检查。"""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np

from src.config import Settings
from src.health import check_health


class MockStore:
    def __init__(self) -> None:
        self._execute = MagicMock()


class MockIndex:
    def __init__(self, ntotal: int = 42, dim: int = 384) -> None:
        self.index = MagicMock()
        self.index.ntotal = ntotal
        self.index.d = dim


class MockChatEngine:
    def __init__(self, has_client: bool = True, has_key: bool = True) -> None:
        self._client: MagicMock | None = None
        if has_client:
            self._client = MagicMock()
            self._client.api_key = "sk-test-key" if has_key else "未设置"
        elif not has_client:
            # _client is None → client property raises RuntimeError
            self._client = None

    @property
    def client(self) -> MagicMock:
        if self._client is None:
            raise RuntimeError("DEEPSEEK_API_KEY 未设置")
        return self._client


def _mock_embed(texts: list[str]) -> np.ndarray:
    return np.random.randn(len(texts), 384).astype(np.float32)


class TestCheckHealth:
    """验证健康检查报告结构。"""

    def test_all_checks_return_required_keys(self) -> None:
        store = MockStore()
        idx = MockIndex()
        chat = MockChatEngine()
        settings = Settings()

        results = check_health(store, idx, chat, settings, embed_fn=_mock_embed)

        expected_checks = {"database", "faiss_index", "llm_api", "disk_space", "embedding_model"}
        assert set(results.keys()) == expected_checks
        for name, result in results.items():
            assert "status" in result, f"{name} missing status"
            assert result["status"] in ("ok", "warn", "error"), f"{name} bad status"
            assert "latency_ms" in result, f"{name} missing latency_ms"
            assert "detail" in result, f"{name} missing detail"

    def test_database_ok(self) -> None:
        results = check_health(MockStore(), MockIndex(), MockChatEngine(), Settings())
        assert results["database"]["status"] == "ok"

    def test_database_error(self) -> None:
        store = MockStore()
        store._execute.side_effect = sqlite3.Error("DB locked")
        results = check_health(store, MockIndex(), MockChatEngine(), Settings())
        assert results["database"]["status"] == "error"
        assert "DB locked" in results["database"]["detail"]

    def test_faiss_ok(self) -> None:
        results = check_health(MockStore(), MockIndex(ntotal=42), MockChatEngine(), Settings())
        assert results["faiss_index"]["status"] == "ok"
        assert "42" in results["faiss_index"]["detail"]

    def test_faiss_warn_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            s = Settings.from_flat(data_dir=Path(tmpdir), user_profile="empty-test")
            results = check_health(MockStore(), MockIndex(ntotal=0), MockChatEngine(), s)
            assert results["faiss_index"]["status"] == "warn"

    def test_llm_api_ok(self) -> None:
        results = check_health(MockStore(), MockIndex(), MockChatEngine(has_key=True), Settings())
        assert results["llm_api"]["status"] == "ok"

    def test_llm_api_warn_no_key(self) -> None:
        results = check_health(MockStore(), MockIndex(), MockChatEngine(has_key=False), Settings())
        assert results["llm_api"]["status"] == "warn"

    def test_llm_api_warn_no_client(self) -> None:
        results = check_health(
            MockStore(), MockIndex(), MockChatEngine(has_client=False), Settings()
        )
        assert results["llm_api"]["status"] == "warn"

    def test_embedding_ok(self) -> None:
        results = check_health(
            MockStore(), MockIndex(), MockChatEngine(), Settings(), embed_fn=_mock_embed
        )
        assert results["embedding_model"]["status"] == "ok"

    def test_embedding_warn_no_fn(self) -> None:
        results = check_health(MockStore(), MockIndex(), MockChatEngine(), Settings())
        assert results["embedding_model"]["status"] == "warn"
        assert "跳过" in results["embedding_model"]["detail"]

    def test_embedding_error(self) -> None:
        def bad_embed(texts: list[str]) -> np.ndarray:
            raise RuntimeError("model not loaded")

        results = check_health(
            MockStore(), MockIndex(), MockChatEngine(), Settings(), embed_fn=bad_embed
        )
        assert results["embedding_model"]["status"] == "error"

    def test_disk_space_ok(self) -> None:
        results = check_health(MockStore(), MockIndex(), MockChatEngine(), Settings())
        # Disk space check uses real shutil.disk_usage — should be ok on any dev machine
        assert results["disk_space"]["status"] in ("ok", "warn")

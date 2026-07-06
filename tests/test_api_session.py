"""API 测试 — POST /session/reset 一键重置端点 (Batch 162)
+ POST /session/forget 定向遗忘 (Phase 66 B21)。"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from api.main import app
from api.schemas import SessionForgetResponse, WipeResponse
from src.bootstrap import EngineBundle

# ── Helpers ─────────────────────────────────────────────────────────────


def _mock_engines_tuple() -> EngineBundle:
    """构建 mock 7 引擎具名元组。"""
    store = MagicMock()
    store.close.return_value = None
    return EngineBundle(
        store,
        MagicMock(),
        MagicMock(),
        MagicMock(),
        MagicMock(),
        MagicMock(),
        MagicMock(),
    )


@contextmanager
def reset_client() -> Generator[TestClient]:
    """创建 TestClient，所有引擎和后端操作均 mock。

    打补丁 src.bootstrap 的 init_engines / wipe_profile_data，
    避免触碰真实文件系统和 SQLite。
    """
    mock_engines = _mock_engines_tuple()

    app.state.engines = mock_engines
    app.state.settings = MagicMock(user_profile="test_reset")

    with (
        patch("src.bootstrap.init_engines", return_value=mock_engines),
        patch("src.bootstrap.wipe_profile_data", return_value=None),
    ):
        yield TestClient(app)


@contextmanager
def forget_client() -> Generator[TestClient]:
    """创建 TestClient，forgetting engine 的 forget_session 已 mock。"""
    mock_engines = _mock_engines_tuple()
    forgetting = mock_engines.forgetting
    forgetting.forget_session.return_value = {  # type: ignore[attr-defined]
        "episodes_deleted": 3,
        "facts_deleted": 5,
        "faiss_vectors_removed": 2,
        "session_id": "test-session",
    }

    app.state.engines = mock_engines
    app.state.settings = MagicMock(user_profile="test_forget")
    yield TestClient(app)


# ── Tests ───────────────────────────────────────────────────────────────


class TestSessionResetEndpoint:
    """POST /session/reset 端点——Batch 162 一键重置。"""

    def test_reset_returns_wipe_response(self) -> None:
        """reset 返回 200 + WipeResponse 结构。"""
        with reset_client() as client:
            resp = client.post("/session/reset")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "wiped"
            assert "profile" in data
            assert "detail" in data

    def test_reset_closes_store_before_wipe(self) -> None:
        """reset 应在清空文件前关闭 store 连接。"""
        mock_engines = _mock_engines_tuple()
        store = mock_engines.store

        app.state.engines = mock_engines
        app.state.settings = MagicMock(user_profile="test_reset")

        with (
            patch("src.bootstrap.init_engines", return_value=mock_engines),
            patch("src.bootstrap.wipe_profile_data", return_value=None),
        ):
            client = TestClient(app)
            resp = client.post("/session/reset")
            assert resp.status_code == 200
            store.close.assert_called_once()  # type: ignore[attr-defined]

    def test_reset_idempotent(self) -> None:
        """连续两次 reset 均返回 200，不抛异常。"""
        with reset_client() as client:
            r1 = client.post("/session/reset")
            r2 = client.post("/session/reset")
            assert r1.status_code == 200
            assert r2.status_code == 200

    def test_reset_response_matches_schema(self) -> None:
        """reset 响应可被 WipeResponse Pydantic 模型校验。"""
        with reset_client() as client:
            resp = client.post("/session/reset")
            model = WipeResponse(**resp.json())
            assert model.status == "wiped"
            assert isinstance(model.profile, str)
            assert len(model.detail) > 0


# ── Phase 66 B21: POST /session/forget ───────────────────────────────


class TestSessionForgetEndpoint:
    """POST /session/forget —— 按 session_id 定向遗忘。"""

    def test_forget_returns_200_with_stats(self) -> None:
        """forget 返回 200 + SessionForgetResponse 结构。"""
        with forget_client() as client:
            resp = client.post("/session/forget", json={"session_id": "test-session"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["episodes_deleted"] == 3
            assert data["facts_deleted"] == 5
            assert data["faiss_vectors_removed"] == 2
            assert data["session_id"] == "test-session"

    def test_forget_response_matches_schema(self) -> None:
        """forget 响应可被 SessionForgetResponse Pydantic 模型校验。"""
        with forget_client() as client:
            resp = client.post("/session/forget", json={"session_id": "test-session"})
            model = SessionForgetResponse(**resp.json())
            assert model.episodes_deleted == 3
            assert model.facts_deleted == 5
            assert model.faiss_vectors_removed == 2
            assert model.session_id == "test-session"

    def test_forget_calls_engine(self) -> None:
        """forget 端点应调用 ForgettingEngine.forget_session()。"""
        mock_engines = _mock_engines_tuple()
        forgetting = mock_engines.forgetting
        forgetting.forget_session.return_value = {  # type: ignore[attr-defined]
            "episodes_deleted": 0,
            "facts_deleted": 0,
            "faiss_vectors_removed": 0,
            "session_id": "empty",
        }

        app.state.engines = mock_engines
        app.state.settings = MagicMock(user_profile="test_forget")

        client = TestClient(app)
        client.post("/session/forget", json={"session_id": "empty"})

        forgetting.forget_session.assert_called_once_with("empty")  # type: ignore[attr-defined]

    def test_forget_missing_session_id_returns_422(self) -> None:
        """缺少 session_id 字段返回 422 验证错误。"""
        with forget_client() as client:
            resp = client.post("/session/forget", json={})
            assert resp.status_code == 422

    def test_forget_empty_session_id_returns_422(self) -> None:
        """空 session_id 返回 422 验证错误。"""
        with forget_client() as client:
            resp = client.post("/session/forget", json={"session_id": ""})
            assert resp.status_code == 422

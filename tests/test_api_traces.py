"""API tests — /traces endpoints (list, filter, count, delete)."""

from __future__ import annotations

from unittest.mock import MagicMock

from .helpers import build_mock_engines, make_client


class TestTraces:
    """Traces endpoints — list, filter, count, delete-old."""

    def test_list_traces_empty(self) -> None:
        store = MagicMock()
        store.get_traces.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/traces")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_list_traces_with_session(self) -> None:
        store = MagicMock()
        store.get_traces.return_value = [
            {
                "id": 1,
                "session_id": "s1",
                "step_name": "recall",
                "elapsed_ms": 12.5,
                "status": "ok",
                "metrics": "{}",
                "created_at": 1000.0,
            },
        ]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/traces?session_id=s1&limit=10")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["session_id"] == "s1"
            store.get_traces.assert_called_once_with(session_id="s1", limit=10)

    def test_list_traces_by_step(self) -> None:
        store = MagicMock()
        store.get_traces_by_step.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/traces/by-step?step_name=recall")
            assert resp.status_code == 200
            store.get_traces_by_step.assert_called_once_with(step_name="recall", limit=200)

    def test_trace_count(self) -> None:
        store = MagicMock()
        store.get_trace_count.return_value = 42
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/traces/count")
            assert resp.status_code == 200
            data = resp.json()
            assert data["count"] == 42

    def test_delete_old_traces(self) -> None:
        store = MagicMock()
        store.delete_old_traces.return_value = 15
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.post("/traces/delete-old", json={"retention_limit": 100})
            assert resp.status_code == 200
            data = resp.json()
            assert data["deleted"] == 15
            assert data["retention_limit"] == 100

    def test_delete_old_traces_validation(self) -> None:
        with make_client() as client:
            resp = client.post("/traces/delete-old", json={"retention_limit": 0})
            assert resp.status_code == 422

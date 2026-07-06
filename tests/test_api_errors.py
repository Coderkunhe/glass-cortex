"""API tests — error handling and recovery."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from .helpers import build_mock_engines, make_client


class TestErrorHandling:
    """Structured error responses from exception handlers."""

    def test_validation_error_has_field_errors(self) -> None:
        with make_client() as client:
            resp = client.post("/memory/recall", json={})
            assert resp.status_code == 422
            data = resp.json()
            assert data["error"] == "validation_error"
            assert data["detail"] == "Request validation failed"
            assert "field_errors" in data
            assert len(data["field_errors"]) > 0
            fe = data["field_errors"][0]
            assert "field" in fe
            assert "message" in fe
            assert "type" in fe

    def test_http_exception_envelope(self) -> None:
        """HTTPException with string detail → ErrorResponse envelope."""
        with make_client() as client:
            resp = client.get("/profiles/switch")
            assert resp.status_code == 405
            data = resp.json()
            assert data["error"] == "http_error"

    def test_unhandled_exception_500_sanitized(self) -> None:
        """Unhandled Exception → 500 with sanitized detail (no internal leak)."""
        store = MagicMock()
        store.get_all_episodes.side_effect = Exception("Boom! DB corruption")
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/profiles/current")
            assert resp.status_code == 500
            data = resp.json()
            assert data["error"] == "internal_server_error"
            assert "Boom" not in data["detail"]


class TestErrorRecovery:
    """Error codes and health enrichment."""

    def test_health_overall_status_ok(self) -> None:
        engines = build_mock_engines()
        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {
                    "database": {"status": "ok", "latency_ms": 1.0, "detail": ""},
                    "faiss_index": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "llm_api": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "disk_space": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "embedding_model": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                }
                resp = client.get("/health")
                data = resp.json()
                assert data["overall_status"] == "ok"

    def test_health_overall_status_error(self) -> None:
        engines = build_mock_engines()
        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {
                    "database": {"status": "error", "latency_ms": 100.0, "detail": ""},
                    "faiss_index": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "llm_api": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "disk_space": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "embedding_model": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                }
                resp = client.get("/health")
                data = resp.json()
                assert data["overall_status"] == "error"

    def test_health_recovery_suggestions_db_error(self) -> None:
        engines = build_mock_engines()
        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {
                    "database": {"status": "error", "latency_ms": 5000.0, "detail": ""},
                    "faiss_index": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "llm_api": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "disk_space": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                    "embedding_model": {"status": "ok", "latency_ms": 0.0, "detail": ""},
                }
                resp = client.get("/health")
                data = resp.json()
                assert len(data["recovery_suggestions"]) > 0
                assert data["recovery_suggestions"][0]["component"] == "database"
                assert data["recovery_suggestions"][0]["status"] == "error"
                assert "hint" in data["recovery_suggestions"][0]

    def test_422_has_error_code(self) -> None:
        with make_client() as client:
            resp = client.post("/memory/recall", json={})
            assert resp.status_code == 422
            data = resp.json()
            assert data["error_code"] == "VALIDATION_ERROR"

    def test_500_has_error_code(self) -> None:
        store = MagicMock()
        store.get_all_episodes.side_effect = Exception("Boom!")
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/profiles/current")
            assert resp.status_code == 500
            data = resp.json()
            assert data["error_code"] == "INTERNAL_ERROR"

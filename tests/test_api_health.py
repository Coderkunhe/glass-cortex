"""API tests — GET /health endpoint."""

from __future__ import annotations

from unittest.mock import patch

from .helpers import build_mock_engines, make_client


class TestHealth:
    """GET /health — component health checks."""

    def test_health_returns_five_components(self) -> None:
        """Normal response with 5 components of mixed status."""
        engines = build_mock_engines()

        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {
                    "database": {"status": "ok", "latency_ms": 1.2, "detail": "SQLite connected"},
                    "faiss_index": {
                        "status": "ok",
                        "latency_ms": 0.0,
                        "detail": "Index loaded — 42 vectors, dim=384",
                    },
                    "llm_api": {
                        "status": "warn",
                        "latency_ms": 0.0,
                        "detail": "API key not set",
                    },
                    "disk_space": {
                        "status": "ok",
                        "latency_ms": 0.5,
                        "detail": "Free: 45.2 GB",
                    },
                    "embedding_model": {
                        "status": "ok",
                        "latency_ms": 15.3,
                        "detail": "all-MiniLM-L6-v2 — dim=384",
                    },
                }
                resp = client.get("/health")
                assert resp.status_code == 200
                data = resp.json()
                assert data["service"] == "glasscortex"
                assert len(data["components"]) == 5
                assert data["components"]["database"]["status"] == "ok"
                assert data["components"]["llm_api"]["status"] == "warn"
                assert data["components"]["embedding_model"]["latency_ms"] == 15.3

    def test_health_error_status(self) -> None:
        """One component in error state — still returns 200 with overall degraded."""
        engines = build_mock_engines()

        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {
                    "database": {
                        "status": "error",
                        "latency_ms": 5000.0,
                        "detail": "Connection refused",
                    },
                    "faiss_index": {
                        "status": "ok",
                        "latency_ms": 0.0,
                        "detail": "Index loaded",
                    },
                    "llm_api": {
                        "status": "ok",
                        "latency_ms": 0.0,
                        "detail": "API key set",
                    },
                    "disk_space": {
                        "status": "ok",
                        "latency_ms": 0.5,
                        "detail": "Free: 45.2 GB",
                    },
                    "embedding_model": {
                        "status": "ok",
                        "latency_ms": 15.3,
                        "detail": "all-MiniLM-L6-v2",
                    },
                }
                resp = client.get("/health")
                assert resp.status_code == 200
                data = resp.json()
                assert data["components"]["database"]["status"] == "error"

    def test_health_all_components_error(self) -> None:
        """All components in error — still returns 200, overall_status is 'error'."""
        engines = build_mock_engines()

        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {
                    "database": {"status": "error", "latency_ms": 0.0, "detail": "down"},
                    "faiss_index": {"status": "error", "latency_ms": 0.0, "detail": "corrupted"},
                    "llm_api": {"status": "error", "latency_ms": 0.0, "detail": "unreachable"},
                    "disk_space": {"status": "error", "latency_ms": 0.0, "detail": "full"},
                    "embedding_model": {"status": "error", "latency_ms": 0.0, "detail": "failed"},
                }
                resp = client.get("/health")
                assert resp.status_code == 200
                data = resp.json()
                assert data["overall_status"] == "error"
                assert len(data["components"]) == 5

    def test_health_empty_components(self) -> None:
        """check_health returns empty dict — endpoint handles gracefully."""
        engines = build_mock_engines()

        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {}
                resp = client.get("/health")
                assert resp.status_code == 200
                data = resp.json()
                assert data["components"] == {}
                # No statuses → overall defaults to "ok"
                assert data["overall_status"] == "ok"

    def test_health_exception_from_check(self) -> None:
        """check_health raises exception — endpoint returns 500."""
        engines = build_mock_engines()

        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.side_effect = RuntimeError("database connection lost")
                resp = client.get("/health")
                assert resp.status_code == 500

    def test_health_non_string_status(self) -> None:
        """Non-string status value is safely converted via str()."""
        engines = build_mock_engines()

        with make_client(engines) as client:
            with patch("src.health.check_health") as mock_ch:
                mock_ch.return_value = {
                    "database": {"status": 123, "latency_ms": 1.0, "detail": "numeric status"},
                }
                resp = client.get("/health")
                assert resp.status_code == 200
                data = resp.json()
                # str(123) → "123", endpoint does not crash
                assert data["components"]["database"]["status"] == "123"

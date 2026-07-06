"""API tests — /metrics endpoints (token, step, and compression summaries)."""

from __future__ import annotations

from unittest.mock import MagicMock

from .helpers import build_mock_engines, make_client


class TestMetrics:
    """Token and step metrics endpoints."""

    def test_token_summary_empty(self) -> None:
        ledger = MagicMock()
        ledger.summary.return_value = {
            "total": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/tokens")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_tokens"] == 0
            assert data["by_call_point"] == {}

    def test_token_summary_with_data(self) -> None:
        ledger = MagicMock()
        ledger.summary.return_value = {
            "chat_engine": {"prompt_tokens": 500, "completion_tokens": 200, "total_tokens": 700},
            "planner": {"prompt_tokens": 80, "completion_tokens": 20, "total_tokens": 100},
            "total": {"prompt_tokens": 580, "completion_tokens": 220, "total_tokens": 800},
        }
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/tokens")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_prompt_tokens"] == 580
            assert data["total_completion_tokens"] == 220
            assert data["total_tokens"] == 800
            assert data["by_call_point"]["chat_engine"]["prompt_tokens"] == 500
            assert data["by_call_point"]["planner"]["total_tokens"] == 100

    def test_step_summary_empty(self) -> None:
        ledger = MagicMock()
        ledger.step_summary.return_value = {}
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/steps")
            assert resp.status_code == 200
            data = resp.json()
            assert data["steps"] == {}

    def test_step_summary_with_data(self) -> None:
        ledger = MagicMock()
        ledger.step_summary.return_value = {
            "intent_classify": {
                "count": 5.0,
                "total_ms": 1250.0,
                "avg_ms": 250.0,
                "min_ms": 180.0,
                "max_ms": 350.0,
            },
        }
        engines = build_mock_engines(ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/steps")
            assert resp.status_code == 200
            data = resp.json()
            steps = data["steps"]
            assert steps["intent_classify"]["count"] == 5.0
            assert steps["intent_classify"]["avg_ms"] == 250.0


class TestCompressionMetrics:
    """Compression stats endpoint — ledger + pipeline_trace aggregation."""

    def test_compression_stats_empty(self) -> None:
        """No compression data in ledger or pipeline_trace → all zeros."""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "total": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }
        store = MagicMock()
        store.get_traces_by_step.return_value = []
        engines = build_mock_engines(store=store, ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/compression")
            assert resp.status_code == 200
            data = resp.json()
            assert data["session_compression_count"] == 0
            assert data["session_tokens_saved"] == 0
            assert data["session_prompt_tokens"] == 0
            assert data["session_completion_tokens"] == 0
            assert data["historical_compression_count"] == 0

    def test_compression_stats_with_ledger_data(self) -> None:
        """Ledger has compression records → correctly aggregated."""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "compression": {
                "count": 3,
                "prompt_tokens": 450,
                "completion_tokens": 60,
                "total_tokens": 510,
            },
            "compression_savings": {
                "count": 3,
                "prompt_tokens": 2400,
                "completion_tokens": 0,
                "total_tokens": 2400,
            },
            "total": {"prompt_tokens": 2850, "completion_tokens": 60, "total_tokens": 2910},
        }
        store = MagicMock()
        store.get_traces_by_step.return_value = []
        engines = build_mock_engines(store=store, ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/compression")
            assert resp.status_code == 200
            data = resp.json()
            assert data["session_compression_count"] == 3
            assert data["session_tokens_saved"] == 2400
            assert data["session_prompt_tokens"] == 450
            assert data["session_completion_tokens"] == 60
            assert data["historical_compression_count"] == 0

    def test_compression_stats_with_historical(self) -> None:
        """Pipeline trace has compression records → historical count correct."""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "total": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }
        store = MagicMock()
        store.get_traces_by_step.return_value = [
            {"id": 1, "step_name": "compression"},
            {"id": 2, "step_name": "compression"},
            {"id": 3, "step_name": "compression"},
            {"id": 4, "step_name": "compression"},
            {"id": 5, "step_name": "compression"},
        ]
        engines = build_mock_engines(store=store, ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/compression")
            assert resp.status_code == 200
            data = resp.json()
            assert data["session_compression_count"] == 0
            assert data["session_tokens_saved"] == 0
            assert data["historical_compression_count"] == 5

    def test_compression_stats_both_sources(self) -> None:
        """Both ledger and pipeline_trace have data → both correctly reported."""
        ledger = MagicMock()
        ledger.summary.return_value = {
            "compression": {
                "count": 2,
                "prompt_tokens": 300,
                "completion_tokens": 40,
                "total_tokens": 340,
            },
            "compression_savings": {
                "count": 2,
                "prompt_tokens": 1500,
                "completion_tokens": 0,
                "total_tokens": 1500,
            },
            "total": {"prompt_tokens": 1800, "completion_tokens": 40, "total_tokens": 1840},
        }
        store = MagicMock()
        store.get_traces_by_step.return_value = [{"id": 1}, {"id": 2}, {"id": 3}]
        engines = build_mock_engines(store=store, ledger=ledger)
        with make_client(engines) as client:
            resp = client.get("/metrics/compression")
            assert resp.status_code == 200
            data = resp.json()
            assert data["session_compression_count"] == 2
            assert data["session_tokens_saved"] == 1500
            assert data["session_prompt_tokens"] == 300
            assert data["session_completion_tokens"] == 40
            assert data["historical_compression_count"] == 3

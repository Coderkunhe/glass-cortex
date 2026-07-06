"""API tests — /context endpoints (overflow simulation, comparison, tiers)."""

from __future__ import annotations

from unittest.mock import MagicMock

from .helpers import build_mock_engines, make_client


class TestContext:
    """Overflow simulation and strategy comparison endpoints."""

    def test_simulate_overflow_no_overflow(self) -> None:
        with make_client() as client:
            resp = client.post(
                "/context/simulate-overflow",
                json={
                    "recalled": [{"content": "hello", "importance": 0.5}],
                    "strategy": "prioritize",
                    "window_size": 4096,
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["strategy"] == "prioritize"
            assert "overflow_triggered" in data
            assert "total_estimated_tokens" in data

    def test_compare_strategies(self) -> None:
        with make_client() as client:
            resp = client.post(
                "/context/compare-strategies",
                json={
                    "recalled": [{"content": "test", "importance": 0.5}],
                    "window_size": 2048,
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "truncate" in data
            assert "prioritize" in data
            assert "summarize" in data

    def test_simulate_overflow_invalid_strategy(self) -> None:
        with make_client() as client:
            resp = client.post(
                "/context/simulate-overflow",
                json={"strategy": "invalid"},
            )
            assert resp.status_code == 422

    def test_simulate_overflow_empty_recalled(self) -> None:
        with make_client() as client:
            resp = client.post(
                "/context/simulate-overflow",
                json={"recalled": [], "strategy": "truncate"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["memories_before"] == 0

    def test_compare_strategies_with_base_tokens_override(self) -> None:
        with make_client() as client:
            resp = client.post(
                "/context/compare-strategies",
                json={"base_tokens_override": 500},
            )
            assert resp.status_code == 200


class TestTierDistribution:
    """GET /memory/tiers endpoint integration tests.

    Validates multi-tier memory classification API correctness:
    feature flag gating, distribution computation, config snapshot.
    """

    # ── tier_enabled=False ──

    def test_tiers_disabled_returns_empty(self) -> None:
        """tier_enabled=False returns all-zero distribution + flag."""
        store = MagicMock()
        engines = build_mock_engines(store=store)

        with make_client(engines, tier_enabled=False) as client:
            resp = client.get("/memory/tiers")

        assert resp.status_code == 200
        body = resp.json()
        assert body["tier_enabled"] is False
        assert body["distribution"] == {"hot": 0, "warm": 0, "cold": 0}
        assert body["episodes_by_tier"] == {"hot": [], "warm": [], "cold": []}
        assert body["config"] == {"tier_enabled": False}
        store.get_all_episodes.assert_not_called()

    # ── tier_enabled=True (happy path) ──

    def test_tiers_enabled_classifies_and_returns_distribution(self) -> None:
        """tier_enabled=True classifies episodes and returns distribution."""
        from time import time

        now = time()
        store = MagicMock()
        store.get_all_episodes.return_value = [
            {
                "id": 1,
                "content": "hot item",
                "importance": 1.0,
                "initial_strength": 1.0,
                "access_count": 50,
                "last_recall": now,
                "timestamp": now - 100,
            },
            {
                "id": 2,
                "content": "warm item",
                "importance": 0.5,
                "initial_strength": 0.7,
                "access_count": 10,
                "last_recall": now - 3600,
                "timestamp": now - 86400,
            },
            {
                "id": 3,
                "content": "cold item",
                "importance": 0.1,
                "initial_strength": 0.1,
                "access_count": 0,
                "last_recall": None,
                "timestamp": now - 86400 * 30,
            },
            {
                "id": 4,
                "content": "another warm item",
                "importance": 0.6,
                "initial_strength": 0.8,
                "access_count": 8,
                "last_recall": now - 7200,
                "timestamp": now - 86400 * 2,
            },
        ]
        engines = build_mock_engines(store=store)

        with make_client(
            engines,
            tier_enabled=True,
            tier_hot_threshold=0.7,
            tier_warm_threshold=0.3,
            tier_recency_weight=0.4,
            tier_access_weight=0.3,
            tier_importance_weight=0.3,
        ) as client:
            resp = client.get("/memory/tiers")

        assert resp.status_code == 200
        body = resp.json()
        assert body["tier_enabled"] is True

        dist = body["distribution"]
        assert dist["hot"] + dist["warm"] + dist["cold"] == 4

        assert 1 in body["episodes_by_tier"]["hot"]
        assert 3 in body["episodes_by_tier"]["cold"]

        all_ids = (
            body["episodes_by_tier"]["hot"]
            + body["episodes_by_tier"]["warm"]
            + body["episodes_by_tier"]["cold"]
        )
        assert sorted(all_ids) == [1, 2, 3, 4]

        config = body["config"]
        assert config["tier_enabled"] is True
        assert config["tier_hot_threshold"] == 0.7
        assert config["tier_warm_threshold"] == 0.3

    # ── empty episodes ──

    def test_tiers_empty_episodes_returns_zero_distribution(self) -> None:
        """No episodes → all-zero distribution, no error."""
        store = MagicMock()
        store.get_all_episodes.return_value = []
        engines = build_mock_engines(store=store)

        with make_client(engines, tier_enabled=True) as client:
            resp = client.get("/memory/tiers")

        assert resp.status_code == 200
        body = resp.json()
        assert body["distribution"] == {"hot": 0, "warm": 0, "cold": 0}
        assert body["episodes_by_tier"] == {"hot": [], "warm": [], "cold": []}

    # ── config completeness ──

    def test_tiers_config_snapshot_matches_settings(self) -> None:
        """Returned config snapshot matches injected settings."""
        store = MagicMock()
        store.get_all_episodes.return_value = []
        engines = build_mock_engines(store=store)

        with make_client(
            engines,
            tier_enabled=True,
            tier_hot_threshold=0.85,
            tier_warm_threshold=0.25,
            tier_recency_weight=0.5,
            tier_access_weight=0.2,
            tier_importance_weight=0.3,
        ) as client:
            resp = client.get("/memory/tiers")

        config = resp.json()["config"]
        assert config["tier_hot_threshold"] == 0.85
        assert config["tier_warm_threshold"] == 0.25
        assert config["tier_recency_weight"] == 0.5
        assert config["tier_access_weight"] == 0.2
        assert config["tier_importance_weight"] == 0.3

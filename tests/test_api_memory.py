"""API tests — /memory endpoints (episodes, facts, recall, decay, confidence, tag-detail)."""

from __future__ import annotations

from unittest.mock import MagicMock

from .helpers import build_mock_engines, make_client


class TestMemoryEpisodes:
    """GET /memory/episodes — episode listing."""

    def test_list_episodes_empty(self) -> None:
        store = MagicMock()
        store.get_all_episodes.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/episodes")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_list_episodes_returns_items(self) -> None:
        store = MagicMock()
        store.get_all_episodes.return_value = [
            {"id": 1, "content": "hello", "importance": 0.5},
            {"id": 2, "content": "world", "importance": 0.8},
        ]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/episodes")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 2
            assert data[0]["id"] == 1

    def test_list_episodes_with_since(self) -> None:
        store = MagicMock()
        store.get_episodes_since.return_value = [
            {"id": 3, "content": "recent", "importance": 0.9},
        ]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/episodes?since=1700000000.0")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            store.get_episodes_since.assert_called_once_with(1700000000.0)
            store.get_all_episodes.assert_not_called()

    def test_list_episodes_limit(self) -> None:
        store = MagicMock()
        store.get_all_episodes.return_value = [{"id": i, "content": f"msg{i}"} for i in range(100)]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/episodes?limit=3")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 3


class TestMemoryFacts:
    """GET /memory/facts — fact listing."""

    def test_list_facts_empty(self) -> None:
        store = MagicMock()
        store.get_all_facts.return_value = []
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/facts")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_list_facts_by_subject(self) -> None:
        store = MagicMock()
        store.get_facts_by_subject.return_value = [
            {"id": 5, "content": "Linus created Linux", "subject": "Linus"},
        ]
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/facts?subject=Linus")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            store.get_facts_by_subject.assert_called_once_with("Linus")
            store.get_all_facts.assert_not_called()


class TestMemoryRecall:
    """POST /memory/recall — semantic memory recall."""

    def test_recall_returns_items(self) -> None:
        recall = MagicMock()
        recall.recall.return_value = [
            {"id": 1, "content": "remembered", "composite_score": 0.85},
            {"id": 2, "content": "also remembered", "composite_score": 0.72},
        ]
        engines = build_mock_engines(recall=recall)
        with make_client(engines) as client:
            resp = client.post("/memory/recall", json={"query": "test query"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["count"] == 2
            assert len(data["items"]) == 2
            assert data["query"] == "test query"

    def test_recall_default_params(self) -> None:
        recall = MagicMock()
        recall.recall.return_value = []
        engines = build_mock_engines(recall=recall)
        with make_client(engines) as client:
            resp = client.post("/memory/recall", json={"query": "hello"})
            assert resp.status_code == 200
            recall.recall.assert_called_once_with(
                query="hello",
                top_k=5,
                threshold=0.1,
                strengthen=True,
            )

    def test_recall_custom_params(self) -> None:
        recall = MagicMock()
        recall.recall.return_value = []
        engines = build_mock_engines(recall=recall)
        with make_client(engines) as client:
            resp = client.post(
                "/memory/recall",
                json={"query": "hello", "top_k": 10, "threshold": 0.5, "strengthen": False},
            )
            assert resp.status_code == 200
            recall.recall.assert_called_once_with(
                query="hello",
                top_k=10,
                threshold=0.5,
                strengthen=False,
            )

    def test_recall_validation_error(self) -> None:
        with make_client() as client:
            resp = client.post("/memory/recall", json={})  # missing query
            assert resp.status_code == 422  # validation error

    def test_recall_engine_error(self) -> None:
        recall = MagicMock()
        recall.recall.side_effect = RuntimeError("FAISS index corrupted")
        engines = build_mock_engines(recall=recall)
        with make_client(engines) as client:
            resp = client.post("/memory/recall", json={"query": "hello"})
            assert resp.status_code == 500
            data = resp.json()
            assert "FAISS index corrupted" in data["detail"]


class TestDecay:
    """POST /memory/decay — trigger global Ebbinghaus decay."""

    def test_trigger_decay(self) -> None:
        forget = MagicMock()
        forget.decay_all.return_value = [(1, 0.8, 0.5), (2, 0.6, 0.3)]
        engines = build_mock_engines(forget=forget)
        with make_client(engines) as client:
            resp = client.post("/memory/decay", json={})
            assert resp.status_code == 200
            data = resp.json()
            assert data["items_decayed"] == 2
            assert len(data["deltas"]) == 2
            assert data["deltas"][0]["id"] == 1

    def test_trigger_decay_with_lambda_override(self) -> None:
        forget = MagicMock()
        forget.decay_all.return_value = []
        engines = build_mock_engines(forget=forget)
        with make_client(engines) as client:
            resp = client.post("/memory/decay", json={"lambda_override": 0.01})
            assert resp.status_code == 200
            forget.decay_all.assert_called_once_with(lambda_override=0.01)

    def test_trigger_decay_empty_db(self) -> None:
        forget = MagicMock()
        forget.decay_all.return_value = []
        engines = build_mock_engines(forget=forget)
        with make_client(engines) as client:
            resp = client.post("/memory/decay", json={})
            assert resp.status_code == 200
            data = resp.json()
            assert data["items_decayed"] == 0
            assert data["deltas"] == []


class TestFactConfidenceUpdate:
    """POST /memory/facts/{fact_id}/confidence — correct or star a fact."""

    def test_correct_fact_reduces_confidence(self) -> None:
        """Correction with delta=-0.3 should reduce confidence and write audit log."""
        store = MagicMock()
        store.update_fact_confidence.return_value = (0.8, 0.5)
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.post(
                "/memory/facts/1/confidence",
                json={"delta": -0.3, "reason": "user_correction"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["fact_id"] == 1
            assert data["confidence_before"] == 0.8
            assert data["confidence_after"] == 0.5
            assert data["reason"] == "user_correction"
            assert "logged_at" in data
            store.update_fact_confidence.assert_called_once_with(1, -0.3)
            store.log_fact_confidence.assert_called_once()

    def test_star_fact_boosts_confidence(self) -> None:
        """Star operation with delta=+0.2 should boost confidence."""
        store = MagicMock()
        store.update_fact_confidence.return_value = (0.6, 0.8)
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.post(
                "/memory/facts/2/confidence",
                json={"delta": 0.2, "reason": "user_star"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["confidence_before"] == 0.6
            assert data["confidence_after"] == 0.8
            store.update_fact_confidence.assert_called_once_with(2, 0.2)

    def test_fact_not_found_returns_404(self) -> None:
        """Non-existent fact_id returns 404."""
        store = MagicMock()
        store.update_fact_confidence.return_value = None
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.post(
                "/memory/facts/999/confidence",
                json={"delta": -0.3, "reason": "user_correction"},
            )
            assert resp.status_code == 404
            store.update_fact_confidence.assert_called_once_with(999, -0.3)

    def test_delta_zero_keeps_confidence_unchanged(self) -> None:
        """Delta=0 keeps confidence unchanged."""
        store = MagicMock()
        store.update_fact_confidence.return_value = (0.7, 0.7)
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.post(
                "/memory/facts/3/confidence",
                json={"delta": 0.0, "reason": "test_neutral"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["confidence_before"] == 0.7
            assert data["confidence_after"] == 0.7
            store.update_fact_confidence.assert_called_once_with(3, 0.0)

    def test_missing_reason_returns_422(self) -> None:
        """Missing required reason returns 422."""
        store = MagicMock()
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.post(
                "/memory/facts/1/confidence",
                json={"delta": -0.3},
            )
            assert resp.status_code == 422


class TestTagDetailEndpoint:
    """GET /memory/tag-detail — tag provenance (Phase 30 B1)."""

    def test_tag_detail_success(self) -> None:
        """Normal tag detail response."""
        store = MagicMock()
        store.get_tag_detail.return_value = {
            "subject": "用户",
            "relation": "喜欢",
            "max_confidence": 0.9,
            "fact_count": 2,
            "distinct_objects": 2,
            "facts": [
                {
                    "id": 1,
                    "content": "用户 — 喜欢 → 布偶猫",
                    "confidence": 0.9,
                    "object": "布偶猫",
                    "source_episode_id": 1,
                    "episode_content": "用户喜欢布偶猫",
                    "episode_timestamp": 1719000000.0,
                    "created_at": 1719000000.0,
                    "updated_at": None,
                    "confidence_log": [
                        {
                            "fact_id": 1,
                            "confidence_before": 0.8,
                            "confidence_after": 0.9,
                            "reason": "用户确认",
                            "logged_at": 1719000000.0,
                        },
                    ],
                },
            ],
        }
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get(
                "/memory/tag-detail",
                params={"subject": "用户", "relation": "喜欢"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["subject"] == "用户"
            assert data["relation"] == "喜欢"
            assert data["max_confidence"] == 0.9
            assert data["fact_count"] == 2
            assert len(data["facts"]) == 1
            assert data["facts"][0]["confidence_log"][0]["reason"] == "用户确认"

    def test_tag_detail_empty(self) -> None:
        """No matching facts returns empty list."""
        store = MagicMock()
        store.get_tag_detail.return_value = {
            "subject": "unknown",
            "relation": "unknown",
            "max_confidence": 0.0,
            "fact_count": 0,
            "distinct_objects": 0,
            "facts": [],
        }
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get(
                "/memory/tag-detail",
                params={"subject": "unknown", "relation": "unknown"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["fact_count"] == 0
            assert data["facts"] == []

    def test_tag_detail_missing_subject_returns_422(self) -> None:
        """Missing required subject returns 422."""
        store = MagicMock()
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/tag-detail", params={"relation": "喜欢"})
            assert resp.status_code == 422

    def test_tag_detail_missing_relation_returns_422(self) -> None:
        """Missing required relation returns 422."""
        store = MagicMock()
        engines = build_mock_engines(store=store)
        with make_client(engines) as client:
            resp = client.get("/memory/tag-detail", params={"subject": "用户"})
            assert resp.status_code == 422

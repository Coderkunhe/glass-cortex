"""API tests — Pydantic schema validation for requests."""

from __future__ import annotations

import pytest

from api.schemas import ChatRequest, ProfileSwitchRequest, RecallRequest


class TestSchemas:
    """Pydantic model validation edge cases."""

    def test_chat_request_minimal(self) -> None:
        req = ChatRequest(  # type: ignore[call-arg]
            user_input="hi",
        )
        assert req.user_input == "hi"
        assert req.context_window_size == 4096
        assert req.context_overflow_strategy == "prioritize"

    def test_chat_request_invalid_strategy(self) -> None:
        with pytest.raises(ValueError):
            ChatRequest(  # type: ignore[call-arg]
                user_input="hi",
                context_overflow_strategy="invalid",
            )

    def test_recall_request_defaults(self) -> None:
        req = RecallRequest(query="test")  # type: ignore[call-arg]
        assert req.top_k == 5
        assert req.threshold == 0.1
        assert req.strengthen is True

    def test_chat_request_recall_defaults(self) -> None:
        """ChatRequest recall fields have sensible defaults."""
        req = ChatRequest(user_input="hi")  # type: ignore[call-arg]
        assert req.recall_top_k == 5
        assert req.recall_threshold == 0.1
        assert req.recall_mmr_lambda is None

    def test_chat_request_recall_custom(self) -> None:
        """ChatRequest allows recall param overrides."""
        req = ChatRequest(  # type: ignore[call-arg]
            user_input="hi",
            recall_top_k=10,
            recall_threshold=0.3,
            recall_mmr_lambda=0.5,
        )
        assert req.recall_top_k == 10
        assert req.recall_threshold == 0.3
        assert req.recall_mmr_lambda == 0.5

    def test_chat_request_recall_validation(self) -> None:
        """Recall field boundary validation: top_k 1-50, threshold 0-1."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ChatRequest(user_input="hi", recall_top_k=0)  # type: ignore[call-arg]
        with pytest.raises(ValidationError):
            ChatRequest(user_input="hi", recall_top_k=51)  # type: ignore[call-arg]
        with pytest.raises(ValidationError):
            ChatRequest(user_input="hi", recall_threshold=-0.1)  # type: ignore[call-arg]
        with pytest.raises(ValidationError):
            ChatRequest(user_input="hi", recall_threshold=1.1)  # type: ignore[call-arg]
        with pytest.raises(ValidationError):
            ChatRequest(user_input="hi", recall_mmr_lambda=-0.1)  # type: ignore[call-arg]
        with pytest.raises(ValidationError):
            ChatRequest(user_input="hi", recall_mmr_lambda=1.1)  # type: ignore[call-arg]


class TestProfileSchemas:
    """Pydantic model validation for profile endpoints."""

    def test_profile_switch_request_valid(self) -> None:
        req = ProfileSwitchRequest(name="alice")
        assert req.name == "alice"

    def test_profile_switch_request_missing_name(self) -> None:
        with pytest.raises(ValueError):
            ProfileSwitchRequest()  # type: ignore[call-arg]


class TestContextSchemas:
    """Pydantic model validation for context lab endpoints."""

    def test_simulate_overflow_request_valid(self) -> None:
        from api.schemas import SimulateOverflowRequest

        req = SimulateOverflowRequest(  # type: ignore[call-arg]
            recalled=[{"content": "hi"}],
            strategy="prioritize",
            window_size=2048,
        )
        assert req.strategy == "prioritize"
        assert req.window_size == 2048

    def test_simulate_overflow_request_invalid_strategy(self) -> None:
        from api.schemas import SimulateOverflowRequest

        with pytest.raises(ValueError):
            SimulateOverflowRequest(strategy="nonexistent")  # type: ignore[call-arg]


# ── I-104: from_attributes=True ORM→Pydantic 映射测试 ──────────────────────


class TestFromAttributesMapping:
    """I-104 — 验证 sqlite3.Row→Pydantic 模型转换的正确性。

    MemoryStore 设置 row_factory=sqlite3.Row 后返回 Row 对象，
    API 层通过 Model(**dict(row)) 转换为 Pydantic 实例。
    这些测试通过 model_validate 验证 from_attributes 路径。
    """

    # ── EpisodeOut ──────────────────────────────────────────────────────

    def test_episode_out_full_row(self) -> None:
        """完整 episode Row → EpisodeOut：所有字段 + lambda 别名。"""
        from api.schemas import EpisodeOut

        data = {
            "id": 42,
            "content": "用户喜欢布偶猫",
            "importance": 0.8,
            "initial_strength": 1.0,
            "lambda": 0.05,
            "timestamp": 1700000000.0,
            "faiss_id": 7,
            "access_count": 3,
            "last_recall": 1700001000.0,
            "tier": "hot",
        }
        ep = EpisodeOut.model_validate(data)
        assert ep.id == 42
        assert ep.content == "用户喜欢布偶猫"
        assert ep.importance == pytest.approx(0.8)
        assert ep.initial_strength == pytest.approx(1.0)
        assert ep.lambda_ == pytest.approx(0.05)
        assert ep.timestamp == 1700000000.0
        assert ep.faiss_id == 7
        assert ep.access_count == 3
        assert ep.last_recall == 1700001000.0
        assert ep.tier == "hot"

    def test_episode_out_minimal_row(self) -> None:
        """最小化 Row（仅必填字段）→ EpisodeOut：可空字段为 None，默认值起效。"""
        from api.schemas import EpisodeOut

        data = {
            "id": 1,
            "content": "minimal",
            "importance": 0.5,
            "initial_strength": 1.0,
            "lambda": 0.1,
            "timestamp": 1700000000.0,
        }
        ep = EpisodeOut.model_validate(data)
        assert ep.id == 1
        assert ep.faiss_id is None
        assert ep.access_count == 0
        assert ep.last_recall is None
        assert ep.tier == "warm"

    # ── FactOut ─────────────────────────────────────────────────────────

    def test_fact_out_full_row(self) -> None:
        """完整 fact Row + subject/relation/object → FactOut。"""
        from api.schemas import FactOut

        data = {
            "id": 10,
            "content": "布偶猫是长毛猫品种",
            "confidence": 0.9,
            "source_episode_id": 42,
            "faiss_id": 3,
            "subject": "布偶猫",
            "relation": "is_a",
            "object": "长毛猫",
            "timestamp": 1700000000.0,
        }
        f = FactOut.model_validate(data)
        assert f.id == 10
        assert f.content == "布偶猫是长毛猫品种"
        assert f.confidence == pytest.approx(0.9)
        assert f.source_episode_id == 42
        assert f.faiss_id == 3
        assert f.subject == "布偶猫"
        assert f.relation == "is_a"
        assert f.object == "长毛猫"
        assert f.timestamp == 1700000000.0

    def test_fact_out_minimal_row(self) -> None:
        """最小化 Row（仅必填字段）→ FactOut：所有可选字段为 None。"""
        from api.schemas import FactOut

        data = {"id": 1, "content": "minimal fact", "confidence": 0.5}
        f = FactOut.model_validate(data)
        assert f.id == 1
        assert f.source_episode_id is None
        assert f.faiss_id is None
        assert f.subject is None
        assert f.relation is None
        assert f.object is None
        assert f.timestamp is None

    # ── RecallItem ──────────────────────────────────────────────────────

    def test_recall_item_from_episode_row(self) -> None:
        """Episode 风格 Row → EpisodeRecallItem：episode 特有字段填充。"""
        from api.schemas import EpisodeRecallItem

        data = {
            "id": 1,
            "content": "episode content",
            "importance": 0.7,
            "initial_strength": 0.9,
            "lambda": 0.05,
            "access_count": 2,
            "last_recall": 1700000000.0,
            "tier": "warm",
            "faiss_id": 5,
            "timestamp": 1699999999.0,
            "composite_score": 0.85,
            "similarity": 0.92,
            "recall_reason": "semantic match on 'cat'",
        }
        item = EpisodeRecallItem.model_validate(data)
        assert isinstance(item, EpisodeRecallItem)
        assert item.id == 1
        assert item.content == "episode content"
        assert item.importance == pytest.approx(0.7)
        assert item.initial_strength == pytest.approx(0.9)
        assert item.lambda_ == pytest.approx(0.05)
        assert item.access_count == 2
        assert item.last_recall == 1700000000.0
        # Recall 引擎注入字段
        assert item.composite_score == pytest.approx(0.85)
        assert item.similarity == pytest.approx(0.92)
        assert item.recall_reason == "semantic match on 'cat'"

    def test_recall_item_from_fact_row(self) -> None:
        """Fact 风格 Row → FactRecallItem：fact 特有字段填充。"""
        from api.schemas import FactRecallItem

        data = {
            "id": 10,
            "content": "fact content",
            "confidence": 0.88,
            "source_episode_id": 3,
            "subject": "Python",
            "relation": "supports",
            "object": "async/await",
            "faiss_id": 2,
            "timestamp": 1699999999.0,
            "composite_score": 0.75,
        }
        item = FactRecallItem.model_validate(data)
        assert isinstance(item, FactRecallItem)
        assert item.id == 10
        assert item.content == "fact content"
        assert item.confidence == pytest.approx(0.88)
        assert item.source_episode_id == 3
        assert item.subject == "Python"
        assert item.relation == "supports"
        assert item.object_ == "async/await"

    def test_recall_item_lambda_by_field_name(self) -> None:
        """populate_by_name=True 允许用字段名 'lambda_' 直接填充。"""
        from api.schemas import EpisodeRecallItem

        data = {
            "id": 1,
            "content": "test",
            "lambda_": 0.08,
        }
        item = EpisodeRecallItem.model_validate(data)
        assert item.lambda_ == pytest.approx(0.08)

    # ── TagFactItem ─────────────────────────────────────────────────────

    def test_tag_fact_item_full_row(self) -> None:
        """完整 tag detail Row → TagFactItem（含嵌套 confidence_log）。"""
        from api.schemas import TagFactItem

        data = {
            "id": 5,
            "content": "布偶猫性格温顺",
            "confidence": 0.95,
            "object": "温顺",
            "source_episode_id": 42,
            "episode_content": "用户说他家的布偶猫特别温顺",
            "episode_timestamp": 1700000000.0,
            "created_at": 1699999999.0,
            "updated_at": 1700000000.0,
            "confidence_log": [
                {
                    "fact_id": 5,
                    "confidence_before": 0.8,
                    "confidence_after": 0.95,
                    "reason": "用户确认",
                    "logged_at": 1700000000.0,
                },
            ],
        }
        tf = TagFactItem.model_validate(data)
        assert tf.id == 5
        assert tf.content == "布偶猫性格温顺"
        assert tf.confidence == pytest.approx(0.95)
        assert tf.object == "温顺"
        assert tf.source_episode_id == 42
        assert tf.episode_content == "用户说他家的布偶猫特别温顺"
        assert tf.episode_timestamp == 1700000000.0
        assert tf.created_at == 1699999999.0
        assert tf.updated_at == 1700000000.0
        assert len(tf.confidence_log) == 1
        assert tf.confidence_log[0].fact_id == 5
        assert tf.confidence_log[0].confidence_before == pytest.approx(0.8)
        assert tf.confidence_log[0].confidence_after == pytest.approx(0.95)
        assert tf.confidence_log[0].reason == "用户确认"

    def test_tag_fact_item_minimal_row(self) -> None:
        """最小化 Row（仅必填字段）→ TagFactItem：可选字段为 None，log 为空列表。"""
        from api.schemas import TagFactItem

        data = {"id": 1, "content": "minimal", "confidence": 0.5}
        tf = TagFactItem.model_validate(data)
        assert tf.id == 1
        assert tf.object is None
        assert tf.source_episode_id is None
        assert tf.episode_content is None
        assert tf.episode_timestamp is None
        assert tf.created_at is None
        assert tf.updated_at is None
        assert tf.confidence_log == []

    def test_tag_fact_item_empty_confidence_log(self) -> None:
        """confidence_log 显式传空列表 → 保留空列表。"""
        from api.schemas import TagFactItem

        data = {"id": 1, "content": "test", "confidence": 0.5, "confidence_log": []}
        tf = TagFactItem.model_validate(data)
        assert tf.confidence_log == []

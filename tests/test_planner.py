from __future__ import annotations

from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.planner import INTENT_CATEGORIES, INTENT_COLORS, IntentResult, PlannerEngine
from src.token_ledger import TokenLedger


def _dummy_embed(text: str) -> np.ndarray:
    return np.ones(384, dtype=np.float32)


class TestIntentResult:
    def test_fields(self) -> None:
        r = IntentResult("提问", 0.95, "test rationale")
        assert r.category == "提问"
        assert r.confidence == 0.95
        assert r.rationale == "test rationale"

    def test_frozen(self) -> None:
        r = IntentResult("提问", 0.95, "test")
        with pytest.raises(FrozenInstanceError):
            r.category = "指令"  # type: ignore[misc]


class TestIntentColors:
    def test_all_categories_have_colors(self) -> None:
        for cat in INTENT_CATEGORIES:
            assert cat in INTENT_COLORS, f"Missing color for {cat}"


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test.db"))
    s.init_db()
    return s


@pytest.fixture
def idx() -> IndexManager:
    return IndexManager()


@pytest.fixture
def planner(store: MemoryStore, idx: IndexManager) -> PlannerEngine:
    return PlannerEngine(store, idx, _dummy_embed)


class TestParseIntent:
    def test_parses_valid_json(self) -> None:
        raw = '{"category": "提问", "confidence": 0.9, "rationale": "用户询问事实"}'
        result, error = PlannerEngine._parse_intent(raw)
        assert error is None
        assert result.category == "提问"
        assert result.confidence == 0.9
        assert result.rationale == "用户询问事实"

    def test_fallback_extract_json_block(self) -> None:
        raw = (
            '一些前缀文本 {"category": "探索", "confidence": 0.8, "rationale": "开放讨论"} 一些后缀'
        )
        result, error = PlannerEngine._parse_intent(raw)
        assert error is None
        assert result.category == "探索"
        assert result.confidence == 0.8

    def test_fallback_regex_match(self) -> None:
        raw = "意图是指令，用户要求执行操作"
        result, error = PlannerEngine._parse_intent(raw)
        assert result.category == "指令"
        assert result.confidence == 0.5

    def test_default_on_garbage(self) -> None:
        raw = "asdfghjkl12345"
        result, error = PlannerEngine._parse_intent(raw)
        assert error is not None
        assert result.category == "提问"
        assert result.confidence == 0.3

    def test_clamps_confidence_0_1(self) -> None:
        raw = '{"category": "提问", "confidence": 2.5, "rationale": "test"}'
        result, _ = PlannerEngine._parse_intent(raw)
        assert result.confidence == 1.0

        raw = '{"category": "提问", "confidence": -0.5, "rationale": "test"}'
        result, _ = PlannerEngine._parse_intent(raw)
        assert result.confidence == 0.0

    def test_unknown_category_defaults(self) -> None:
        raw = '{"category": "未知类型", "confidence": 0.7, "rationale": "test"}'
        result, _ = PlannerEngine._parse_intent(raw)
        assert result.category == "提问"


class TestPlannerLedger:
    def test_records_tokens_to_ledger(self, store: MemoryStore, idx: IndexManager) -> None:
        ledger = TokenLedger()
        p = PlannerEngine(store, idx, _dummy_embed)
        p.set_ledger(ledger)

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content='{"category":"提问","confidence":0.9,"rationale":"test"}')
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=50, completion_tokens=10, total_tokens=60)
        p._client = MagicMock()
        p._client.chat.completions.create.return_value = mock_response

        result, trace = p.classify_intent("什么是AI？")
        assert result.category == "提问"
        usage = ledger.last_usage
        assert usage is not None
        assert usage.call_point == "planner"
        assert usage.prompt_tokens == 50
        assert usage.completion_tokens == 10


class TestPlannerErrorRecovery:
    def test_returns_fallback_on_api_error(self, store: MemoryStore, idx: IndexManager) -> None:
        p = PlannerEngine(store, idx, _dummy_embed)
        p._client = MagicMock()
        p._client.chat.completions.create.side_effect = RuntimeError("API error")

        result, trace = p.classify_intent("hello")
        assert result.category == "提问"
        assert result.confidence == 0.3

    def test_returns_fallback_on_no_client(self, store: MemoryStore, idx: IndexManager) -> None:
        p = PlannerEngine(store, idx, _dummy_embed)
        p._client = MagicMock()
        p._client.chat.completions.create.side_effect = RuntimeError("API unavailable")

        result, trace = p.classify_intent("hello")
        assert result.category == "提问"
        assert result.confidence == 0.3


class TestPlannerDisabled:
    @patch("src.planner.intent.settings")
    def test_skips_when_disabled(
        self, mock_settings: MagicMock, store: MemoryStore, idx: IndexManager
    ) -> None:
        mock_settings.planner_enabled = False
        p = PlannerEngine(store, idx, _dummy_embed)
        result, trace = p.classify_intent("hello")
        assert result.category == "提问"
        assert result.confidence == 0.0

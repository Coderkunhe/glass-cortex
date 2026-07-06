from __future__ import annotations

from pathlib import Path
from typing import cast
from unittest.mock import MagicMock

import numpy as np
import pytest

from src.memory.fact import FactExtractor
from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.token_ledger import TokenLedger


def _dummy_embed(text: str) -> np.ndarray:
    return np.ones(384, dtype=np.float32)


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test.db"))
    s.init_db()
    return s


@pytest.fixture
def idx() -> IndexManager:
    return IndexManager()


@pytest.fixture
def extractor(store: MemoryStore, idx: IndexManager) -> FactExtractor:
    return FactExtractor(store, idx, _dummy_embed)


# ── 三元组解析 ──


class TestParseTriples:
    def test_parses_valid_triple_json(self) -> None:
        raw = '[{"subject": "用户", "relation": "喜欢", "object": "布偶猫"}]'
        triples, err = FactExtractor._parse_triples(raw)
        assert err is None
        assert len(triples) == 1
        assert triples[0].subject == "用户"
        assert triples[0].relation == "喜欢"
        assert triples[0].object == "布偶猫"

    def test_parses_multiple_triples(self) -> None:
        raw = (
            '[{"subject": "用户", "relation": "喜欢", "object": "猫"},'
            ' {"subject": "用户", "relation": "工作地点", "object": "北京"}]'
        )
        triples, err = FactExtractor._parse_triples(raw)
        assert err is None
        assert len(triples) == 2

    def test_empty_array(self) -> None:
        triples, err = FactExtractor._parse_triples("[]")
        assert err is None
        assert triples == []

    def test_malformed_json_fallback(self) -> None:
        raw = '前言 [{"subject": "用户", "relation": "职业", "object": "工程师"}] 后语'
        triples, err = FactExtractor._parse_triples(raw)
        assert err is None
        assert len(triples) == 1
        assert triples[0].object == "工程师"

    def test_completely_invalid_returns_empty(self) -> None:
        triples, err = FactExtractor._parse_triples("不是 JSON")
        assert err is not None
        assert triples == []

    def test_applies_entity_normalization(self) -> None:
        raw = '[{"subject": "王老师", "relation": "喜欢", "object": "猫咪"}]'
        triples, err = FactExtractor._parse_triples(raw)
        assert err is None
        assert triples[0].subject == "王"  # 去掉了"老师"


# ── API 调用 ──


class TestExtractViaAPI:
    def test_extracts_triples_from_conversation(self, extractor: FactExtractor) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = (
            '[{"subject": "用户", "relation": "喜欢", "object": "布偶猫"},'
            ' {"subject": "用户", "relation": "养了", "object": "两只猫"}]'
        )
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        triples, api_trace = extractor._extract_via_api("我喜欢布偶猫，养了两只", "真可爱！", [])
        assert len(triples) == 2
        assert triples[0].subject == "用户"
        assert triples[0].relation == "喜欢"
        assert "system_prompt" in api_trace
        assert "user_prompt" in api_trace
        assert api_trace["raw_response"] is not None

    def test_empty_response_returns_empty_list(self, extractor: FactExtractor) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        triples, api_trace = extractor._extract_via_api("你好", "你好！", [])
        assert triples == []
        assert api_trace["parse_error"] is None

    def test_includes_existing_facts_in_prompt(self, extractor: FactExtractor) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        existing = [{"content": "用户 — 喜欢 → 布偶猫", "confidence": 0.8}]
        _, api_trace = extractor._extract_via_api("你好", "你好！", existing)  # type: ignore[arg-type]

        assert "用户 — 喜欢 → 布偶猫" in str(api_trace["user_prompt"])

    def test_loss_detection_in_prompt(self, extractor: FactExtractor) -> None:
        """信息丢失检测开关打开时，prompt 包含完整性自检指令。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        _, api_trace = extractor._extract_via_api("test", "test", [])
        assert "复查" in str(api_trace["system_prompt"])

    def test_records_token_usage(self, extractor: FactExtractor) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 200
        mock_response.usage.completion_tokens = 10
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        ledger = TokenLedger()
        extractor.set_ledger(ledger)
        _, api_trace = extractor._extract_via_api("test", "test", [])
        assert ledger.total_tokens == 210
        assert ledger.last_usage is not None
        assert ledger.last_usage.call_point == "fact_extraction"
        token_usage = cast(dict[str, object], api_trace["token_usage"])
        assert token_usage is not None
        assert token_usage["prompt_tokens"] == 200


# ── 存储与去重 ──


class TestExtractAndStore:
    def test_stores_triple_and_returns_id(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "喜欢", "object": "布偶猫"}]'
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("用户说喜欢布偶猫", faiss_id=1)

        fact_ids, trace = extractor.extract_and_store("我喜欢布偶猫", "太好了！", eid)
        assert len(fact_ids) == 1
        assert isinstance(fact_ids[0], int)
        assert trace["status"] == "ok"
        dedup = cast(list[dict[str, object]], trace["dedup_results"])
        assert len(dedup) == 1
        assert dedup[0]["action"] == "new"

        facts = store.get_all_facts()
        assert len(facts) == 1
        assert facts[0]["content"] == "用户 — 喜欢 → 布偶猫"
        assert facts[0]["source_episode_id"] == eid

    def test_exact_match_boosts_confidence_not_duplicate(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        # First: store "用户 — 喜欢 → 布偶猫"
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "喜欢", "object": "布偶猫"}]'
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("第一次提到布偶猫", faiss_id=1)
        _, trace1 = extractor.extract_and_store("我喜欢布偶猫", "很好", eid)
        assert cast(list[dict[str, object]], trace1["dedup_results"])[0]["action"] == "new"

        # Second: same triple extracted again
        eid2 = store.add_episode("第二次提到布偶猫", faiss_id=2)
        _, trace2 = extractor.extract_and_store("布偶猫真的好可爱", "是的呢", eid2)
        assert cast(list[dict[str, object]], trace2["dedup_results"])[0]["action"] == "merge"

        facts = store.get_all_facts()
        assert len(facts) == 1  # deduped
        assert facts[0]["confidence"] > 0.7

    def test_conflict_detection_reduces_confidence(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        # First: "用户 — 工作地点 → 北京"
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "工作地点", "object": "北京"}]'
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("在北京工作", faiss_id=1)
        _, trace1 = extractor.extract_and_store("我在北京工作", "好的", eid)
        assert cast(list[dict[str, object]], trace1["dedup_results"])[0]["action"] == "new"

        # Second: same (s,r) but different o → conflict
        mock_response2 = MagicMock()
        mock_response2.choices = [MagicMock()]
        mock_response2.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "工作地点", "object": "上海"}]'
        mock_client.chat.completions.create.return_value = mock_response2

        eid2 = store.add_episode("现在在上海工作", faiss_id=2)
        _, trace2 = extractor.extract_and_store("我现在在上海工作了", "明白了", eid2)
        assert cast(list[dict[str, object]], trace2["dedup_results"])[0]["action"] == "conflict"

        facts = store.get_all_facts()
        # Both stored (new fact created with reduced confidence)
        assert len(facts) == 2
        # Original fact confidence reduced by penalty
        orig = [f for f in facts if "北京" in str(f["content"])][0]
        new_fact = [f for f in facts if "上海" in str(f["content"])][0]
        assert orig["confidence"] < 0.6  # reduced from 0.6
        assert new_fact["confidence"] < 0.6  # stored with penalty

    def test_old_format_data_skipped_in_structured_matching(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """旧格式事实（无法解析为 Triple）被跳过，新 triple 正常存储。"""
        # Pre-populate old-format fact
        store.add_fact(content="用户喜欢猫", confidence=0.5)

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "喜欢", "object": "猫"}]'
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("用户喜欢猫", faiss_id=1)
        fact_ids, trace = extractor.extract_and_store("我喜欢猫", "好的", eid)
        assert len(fact_ids) == 1

        facts = store.get_all_facts()
        # Old fact stays + new triple-format fact created
        assert len(facts) == 2

    def test_extraction_failure_graceful(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = OSError("API down")
        extractor._client = mock_client

        eid = store.add_episode("test", faiss_id=1)
        fact_ids, trace = extractor.extract_and_store("hello", "hi", eid)
        assert fact_ids == []
        assert trace["status"] == "error"


# ── 缓存命中 ──


class TestFactExtractionCache:
    def test_cache_hit_skips_api_call(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """相同输入第二次调用不触发 LLM API，直接返回缓存结果。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 200
        mock_response.usage.completion_tokens = 20
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("首次消息", faiss_id=1)
        fids1, trace1 = extractor.extract_and_store("我喜欢布偶猫", "真好", eid)
        assert fids1 == []
        assert mock_client.chat.completions.create.call_count == 1

        # 第二次相同输入 + 相同 fact 状态 → 缓存命中，不调 API
        eid2 = store.add_episode("再次消息", faiss_id=2)
        fids2, trace2 = extractor.extract_and_store("我喜欢布偶猫", "真好", eid2)
        assert fids2 == []
        # API 调用次数未增加
        assert mock_client.chat.completions.create.call_count == 1
        # trace 标记缓存命中
        assert trace2.get("cache_hit") is True

    def test_cache_hit_records_token_savings(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """缓存命中时向 TokenLedger 记录节省的 token 量。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 150
        mock_response.usage.completion_tokens = 15
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        ledger = TokenLedger()
        extractor.set_ledger(ledger)

        eid = store.add_episode("msg", faiss_id=1)
        extractor.extract_and_store("hello", "world", eid)
        # 第一次调用：fact_extraction 记录
        assert ledger.total_tokens == 165

        eid2 = store.add_episode("msg2", faiss_id=2)
        extractor.extract_and_store("hello", "world", eid2)
        # 第二次调用：cache_hit 归入 fact_extraction（保留来源 call_point）
        summary = ledger.summary()
        assert "fact_extraction" in summary
        # prompt_tokens = 第一次 150 + cache_hit 165 = 315
        assert summary["fact_extraction"]["prompt_tokens"] == 315
        # completion_tokens = 第一次 15 + cache_hit 0 = 15
        assert summary["fact_extraction"]["completion_tokens"] == 15

    def test_cache_miss_when_facts_change(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """事实集合变化后，相同用户消息仍触发 API 调用（缓存 miss）。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 100
        mock_response.usage.completion_tokens = 10
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("msg", faiss_id=1)
        extractor.extract_and_store("hello", "world", eid)
        assert mock_client.chat.completions.create.call_count == 1

        # 新增一个 fact → fact_state_hash 变化
        store.add_fact(content="用户 — 喜欢 → 猫", confidence=0.5)

        eid2 = store.add_episode("msg2", faiss_id=2)
        extractor.extract_and_store("hello", "world", eid2)
        # fact 集合变了，缓存 miss，再次调 API
        assert mock_client.chat.completions.create.call_count == 2

    def test_cache_hit_trace_markers(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """缓存命中时 trace 保留原始 API 信息并标记 cache_hit。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "[]"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 120
        mock_response.usage.completion_tokens = 30
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client
        extractor.set_ledger(TokenLedger())

        eid = store.add_episode("msg", faiss_id=1)
        extractor.extract_and_store("user msg", "assistant reply", eid)

        eid2 = store.add_episode("msg2", faiss_id=2)
        _, trace = extractor.extract_and_store("user msg", "assistant reply", eid2)

        assert trace.get("cache_hit") is True
        # 缓存命中时仍保留原始 token_usage
        tu = cast(dict[str, object], trace["token_usage"])
        assert tu["prompt_tokens"] == 120
        assert tu["completion_tokens"] == 30


# ── 置信度日志 ──


class TestConfidenceLogging:
    def test_merge_logs_confidence_change(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """Exact match merge 后，置信度变更被记录到 fact_confidence_log。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "喜欢", "object": "布偶猫"}]'
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("首次提到布偶猫", faiss_id=1)
        extractor.extract_and_store("我喜欢布偶猫", "很好", eid)

        facts = store.get_all_facts()
        assert len(facts) == 1
        fid = facts[0]["id"]

        # Initial log
        history = store.get_fact_confidence_history(fid)
        assert len(history) == 1
        assert history[0]["reason"] == "initial"
        assert history[0]["confidence_before"] == 0.0

        # Second extraction — same fact → merge
        eid2 = store.add_episode("再次提到布偶猫", faiss_id=2)
        extractor.extract_and_store("布偶猫好可爱", "是的", eid2)

        history = store.get_fact_confidence_history(fid)
        assert len(history) == 2
        assert history[1]["reason"] == "merge"
        assert cast(float, history[1]["confidence_after"]) > cast(
            float, history[1]["confidence_before"]
        )

    def test_conflict_logs_confidence_penalty(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """Conflict 检测后，旧事实被降权并记录日志。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "工作地点", "object": "北京"}]'
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("在北京工作", faiss_id=1)
        extractor.extract_and_store("我在北京工作", "好的", eid)

        # Conflicting fact
        mock_response2 = MagicMock()
        mock_response2.choices = [MagicMock()]
        mock_response2.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "工作地点", "object": "上海"}]'
        mock_client.chat.completions.create.return_value = mock_response2

        eid2 = store.add_episode("调到上海", faiss_id=2)
        extractor.extract_and_store("我调到上海了", "明白了", eid2)

        facts = store.get_all_facts()
        assert len(facts) == 2

        # Original fact should have a conflict log entry
        orig = [f for f in facts if "北京" in str(f["content"])][0]
        history = store.get_fact_confidence_history(orig["id"])
        reasons = [h["reason"] for h in history]
        assert "conflict" in reasons

    def test_new_fact_logs_initial_confidence(
        self, store: MemoryStore, idx: IndexManager, extractor: FactExtractor
    ) -> None:
        """新事实创建时记录 initial 日志。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[
            0
        ].message.content = '[{"subject": "用户", "relation": "喜欢", "object": "猫"}]'
        mock_client.chat.completions.create.return_value = mock_response
        extractor._client = mock_client

        eid = store.add_episode("喜欢猫", faiss_id=1)
        fact_ids, _ = extractor.extract_and_store("我喜欢猫", "好的", eid)

        assert len(fact_ids) == 1
        history = store.get_fact_confidence_history(fact_ids[0])
        assert len(history) == 1
        assert history[0]["reason"] == "initial"
        assert history[0]["confidence_before"] == 0.0
        assert cast(float, history[0]["confidence_after"]) > 0.0

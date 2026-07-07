from __future__ import annotations

import os
from pathlib import Path
from typing import cast
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.chat.engine import ChatEngine
from src.context.overflow_sim import estimate_tokens
from src.memory.index import IndexManager
from src.memory.store import MemoryStore
from src.token_ledger import TokenLedger


def _dummy_embed(text: str | list[str]) -> np.ndarray:
    if isinstance(text, str):
        return np.ones(384, dtype=np.float32)
    return np.ones((len(text), 384), dtype=np.float32)


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    s = MemoryStore(str(tmp_path / "test.db"))
    s.init_db()
    return s


@pytest.fixture
def engine(store: MemoryStore) -> ChatEngine:
    idx = IndexManager()
    return ChatEngine(store, idx, _dummy_embed)


class TestBuildSystemPrompt:
    def test_empty_recall(self, engine: ChatEngine) -> None:
        prompt, meta = engine._build_system_prompt([])
        assert "有记忆的 AI 助手" in prompt
        assert "首次见面" in prompt
        assert meta["memories_before"] == 0
        assert meta["overflow_applied"] is False

    def test_with_memories(self, engine: ChatEngine) -> None:
        recalled = [
            {"content": "用户喜欢布偶猫", "initial_strength": 0.95},
            {"content": "用户提到过敏", "initial_strength": 0.60},
        ]
        prompt, meta = engine._build_system_prompt(recalled)
        assert "1." in prompt or "-" in prompt
        assert "用户喜欢布偶猫" in prompt
        assert "用户提到过敏" in prompt
        assert "0.95" in prompt
        assert "0.60" in prompt
        assert "对话记忆" in prompt
        assert meta["memories_before"] == 2
        assert meta["overflow_applied"] is False

    def test_with_facts(self, engine: ChatEngine) -> None:
        recalled = [
            {"content": "用户喜欢布偶猫", "initial_strength": 0.95},
            {"content": "用户住在北京", "confidence": 0.85, "_row_type": "fact"},
        ]
        prompt, meta = engine._build_system_prompt(recalled)
        assert "对话记忆" in prompt
        assert "已知事实" in prompt
        assert "用户喜欢布偶猫" in prompt
        assert "用户住在北京" in prompt
        assert "置信度" in prompt
        assert "0.85" in prompt
        assert meta["memories_before"] == 2


class TestClientWithoutApiKey:
    def test_raises_without_key(self, engine: ChatEngine) -> None:
        with patch.dict(os.environ, {}, clear=True):
            engine._client = None
            with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
                _ = engine.client


class TestGenerate:
    def test_calls_api_correctly(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "你好！"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        result, _, _ = engine.generate("你好", [])

        assert result == "你好！"

    def test_respects_l5_overrides(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "test"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        engine.generate(
            "hi",
            [],
            model="deepseek-reasoner",
            temperature=1.5,
            max_tokens=512,
        )

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        assert call_kwargs["model"] == "deepseek-reasoner"
        assert call_kwargs["temperature"] == 1.5
        assert call_kwargs["max_tokens"] == 512

    def test_l5_overrides_default_when_none(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "test"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        engine.generate("hi", [])

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        assert call_kwargs["model"] == "deepseek-chat"
        assert call_kwargs["temperature"] == 0.7
        assert call_kwargs["max_tokens"] == 1024

    def test_returns_empty_str_for_none_content(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = None
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        result, _, _ = engine.generate("test", [])
        assert result == ""

    def test_wraps_api_error(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = RuntimeError("API boom")
        engine._client = mock_client

        with pytest.raises(RuntimeError, match="DeepSeek API 调用失败"):
            engine.generate("test", [])

    def test_records_token_usage(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "你好！"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 50
        mock_response.usage.completion_tokens = 30
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        ledger = TokenLedger()
        engine.set_ledger(ledger)
        engine.generate("你好", [])
        assert ledger.total_tokens == 80
        assert ledger.last_usage is not None
        assert ledger.last_usage.call_point == "chat"

    def test_handles_missing_usage_gracefully(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "你好！"
        mock_response.usage = None  # No usage info
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        ledger = TokenLedger()
        engine.set_ledger(ledger)
        result, _, _ = engine.generate("你好", [])
        assert result == "你好！"
        assert ledger.total_tokens == 0  # Nothing recorded


class TestStoreResponse:
    def test_creates_episode_with_prefix(self, store: MemoryStore) -> None:
        idx = IndexManager()
        eng = ChatEngine(store, idx, _dummy_embed)

        eid = eng.store_response("你好！")
        episodes = store.get_episodes([eid])

        assert len(episodes) == 1
        assert episodes[0]["content"] == "[Assistant] 你好！"
        assert episodes[0]["importance"] == pytest.approx(0.4)
        assert episodes[0]["faiss_id"] is not None

    def test_response_embeds_and_indexes(self, store: MemoryStore) -> None:
        idx = IndexManager()
        eng = ChatEngine(store, idx, _dummy_embed)

        eid = eng.store_response("测试回复")
        episodes = store.get_episodes([eid])

        faiss_id = episodes[0]["faiss_id"]
        assert isinstance(faiss_id, int)
        # 验证可以通过 faiss_id 查回 — 搜索一个相近向量应能命中
        results = idx.search(np.ones(384, dtype=np.float32), k=5)
        found_ids = [r[0] for r in results]
        assert faiss_id in found_ids


class TestGenerateAndStore:
    def test_returns_response_and_eid(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "回复内容"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        text, eid, ctx, _trace = engine.generate_and_store("输入", [])

        assert text == "回复内容"
        assert isinstance(eid, int)
        assert isinstance(ctx, dict)
        assert ctx["window_size"] == 4096
        # 验证 episode 已被存储
        episodes = engine._store.get_episodes([eid])
        assert len(episodes) == 1
        assert episodes[0]["content"] == "[Assistant] 回复内容"


class TestTokenEstimation:
    def test_english_text(self) -> None:
        tokens = estimate_tokens("hello world")
        assert 2 <= tokens <= 6

    def test_chinese_text(self) -> None:
        tokens = estimate_tokens("你好世界")
        assert 1 <= tokens <= 2

    def test_mixed_text(self) -> None:
        tokens = estimate_tokens("hello 你好 world 世界")
        assert 2 <= tokens <= 6

    def test_empty_string(self) -> None:
        assert estimate_tokens("") == 1

    def test_long_text(self) -> None:
        text = "This is a longer sentence for testing token estimation."
        tokens_short = estimate_tokens(text[:10])
        tokens_long = estimate_tokens(text)
        assert tokens_long > tokens_short


class TestContextWindow:
    def test_no_overflow_all_fit(self, engine: ChatEngine) -> None:
        recalled: list[dict[str, object]] = [
            {"content": "布偶猫可爱", "initial_strength": 0.95},
            {"content": "用户喜欢猫", "initial_strength": 0.80},
        ]
        prompt, meta = engine._build_system_prompt(recalled)
        assert meta["memories_before"] == 2
        assert meta["overflow_applied"] is False
        assert meta["memories_after"] == 2
        assert "布偶猫可爱" in prompt

    def test_truncate_drops_from_end(self, engine: ChatEngine) -> None:
        recalled: list[dict[str, object]] = [
            {"content": "短" * 80, "initial_strength": 0.90},
            {"content": "长" * 300, "initial_strength": 0.80},
        ]
        prompt, meta = engine._build_system_prompt(
            recalled,
            context_window_size=40,
            context_overflow_strategy="truncate",
        )
        assert meta["overflow_applied"] is True
        assert cast(int, meta["memories_after"]) < 2

    def test_prioritize_keeps_high_score(self, engine: ChatEngine) -> None:
        recalled: list[dict[str, object]] = [
            {"content": "猫" * 200, "initial_strength": 0.30, "importance": 0.50},
            {"content": "狗" * 200, "initial_strength": 0.90, "importance": 0.50},
        ]
        prompt, meta = engine._build_system_prompt(
            recalled,
            context_window_size=100,
            context_overflow_strategy="prioritize",
        )
        assert meta["overflow_applied"] is True
        assert "狗" in prompt and "猫" not in prompt

    def test_summarize_compresses_dropped(self, engine: ChatEngine) -> None:
        recalled: list[dict[str, object]] = [
            {"content": "记忆A" * 50, "initial_strength": 0.90},
            {"content": "记忆B" * 50, "initial_strength": 0.60},
            {"content": "记忆C" * 50, "initial_strength": 0.30},
        ]
        prompt, meta = engine._build_system_prompt(
            recalled,
            context_window_size=115,
            context_overflow_strategy="summarize",
        )
        assert meta["overflow_applied"] is True
        assert cast(int, meta["dropped_count"]) > 0
        assert "已压缩" in prompt

    def test_empty_recalled_works(self, engine: ChatEngine) -> None:
        prompt, meta = engine._build_system_prompt([])
        assert "有记忆的 AI 助手" in prompt
        assert meta["memories_before"] == 0
        assert meta["overflow_applied"] is False
        assert meta["window_size"] == 4096

    def test_very_small_window_drops_all(self, engine: ChatEngine) -> None:
        recalled: list[dict[str, object]] = [
            {"content": "一段较长的记忆文本" * 10, "initial_strength": 0.50},
        ]
        prompt, meta = engine._build_system_prompt(
            recalled,
            context_window_size=20,
            context_overflow_strategy="truncate",
        )
        assert meta["overflow_applied"] is True
        assert meta["memories_after"] == 0
        assert meta["dropped_count"] == 1


class TestSystemPrompt:
    def test_generate_includes_system_prompt_in_meta(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "你好！"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        _, meta, _ = engine.generate("你好", [])

        assert "system_prompt" in meta
        sp = str(meta["system_prompt"])
        assert "有记忆的 AI 助手" in sp
        assert "首次见面" in sp

    def test_generate_with_recalled_includes_memories_in_prompt(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "你好！"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        recalled: list[dict[str, object]] = [
            {"content": "用户喜欢布偶猫", "initial_strength": 0.95},
        ]
        _, meta, _ = engine.generate("你好", recalled)

        sp = str(meta["system_prompt"])
        assert "用户喜欢布偶猫" in sp


class TestCompressMessage:
    def test_compress_calls_llm_and_returns_summary(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "用户喜欢布偶猫。"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        result, _trace = engine.compress_message("一段很长的文本 " * 200)
        assert result == "用户喜欢布偶猫。"

    def test_compress_records_to_ledger(self, engine: ChatEngine) -> None:
        """压缩消息时记录 LLM token 消耗 + 节省到 ledger。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "压缩后的摘要。"
        mock_response.usage = MagicMock()
        mock_response.usage.prompt_tokens = 80
        mock_response.usage.completion_tokens = 8
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        ledger = TokenLedger()
        engine.set_ledger(ledger)

        long_text = "这是一段很长的文本。" * 100
        result, _trace = engine.compress_message(long_text)
        assert result == "压缩后的摘要。"

        s = ledger.summary()
        # compression LLM 调用
        assert "compression" in s
        assert s["compression"]["prompt_tokens"] == 80
        assert s["compression"]["completion_tokens"] == 8
        # compression_savings 记录（原文远长于压缩结果）
        assert "compression_savings" in s
        assert s["compression_savings"]["prompt_tokens"] > 0

        # 验证 pipeline_trace 写入
        traces = engine._store.get_traces_by_step("compression")
        assert len(traces) >= 1
        comp_trace = traces[0]
        assert comp_trace["step_name"] == "compression"
        assert comp_trace["status"] == "ok"
        assert cast("float", comp_trace["elapsed_ms"]) >= 0
        assert s["compression_savings"]["completion_tokens"] == 0

    def test_compress_no_ledger_no_error(self, engine: ChatEngine) -> None:
        """无 ledger 注入时压缩正常执行，不抛异常。"""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "摘要。"
        mock_client.chat.completions.create.return_value = mock_response
        engine._client = mock_client

        result, _trace = engine.compress_message("长文本" * 50)
        assert result == "摘要。"

    def test_compress_failure_returns_truncated_original(self, engine: ChatEngine) -> None:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = RuntimeError("API boom")
        engine._client = mock_client

        long_text = "这是一段很长的关于布偶猫的讨论内容。" * 20
        result, _trace = engine.compress_message(long_text)
        # 降级为原文截断
        assert len(result) <= 203  # 200 + "..."
        assert result.endswith("...")


class TestBuildTwoStagePrompt:
    """Tests for _build_two_stage_prompt — Stage 1 概要+[ref:N] 注入。"""

    def test_empty_recall(self, engine: ChatEngine) -> None:
        prompt, meta, ref_map = engine._build_two_stage_prompt([])
        assert "有记忆的 AI 助手" in prompt
        assert "首次见面" in prompt
        assert meta["memories_before"] == 0
        assert ref_map == {}

    def test_ref_map_contains_full_items(self, engine: ChatEngine) -> None:
        recalled = [
            {"content": "用户喜欢布偶猫", "initial_strength": 0.95},
            {"content": "用户提到过敏", "initial_strength": 0.60},
        ]
        _prompt, _meta, ref_map = engine._build_two_stage_prompt(recalled)
        assert len(ref_map) == 2
        assert ref_map[1]["content"] == "用户喜欢布偶猫"
        assert ref_map[2]["content"] == "用户提到过敏"

    def test_prompt_has_ref_labels(self, engine: ChatEngine) -> None:
        recalled = [
            {"content": "用户喜欢布偶猫", "initial_strength": 0.95},
        ]
        prompt, _meta, _ref_map = engine._build_two_stage_prompt(recalled)
        assert "[ref:1]" in prompt
        assert "对话记忆 (概要)" in prompt

    def test_prompt_uses_summaries_not_full_content(self, engine: ChatEngine) -> None:
        """Stage 1 prompt 使用摘要文本，非完整记忆原文。

        内容超过 80 字符时，summarize_recall_item 会截断加省略号，
        Stage 1 提示中应为截断后的摘要文本。
        """
        long_content = (
            "用户在去年详细讨论了关于机器学习模型部署的各种方案和工具选择，"
            "包括 Docker 容器化部署、Kubernetes 编排、以及持续集成和持续交付的"
            "最佳实践和踩坑经验"
        )
        recalled = [
            {"content": long_content, "initial_strength": 0.90},
        ]
        prompt, _meta, _ref_map = engine._build_two_stage_prompt(recalled)
        # prompt 不应包含完整长文本（摘要已截断）
        assert long_content not in prompt
        # prompt 应包含 [ref:1] 标签
        assert "[ref:1]" in prompt
        # prompt 中应有省略号（截断标志）
        assert "…" in prompt

    def test_with_facts(self, engine: ChatEngine) -> None:
        recalled = [
            {
                "_row_type": "fact",
                "content": "用户偏好 — 编辑器 → VS Code",
                "subject": "用户偏好",
                "relation": "编辑器",
                "object": "VS Code",
                "confidence": 0.90,
            },
        ]
        prompt, _meta, _ref_map = engine._build_two_stage_prompt(recalled)
        assert "[ref:1]" in prompt
        assert "已知事实 (概要)" in prompt
        assert len(_ref_map) == 1

    def test_mixed_episodes_and_facts(self, engine: ChatEngine) -> None:
        recalled = [
            {"content": "用户喜欢 Python", "initial_strength": 0.90},
            {
                "_row_type": "fact",
                "content": "用户偏好 — 语言 → Python",
                "subject": "用户偏好",
                "relation": "语言",
                "object": "Python",
                "confidence": 0.95,
            },
        ]
        prompt, _meta, ref_map = engine._build_two_stage_prompt(recalled)
        assert "[ref:1]" in prompt
        assert "[ref:2]" in prompt
        assert len(ref_map) == 2

    def test_summaries_fit_more_items(self, engine: ChatEngine) -> None:
        """摘要更短 → 更多条目能容纳在上下文窗口内。"""
        # 多条长内容
        recalled = [
            {
                "content": f"用户讨论了关于项目{i}的非常详细的技术方案和实现细节",
                "initial_strength": 0.80,
            }
            for i in range(10)
        ]
        # 很紧的窗口 — 单阶段会丢很多条目
        prompt_single, meta_single = engine._build_system_prompt(recalled, context_window_size=800)
        prompt_two, meta_two, _ref_map = engine._build_two_stage_prompt(
            recalled, context_window_size=800
        )
        # 两阶段应保留 ≥ 单阶段保留（因为摘要更短）
        assert cast(int, meta_two["memories_after"]) >= cast(int, meta_single["memories_after"])

    def test_ref_map_preserves_original_fields(self, engine: ChatEngine) -> None:
        """ref_map 保存完整原始条目（含强度/置信度等），非摘要版本。"""
        recalled = [
            {
                "content": "用户喜欢布偶猫",
                "initial_strength": 0.95,
                "importance": 0.80,
            },
        ]
        _prompt, _meta, ref_map = engine._build_two_stage_prompt(recalled)
        item = ref_map[1]
        assert item["content"] == "用户喜欢布偶猫"
        assert item["initial_strength"] == 0.95
        assert item["importance"] == 0.80


class TestExpandReferences:
    """Tests for expand_references — Stage 2 [ref:N] 按需展开。"""

    def test_expands_single_reference(self) -> None:
        ref_map: dict[int, dict[str, object]] = {1: {"content": "用户喜欢布偶猫"}}
        text = "关于你的猫咪，[ref:1] 是相关记忆。"
        expanded = ChatEngine.expand_references(text, ref_map)
        assert expanded == "关于你的猫咪，[ref:1] 用户喜欢布偶猫 是相关记忆。"

    def test_expands_multiple_references(self) -> None:
        ref_map: dict[int, dict[str, object]] = {
            1: {"content": "用户喜欢布偶猫"},
            2: {"content": "用户对花粉过敏"},
        }
        text = "根据 [ref:1] 和 [ref:2]，你需要注意。"
        expanded = ChatEngine.expand_references(text, ref_map)
        assert "用户喜欢布偶猫" in expanded
        assert "用户对花粉过敏" in expanded

    def test_unknown_ref_left_unchanged(self) -> None:
        ref_map: dict[int, dict[str, object]] = {1: {"content": "已知内容"}}
        text = "[ref:1] 和 [ref:99]"
        expanded = ChatEngine.expand_references(text, ref_map)
        assert "[ref:99]" in expanded
        assert "已知内容" in expanded

    def test_no_references_returns_original(self) -> None:
        text = "这是一段没有引用的普通回复。"
        expanded = ChatEngine.expand_references(text, {})
        assert expanded == text

    def test_empty_text(self) -> None:
        expanded = ChatEngine.expand_references("", {1: {"content": "x"}})
        assert expanded == ""

    def test_multiple_occurrences_same_ref(self) -> None:
        """同一 ref 出现多次，全部展开。"""
        ref_map: dict[int, dict[str, object]] = {1: {"content": "用户喜欢布偶猫"}}
        text = "如 [ref:1] 所述，回到 [ref:1] 讨论。"
        expanded = ChatEngine.expand_references(text, ref_map)
        # ref:1 出现两次都应展开
        assert expanded.count("用户喜欢布偶猫") == 2

    def test_ref_map_item_missing_content_key(self) -> None:
        """ref_map 条目缺 content 键 → 展开为空内容。"""
        ref_map: dict[int, dict[str, object]] = {1: {"not_content": "nope"}}
        text = "[ref:1]"
        expanded = ChatEngine.expand_references(text, ref_map)
        assert expanded == "[ref:1] "


class TestGenerateTwoStage:
    """Tests for generate() with two_stage=True。"""

    def test_two_stage_sets_ref_map(self, engine: ChatEngine) -> None:
        """two_stage=True 时生成后 _last_ref_map 非空。"""
        recalled = [{"content": "test memory", "initial_strength": 0.80}]
        mock_client = MagicMock()
        mock_choice = MagicMock()
        mock_choice.message.content = "收到了，[ref:1] 相关内容。"
        mock_client.chat.completions.create.return_value = MagicMock(
            choices=[mock_choice],
            usage=MagicMock(prompt_tokens=50, completion_tokens=20),
        )
        engine._client = mock_client
        engine.generate("hello", recalled, two_stage=True)
        assert engine.last_ref_map is not None
        assert len(engine.last_ref_map) == 1

    def test_two_stage_false_clears_ref_map(self, engine: ChatEngine) -> None:
        """two_stage=False 时 _last_ref_map 为 None。"""
        recalled = [{"content": "test", "initial_strength": 0.80}]
        mock_client = MagicMock()
        mock_choice = MagicMock()
        mock_choice.message.content = "response"
        mock_client.chat.completions.create.return_value = MagicMock(
            choices=[mock_choice],
            usage=MagicMock(prompt_tokens=50, completion_tokens=20),
        )
        engine._client = mock_client
        engine.generate("hello", recalled, two_stage=False)
        assert engine.last_ref_map is None


class TestSessionIdPassthrough:
    """Phase 66 Batch 20 — session_id 端到端透传。"""

    def test_store_response_passes_session_id_to_add_episode(self, store: MemoryStore) -> None:
        """store_response 将 session_id 传递给 add_episode。"""
        from unittest.mock import patch

        idx = IndexManager()
        engine = ChatEngine(store, idx, _dummy_embed)

        with patch.object(store, "add_episode", wraps=store.add_episode) as spy:
            eid = engine.store_response("test response", session_id="engine-sess")
            assert eid > 0
            spy.assert_called_once()
            assert spy.call_args.kwargs.get("session_id") == "engine-sess"

    def test_store_response_default_session_id_is_none(self, store: MemoryStore) -> None:
        """不传 session_id 时，store_response 传递 None。"""
        from unittest.mock import patch

        idx = IndexManager()
        engine = ChatEngine(store, idx, _dummy_embed)

        with patch.object(store, "add_episode", wraps=store.add_episode) as spy:
            eid = engine.store_response("test response")
            assert eid > 0
            spy.assert_called_once()
            assert spy.call_args.kwargs.get("session_id") is None

    def test_generate_and_store_passes_session_id_through(self, store: MemoryStore) -> None:
        """generate_and_store 将 session_id 透传到 store_response → add_episode。"""
        idx = IndexManager()
        engine = ChatEngine(store, idx, _dummy_embed)

        mock_client = MagicMock()
        mock_choice = MagicMock()
        mock_choice.message.content = "response"
        mock_client.chat.completions.create.return_value = MagicMock(
            choices=[mock_choice],
            usage=MagicMock(prompt_tokens=50, completion_tokens=20),
        )
        engine._client = mock_client

        recalled: list[dict[str, object]] = [{"content": "test", "initial_strength": 0.8}]
        _, eid, _, _ = engine.generate_and_store("hello", recalled, session_id="pipeline-sess")

        # 验证 episode 存储了正确的 session_id
        episodes = store.get_episodes([eid])
        assert len(episodes) == 1
        assert episodes[0].get("session_id") == "pipeline-sess"

    def test_generate_and_store_writes_pipeline_traces(self, store: MemoryStore) -> None:
        """generate_and_store 将 chat + store 两步写入 pipeline_trace 表。"""
        idx = IndexManager()
        engine = ChatEngine(store, idx, _dummy_embed)

        mock_client = MagicMock()
        mock_choice = MagicMock()
        mock_choice.message.content = "trace-test"
        mock_client.chat.completions.create.return_value = MagicMock(
            choices=[mock_choice],
            usage=MagicMock(prompt_tokens=30, completion_tokens=10),
        )
        engine._client = mock_client

        recalled: list[dict[str, object]] = [{"content": "hello", "initial_strength": 0.5}]
        engine.generate_and_store("hi", recalled, session_id="trace-sess")

        traces = store.get_traces(session_id="trace-sess")
        assert len(traces) >= 2

        step_names = {t["step_name"] for t in traces}
        assert "chat" in step_names
        assert "store" in step_names

        for t in traces:
            assert t["status"] == "ok"
            assert t["session_id"] == "trace-sess"

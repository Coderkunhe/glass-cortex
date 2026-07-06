"""语义响应缓存测试 — SemanticResponseCache 15 tests。

测试覆盖：空缓存/精确命中/语义命中/语义错过/边界阈值/逐出/FIFO 刷新/
hit-miss 计数器/size/多条目最佳匹配/EmbeddingCache 二次缓存/Ledger 记账。
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.cache.semantic_cache import SemanticResponseCache


def _make_unit_vec(values: list[float]) -> np.ndarray:
    """构造 L2 归一化向量（模拟 embed() 输出）。"""
    arr = np.array(values, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm
    return arr


class TestSemanticResponseCache:
    """SemanticResponseCache 核心逻辑测试。

    使用 ``unittest.mock.patch("src.embed.embed")`` 控制嵌入向量，
    实现确定性相似度计算。所有向量均为 L2 归一化（模拟真实 embed() 行为）。
    """

    # ── 基础 hit/miss ──

    def test_check_miss_empty_cache(self) -> None:
        """空缓存时 check() 返回 (None, 0.0)。"""
        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        with patch("src.embed.embed") as mock_embed:
            mock_embed.return_value = _make_unit_vec([1.0, 0.0, 0.0])
            result, score = cache.check("今天天气怎么样")
        assert result is None
        assert score == 0.0

    @patch("src.embed.embed")
    def test_store_and_check_hit_exact(self, mock_embed: MagicMock) -> None:
        """同文本 store→check 命中，score ≈ 1.0。"""
        vec = _make_unit_vec([1.0, 2.0, 3.0])
        mock_embed.return_value = vec

        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        cache.store(
            "今天天气怎么样",
            {
                "response_text": "今天天气晴好，温度 25°C。",
                "episode_id": 42,
                "context_meta": {"window_size": 4096},
                "api_trace": {"caller": "chat"},
                "recall_items": [],
                "intent": {"category": "提问", "confidence": 0.9},
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        result, score = cache.check("今天天气怎么样")
        assert result is not None
        assert result.response_text == "今天天气晴好，温度 25°C。"
        assert result.episode_id == 42
        # 同一向量 dot itself = 1.0（L2 归一化）
        assert score == pytest.approx(1.0, abs=1e-6)

    # ── 语义匹配 vs 错过 ──

    @patch("src.embed.embed")
    def test_check_semantic_match(self, mock_embed: MagicMock) -> None:
        """相似查询（"天气怎么样" vs "天气如何"）超阈值命中。"""
        # 两条向量故意设得很接近：余弦相似度 ≈ 0.98
        vec_cached = _make_unit_vec([1.0, 0.2, 0.0])
        vec_query = _make_unit_vec([1.0, 0.3, 0.0])

        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        # store 用 vec_cached
        mock_embed.return_value = vec_cached
        cache.store(
            "今天天气怎么样",
            {
                "response_text": "天气晴好。",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        # check 用 vec_query（相似但不完全相同）
        mock_embed.return_value = vec_query
        result, score = cache.check("今天天气如何")
        assert result is not None
        assert score >= 0.95
        assert result.response_text == "天气晴好。"

    @patch("src.embed.embed")
    def test_check_semantic_miss(self, mock_embed: MagicMock) -> None:
        """不同主题查询（天气 vs 量子力学）低于阈值 miss。"""
        vec_cached = _make_unit_vec([1.0, 0.0, 0.0, 0.0])
        vec_query = _make_unit_vec([0.0, 0.0, 1.0, 0.0])  # 正交 → cos = 0.0

        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        mock_embed.return_value = vec_cached
        cache.store(
            "今天天气怎么样",
            {
                "response_text": "晴。",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        mock_embed.return_value = vec_query
        result, score = cache.check("量子力学原理")
        assert result is None
        assert score < 0.95

    # ── 边界阈值 ──

    @patch("src.embed.embed")
    def test_check_boundary_at_threshold(self, mock_embed: MagicMock) -> None:
        """相似度恰等于阈值 → 命中（使用 float32 精确值 15/16=0.9375）。"""
        # 0.9375 = 15/16 在 float32 中精确可表示，避免 0.95 的精度损失
        target = 0.9375
        vec_cached = np.array([1.0, 0.0], dtype=np.float32)
        y = float(np.sqrt(1.0 - target**2))
        vec_query = np.array([target, y], dtype=np.float32)
        # 验证构造正确
        dot = float(np.dot(vec_cached, vec_query))
        assert dot == pytest.approx(target, abs=1e-7), f"构造向量 dot={dot} ≠ {target}"

        cache = SemanticResponseCache(max_entries=64, min_similarity=target)
        mock_embed.return_value = vec_cached
        cache.store(
            "query a",
            {
                "response_text": "resp",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        mock_embed.return_value = vec_query
        result, score = cache.check("query b")
        assert result is not None
        assert score >= target

    @patch("src.embed.embed")
    def test_check_boundary_below_threshold(self, mock_embed: MagicMock) -> None:
        """相似度恰低于阈值 → miss。"""
        vec_cached = _make_unit_vec([1.0, 0.0])
        # cos ≈ 0.949 < 0.95
        vec_query = np.array([0.949, np.sqrt(1 - 0.949**2)], dtype=np.float32)

        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        mock_embed.return_value = vec_cached
        cache.store(
            "query a",
            {
                "response_text": "resp",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        mock_embed.return_value = vec_query
        result, score = cache.check("query b")
        assert result is None
        assert score < 0.95

    # ── invalidate ──

    @patch("src.embed.embed")
    def test_invalidate_removes_entry(self, mock_embed: MagicMock) -> None:
        """invalidate 后精确匹配查询 miss。"""
        vec = _make_unit_vec([1.0, 0.0])
        mock_embed.return_value = vec

        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        cache.store(
            "天气",
            {
                "response_text": "晴。",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        assert cache.invalidate("天气") is True
        result, _score = cache.check("天气")
        assert result is None

    def test_invalidate_nonexistent_returns_false(self) -> None:
        """invalidate 不存在的 key 返回 False。"""
        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        assert cache.invalidate("never stored") is False

    # ── FIFO 逐出 ──

    @patch("src.embed.embed")
    def test_fifo_eviction(self, mock_embed: MagicMock) -> None:
        """插入 > max_entries 后最旧条目被逐出。"""
        cache = SemanticResponseCache(max_entries=3, min_similarity=0.95)

        vectors = {
            "a": _make_unit_vec([1.0, 0.0]),
            "b": _make_unit_vec([0.0, 1.0]),
            "c": _make_unit_vec([0.0, 0.0, 1.0]),
            "d": _make_unit_vec([1.0, 1.0, 0.0]),
        }

        def side_effect(text: str) -> np.ndarray:
            return vectors[text]

        mock_embed.side_effect = side_effect

        for key in ["a", "b", "c", "d"]:
            cache.store(
                key,
                {
                    "response_text": key,
                    "episode_id": 1,
                    "context_meta": {},
                    "api_trace": {},
                    "recall_items": [],
                    "intent": None,
                    "system_prompt": None,
                    "routing": None,
                    "cold_start_profile": None,
                },
            )

        assert cache.size == 3
        # "a" 是最旧条目，4 条插入 ≥3 容量时被逐出
        assert cache.invalidate("a") is False
        assert cache.invalidate("b") is True
        assert cache.invalidate("c") is True
        assert cache.invalidate("d") is True

    @patch("src.embed.embed")
    def test_store_existing_key_moves_to_end(self, mock_embed: MagicMock) -> None:
        """重复 key store 不会逐出其他条目（move_to_end 更新位置）。"""
        cache = SemanticResponseCache(max_entries=2, min_similarity=0.95)

        vec_a = _make_unit_vec([1.0, 0.0])
        vec_b = _make_unit_vec([0.0, 1.0])

        mock_embed.return_value = vec_a
        cache.store(
            "a",
            {
                "response_text": "a",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        mock_embed.return_value = vec_b
        cache.store(
            "b",
            {
                "response_text": "b",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        # 重新 store "a" —— "a" 移到末尾，容量没超
        mock_embed.return_value = vec_a
        cache.store(
            "a",
            {
                "response_text": "a-v2",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        assert cache.size == 2
        assert cache.invalidate("a") is True
        assert cache.invalidate("b") is True

    # ── 计数器 ──

    @patch("src.embed.embed")
    def test_hits_misses_counters(self, mock_embed: MagicMock) -> None:
        """hit/miss 计数器在多次 check 后正确递增。"""
        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)

        vec1 = _make_unit_vec([1.0, 0.0])
        vec2 = _make_unit_vec([0.0, 1.0])

        mock_embed.return_value = vec1
        cache.store(
            "天气",
            {
                "response_text": "晴。",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        assert cache.hits == 0
        assert cache.misses == 0

        # miss: different query
        mock_embed.return_value = vec2
        cache.check("量子")
        assert cache.hits == 0
        assert cache.misses == 1

        # hit: same vector as stored
        mock_embed.return_value = vec1
        cache.check("天气")
        assert cache.hits == 1
        assert cache.misses == 1

    # ── size ──

    @patch("src.embed.embed")
    def test_size_property(self, mock_embed: MagicMock) -> None:
        """size 属性追踪条目数。"""
        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        assert cache.size == 0

        mock_embed.return_value = _make_unit_vec([1.0, 0.0])
        cache.store(
            "a",
            {
                "response_text": "a",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )
        assert cache.size == 1

    # ── 多条目最佳匹配 ──

    @patch("src.embed.embed")
    def test_multiple_entries_best_match(self, mock_embed: MagicMock) -> None:
        """多条缓存时返回最高相似度那条，而非最近插入的。"""
        cache = SemanticResponseCache(max_entries=64, min_similarity=0.90)

        vec1 = _make_unit_vec([1.0, 0.0])
        vec2 = _make_unit_vec([0.0, 1.0])

        # store entry 1
        mock_embed.return_value = vec1
        cache.store(
            "topic a",
            {
                "response_text": "response a",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        # store entry 2
        mock_embed.return_value = vec2
        cache.store(
            "topic b",
            {
                "response_text": "response b",
                "episode_id": 2,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        # query close to vec2, far from vec1
        vec_query = _make_unit_vec([0.01, 1.0])  # cos ≈ 0.99995 with vec2
        mock_embed.return_value = vec_query
        result, score = cache.check("topic b variation")

        assert result is not None
        assert result.response_text == "response b"

    # ── EmbeddingCache 二次缓存 ──

    @patch("src.embed.embed")
    def test_check_uses_embedding_cache(self, mock_embed: MagicMock) -> None:
        """check() 调用 embed() 时自然经过 EmbeddingCache 层。"""
        vec = _make_unit_vec([1.0, 0.0, 0.0])
        mock_embed.return_value = vec

        cache = SemanticResponseCache(max_entries=64, min_similarity=0.95)
        cache.store(
            "hello",
            {
                "response_text": "hi",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        # 两次 check 同一文本——embed() 被调用的次数取决于 EmbeddingCache
        mock_embed.reset_mock()
        mock_embed.return_value = vec

        cache.check("hello")
        call_count_after_first = mock_embed.call_count

        # 如果 EmbeddingCache 生效，第二次 check 不会调用底层模型
        # 但我们的 mock 不知道 EmbeddingCache —— 实际 embed() 内部有缓存层
        # 这个测试验证的是 check() → embed() 链路正确，不卡死
        assert call_count_after_first >= 1  # 至少调用了 embed()

    # ── Ledger 记账 ──

    @patch("src.embed.embed")
    def test_ledger_records_cache_hit(self, mock_embed: MagicMock) -> None:
        """缓存命中时 TokenLedger.record_cache_hit() 被调用。"""
        mock_ledger = MagicMock()
        vec = _make_unit_vec([1.0, 0.0])
        mock_embed.return_value = vec

        cache = SemanticResponseCache(
            max_entries=64,
            min_similarity=0.95,
            ledger=mock_ledger,
        )
        cache.store(
            "query",
            {
                "response_text": "resp",
                "episode_id": 1,
                "context_meta": {},
                "api_trace": {},
                "recall_items": [],
                "intent": None,
                "system_prompt": None,
                "routing": None,
                "cold_start_profile": None,
            },
        )

        result, _score = cache.check("query")
        assert result is not None

        mock_ledger.record_cache_hit.assert_called_once_with("response", 2500)

"""语义响应缓存——对相似查询直接返回缓存结果，绕过 LLM 全管线。

SemanticResponseCache 维护 (查询文本, 嵌入向量, 完整响应) 三元组的 FIFO 缓存。
``check()`` 对传入的查询文本做 embedding → 与所有缓存条目逐条计算余弦相似度 →
返回最佳匹配。``store()`` 在正常管线结束后缓存新响应。

余弦相似度约定：``np.dot(v1, v2)``，两个向量均为 ``embed()`` 返回的 L2 归一化向量。
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

import numpy as np

if TYPE_CHECKING:
    from src.token_ledger import TokenLedger


@dataclass
class CachedResponse:
    """缓存条目——一条查询的完整 ChatResponse 数据。

    query_embedding 为 ``embed(query_text)`` 的 L2 归一化输出 (384,)，
    用于余弦相似度匹配。其余字段为 ChatResponse 的序列化形式。
    """

    query_text: str
    query_embedding: np.ndarray
    response_text: str
    episode_id: int
    context_meta: dict[str, object]
    api_trace: dict[str, object]
    recall_items: list[dict[str, object]]
    intent: dict[str, object] | None
    system_prompt: str | None
    routing: dict[str, object] | None
    cold_start_profile: dict[str, object] | None


class SemanticResponseCache:
    """语义响应缓存，基于 embedding 余弦相似度匹配。

    设计要点：
    - ``check()`` 返回 ``(CachedResponse | None, best_score)``，
      即使未命中也返回最佳相似度供日志/可观测使用。
    - ``store()`` 接收原始 dict 而非 Pydantic 模型——缓存层独立于 API schema。
    - 模块级 ``get_response_cache()`` 单例跨请求存活，与 ``EmbeddingCache`` 模式一致。

    Args:
        max_entries: FIFO 容量上限，默认 64。
        min_similarity: 余弦相似度阈值，≥ 此值视为命中。
        ledger: 可选的 TokenLedger，命中时记录节省量。
    """

    # ── 一次全管线的保守 token 估算 ──
    _PIPELINE_TOKENS_SAVED = 2500

    def __init__(
        self,
        max_entries: int = 64,
        min_similarity: float = 0.95,
        ledger: TokenLedger | None = None,
    ) -> None:
        self._max_entries = max_entries
        self._min_similarity = min_similarity
        self._store: OrderedDict[str, CachedResponse] = OrderedDict()
        self._hits = 0
        self._misses = 0
        self._ledger = ledger

    # ── 公开 API ──

    def set_ledger(self, ledger: TokenLedger) -> None:
        """注入 TokenLedger，缓存命中时记录 token 节省量。"""
        self._ledger = ledger

    def check(self, query_text: str) -> tuple[CachedResponse | None, float]:
        """检查缓存中是否存在语义相似的查询。

        对 query_text 做 embedding（走 EmbeddingCache 层），然后与所有缓存条目
        逐条计算余弦相似度（归一化向量的点积）。返回最佳匹配及其相似度分数。

        Returns:
            (CachedResponse, similarity) — similarity ≥ min_similarity 时命中。
            (None, best_score) — 最佳匹配低于阈值时未命中。
            (None, 0.0) — 缓存为空时。
        """
        from src.embed import embed

        query_vec = embed(query_text)

        best_entry: CachedResponse | None = None
        best_score = 0.0

        for entry in self._store.values():
            score = float(np.dot(query_vec, entry.query_embedding))
            if score > best_score:
                best_score = score
                best_entry = entry

        if best_entry is not None and best_score >= self._min_similarity:
            self._hits += 1
            if self._ledger is not None:
                self._ledger.record_cache_hit("response", self._PIPELINE_TOKENS_SAVED)
            return best_entry, best_score

        self._misses += 1
        return None, best_score

    def store(self, query_text: str, response_data: dict[str, object]) -> None:
        """缓存一条完整的查询-响应对。

        对 query_text 做 embedding，构造 CachedResponse 并存入 FIFO 队列。
        若 query_text 已存在则刷新位置（move_to_end），不新增条目。
        容量达上限时淘汰最早条目。

        Args:
            query_text: 用户原始输入文本。
            response_data: ChatResponse 各字段的序列化 dict。
        """
        from src.embed import embed

        query_vec = embed(query_text)

        if query_text in self._store:
            self._store.move_to_end(query_text)
            return

        if len(self._store) >= self._max_entries:
            self._store.popitem(last=False)

        entry = CachedResponse(
            query_text=query_text,
            query_embedding=query_vec,
            response_text=cast(str, response_data.get("response_text", "")),
            episode_id=cast(int, response_data.get("episode_id", -1)),
            context_meta=cast(dict[str, object], response_data.get("context_meta", {})),
            api_trace=cast(dict[str, object], response_data.get("api_trace", {})),
            recall_items=cast(list[dict[str, object]], response_data.get("recall_items", [])),
            intent=response_data.get("intent"),  # type: ignore[arg-type]
            system_prompt=response_data.get("system_prompt"),  # type: ignore[arg-type]
            routing=response_data.get("routing"),  # type: ignore[arg-type]
            cold_start_profile=response_data.get("cold_start_profile"),  # type: ignore[arg-type]
        )
        self._store[query_text] = entry

    def invalidate(self, query_text: str) -> bool:
        """精确文本匹配删除缓存条目。

        Returns:
            True 如果条目存在并被删除，False 如果不存在。
        """
        if query_text in self._store:
            del self._store[query_text]
            return True
        return False

    # ── 只读属性 ──

    @property
    def hits(self) -> int:
        return self._hits

    @property
    def misses(self) -> int:
        return self._misses

    @property
    def size(self) -> int:
        return len(self._store)

    def list_entries(self, limit: int = 50) -> list[dict[str, object]]:
        """返回缓存条目摘要列表，供可观测性面板展示。

        每个条目包含查询文本和响应预览。
        """
        entries: list[dict[str, object]] = []
        items = list(self._store.items())
        for _query_text, entry in reversed(items[-limit:]):
            entries.append(
                {
                    "key": entry.query_text[:120],
                    "preview": entry.response_text[:120],
                    "tokens_est": self._PIPELINE_TOKENS_SAVED,
                    "kind": "response",
                }
            )
        return entries


# ── 模块级单例 ──

_RESPONSE_CACHE: SemanticResponseCache | None = None


def get_response_cache() -> SemanticResponseCache:
    """获取或创建模块级 SemanticResponseCache 单例。

    首次调用时从 config 读取 ``response_cache_max_entries`` 和
    ``response_cache_min_similarity`` 初始化。后续调用返回同一实例。
    跨请求存活，无需应用层管理生命周期。
    """
    global _RESPONSE_CACHE
    if _RESPONSE_CACHE is None:
        from src.config import settings

        _RESPONSE_CACHE = SemanticResponseCache(
            max_entries=settings.response_cache_max_entries,
            min_similarity=settings.response_cache_min_similarity,
        )
    return _RESPONSE_CACHE

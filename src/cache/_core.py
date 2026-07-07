"""嵌入缓存层——EmbeddingCache（FIFO 淘汰 + 哈希键）+ FactCache（事实状态缓存）。"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from typing import TYPE_CHECKING, cast

import numpy as np

from src.context.overflow_sim import estimate_tokens

if TYPE_CHECKING:
    from src.token_ledger import TokenLedger


class EmbeddingCache:
    """文本→向量的内存缓存，FIFO 淘汰。

    同一文本在 recall 查询 + 消息存储时会被 embed 两次，
    缓存消除重复的本地模型推理。
    """

    def __init__(self, max_size: int = 1000) -> None:
        self._max_size = max_size
        self._store: OrderedDict[str, np.ndarray] = OrderedDict()
        self._hits = 0
        self._misses = 0
        self._ledger: TokenLedger | None = None

    def set_ledger(self, ledger: TokenLedger) -> None:
        """注入 TokenLedger，缓存命中时自动记录节省的 token 量。"""
        self._ledger = ledger

    def get(self, text: str) -> np.ndarray | None:
        vec = self._store.get(text)
        if vec is not None:
            self._hits += 1
            if self._ledger is not None:
                tokens = estimate_tokens(text)
                self._ledger.record_cache_hit("embedding", tokens)
            return vec
        self._misses += 1
        return None

    def put(self, text: str, vec: np.ndarray) -> None:
        if text in self._store:
            self._store.move_to_end(text)
            return
        if len(self._store) >= self._max_size:
            self._store.popitem(last=False)
        self._store[text] = vec

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
        """返回缓存条目摘要列表（不含 numpy 数组），供可观测性面板展示。

        Args:
            limit: 最多返回条数（取最近存入的 limit 条）。
        """
        entries: list[dict[str, object]] = []
        from src.context.overflow_sim import estimate_tokens as _est

        keys = list(self._store.keys())
        for text in reversed(keys[-limit:]):
            entries.append(
                {
                    "key": text[:120],
                    "preview": text[:120],
                    "tokens_est": _est(text),
                    "kind": "embedding",
                }
            )
        return entries


class FactCache:
    """Fact 抽取 LLM 响应缓存，FIFO 淘汰。

    对同一 (user_msg, assistant_msg, fact_state_hash) 组合
    跳过 LLM 调用，直接返回缓存的 triples + api_trace。
    fact_state_hash 基于当前事实 ID 集合，fact 增删即失效。
    """

    def __init__(self, max_size: int = 64) -> None:
        self._max_size = max_size
        self._store: OrderedDict[str, dict[str, object]] = OrderedDict()
        self._hits = 0
        self._misses = 0

    @staticmethod
    def _make_key(user_msg: str, assistant_msg: str, fact_state_hash: str) -> str:
        raw = f"{user_msg}|{assistant_msg}|{fact_state_hash}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def get(
        self, user_msg: str, assistant_msg: str, fact_state_hash: str
    ) -> dict[str, object] | None:
        key = self._make_key(user_msg, assistant_msg, fact_state_hash)
        result = self._store.get(key)
        if result is not None:
            self._hits += 1
            return result
        self._misses += 1
        return None

    def put(
        self,
        user_msg: str,
        assistant_msg: str,
        fact_state_hash: str,
        result: dict[str, object],
    ) -> None:
        key = self._make_key(user_msg, assistant_msg, fact_state_hash)
        if key in self._store:
            self._store.move_to_end(key)
            return
        if len(self._store) >= self._max_size:
            self._store.popitem(last=False)
        self._store[key] = result

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

        FactCache 的值是 fact 抽取结果的 dict，从中提取可读字段。
        """
        entries: list[dict[str, object]] = []
        items = list(self._store.items())
        for key, value in reversed(items[-limit:]):
            preview = ""
            for field in ("user_msg", "assistant_msg", "response_text", "content"):
                if field in value:
                    preview = str(value[field])[:120]
                    break
            if not preview:
                preview = "(binary/legacy entry)"
            entries.append(
                {
                    "key": key[:16] + "...",
                    "preview": preview,
                    "tokens_est": 0,
                    "kind": "fact",
                }
            )
        return entries

    @staticmethod
    def compute_fact_state_hash(facts: list[dict[str, object]]) -> str:
        ids = sorted([cast(int, f["id"]) for f in facts])
        return hashlib.sha256(str(ids).encode()).hexdigest()[:16]

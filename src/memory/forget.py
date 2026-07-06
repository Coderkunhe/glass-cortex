"""艾宾浩斯遗忘引擎——指数衰减公式 + 批量衰减 + 召回后强度增强 + 会话定向遗忘。"""

from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING

from src.config import settings

if TYPE_CHECKING:
    from src.memory.index import IndexManager
    from src.memory.store import EpisodeRow, MemoryStore


class ForgettingEngine:
    """艾宾浩斯遗忘曲线引擎。

    ADR-003: strength(t) = initial_strength × e^(-λt)
    每次召回后增强强度（上限 1.0），更新时间戳重置衰减起点。

    会话定向遗忘（Phase 66 B21）：按 session_id 级联删除 episodes +
    关联 facts + FAISS 向量，实现"清除对话→记忆遗忘→标签回退"的完整链路。
    """

    def __init__(self, store: MemoryStore, index: IndexManager | None = None) -> None:
        self.store = store
        self.index = index

    def current_strength(self, episode: EpisodeRow) -> float:
        initial = episode["initial_strength"]
        lam = episode["lambda"]
        last_event = episode["last_recall"] or episode["timestamp"]
        hours = (time.time() - last_event) / 3600
        return initial * math.exp(-lam * hours)

    def decay_all(self, lambda_override: float | None = None) -> list[tuple[int, float, float]]:
        """对所有记忆执行衰减，返回 [(id, old_strength, new_strength), ...]。

        lambda_override 不为 None 时覆盖每条记忆的个体 λ，用于 L6 全局衰减率控制。
        """
        episodes = self.store.get_all_episodes()
        deltas: list[tuple[int, float, float]] = []
        updates: list[tuple[int, float]] = []

        for ep in episodes:
            eid = ep["id"]
            initial = ep["initial_strength"]
            lam = lambda_override if lambda_override is not None else ep["lambda"]
            last_event = ep["last_recall"] or ep["timestamp"]
            hours = (time.time() - last_event) / 3600
            old_s = self.current_strength(ep)
            new_s = initial * math.exp(-lam * hours)
            updates.append((eid, new_s))
            deltas.append((eid, old_s, new_s))

        if updates:
            self.store.set_strength_batch(updates)
        return deltas

    def forget_session(self, session_id: str) -> dict[str, object]:
        """按 session_id 定向遗忘——级联删除所有关联数据并清理 FAISS 向量。

        调用 store.delete_episodes_by_session() 完成 SQL 层级的级联删除
        （episodes → facts → recall_log → confidence_log），再通过 IndexManager
        移除 FAISS 向量索引中的对应条目。

        Args:
            session_id: 目标会话标识。

        Returns:
            {"episodes_deleted": int, "facts_deleted": int,
             "faiss_vectors_removed": int, "session_id": str}
        """
        result = self.store.delete_episodes_by_session(session_id)
        faiss_ids: list[int] = result.get("faiss_ids", [])  # type: ignore[assignment]

        faiss_removed = 0
        if faiss_ids and self.index is not None:
            faiss_removed = self.index.remove_faiss_ids(faiss_ids)

        return {
            "episodes_deleted": result["episodes_deleted"],
            "facts_deleted": result["facts_deleted"],
            "faiss_vectors_removed": faiss_removed,
            "session_id": session_id,
        }

    @staticmethod
    def strengthen(current_strength: float, boost: float = settings.strengthen_boost) -> float:
        return min(settings.strength_cap, current_strength + boost)

"""语义去重——贪婪算法 + 余弦/编辑距离阈值过滤重复候选条目。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np


@dataclass
class DedupResult:
    """语义去重结果。"""

    kept: list[tuple[int, float]] = field(default_factory=list)
    removed: list[tuple[int, float]] = field(default_factory=list)
    dedup_source: dict[int, int] = field(default_factory=dict)
    # 被移除的 faiss_id → 保留的 faiss_id


def deduplicate_candidates(
    candidates: list[tuple[int, float]],
    reconstruct_fn: Callable[[int], np.ndarray],
    threshold: float,
) -> DedupResult:
    """语义去重：移除 FAISS 候选中余弦相似度过高的近重复项。

    按 query similarity 降序遍历，贪心保留。候选与已保留集合中
    任一向量余弦相似度 ≥ threshold → 视为重复，移除。
    """
    if threshold >= 1.0 or len(candidates) <= 1:
        return DedupResult(kept=list(candidates))

    result = DedupResult()
    kept_vectors: list[tuple[int, np.ndarray]] = []

    for faiss_id, query_sim in candidates:
        try:
            vec = reconstruct_fn(faiss_id)
        except KeyError:
            result.kept.append((faiss_id, query_sim))
            continue

        is_dup = False
        for kept_id, kept_vec in kept_vectors:
            sim = float(np.dot(vec, kept_vec))
            if sim >= threshold:
                result.removed.append((faiss_id, query_sim))
                result.dedup_source[faiss_id] = kept_id
                is_dup = True
                break

        if not is_dup:
            result.kept.append((faiss_id, query_sim))
            kept_vectors.append((faiss_id, vec))

    return result

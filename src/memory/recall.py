"""记忆召回引擎——语义搜索 + MMR 重排 + 时间衰减 + 后置强度增强。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast

import numpy as np

from src.config import settings
from src.memory.dedup import DedupResult, deduplicate_candidates
from src.memory.forget import ForgettingEngine
from src.memory.index import IndexManager
from src.memory.store import MemoryStore


class RecallEngine:
    """记忆召回引擎。

    ADR-001/002/003 综合：
    1. Embedding → FAISS 语义粗筛
    2. SQLite 取回结构化元数据
    3. 艾宾浩斯强度 × 语义相似度 × 重要性 → 综合排序
    4. 召回后增强记忆强度
    """

    def __init__(
        self,
        store: MemoryStore,
        index: IndexManager,
        embed_fn: Callable[[str], np.ndarray],
        forgetting: ForgettingEngine | None = None,
    ) -> None:
        self.store = store
        self.index = index
        self.embed = embed_fn
        self.forgetting = forgetting or ForgettingEngine(store)
        self.last_dedup_result: DedupResult | None = None
        self.last_regret: RegretAnalysis | None = None

    def recall(
        self,
        query: str,
        top_k: int = settings.recall_top_k,
        search_k: int = settings.recall_search_k,
        threshold: float = settings.recall_threshold,
        strengthen: bool = True,
        mmr_lambda: float | None = None,
    ) -> list[dict[str, object]]:
        # 分层模式用更大的搜索窗口，补偿冷层过滤损失
        effective_k = max(search_k, settings.tier_search_k) if settings.tier_enabled else search_k
        vec = self.embed(query)
        candidates = self.index.search(vec, k=effective_k)

        if not candidates:
            self.last_dedup_result = DedupResult()
            self.last_regret = RegretAnalysis()
            return []

        # 语义去重：移除候选间余弦相似度过高的近重复项
        dedup_result = deduplicate_candidates(
            candidates, self.index.reconstruct, settings.semantic_dedup_threshold
        )
        self.last_dedup_result = dedup_result

        kept_candidates = dedup_result.kept
        faiss_ids = [cid for cid, _ in kept_candidates]
        dist_map = {cid: sim for cid, sim in kept_candidates}

        # 并行查询 episodes 和 facts
        episodes = self.store.get_episodes_by_faiss_id(faiss_ids)
        facts = self.store.get_facts_by_faiss_id(faiss_ids)

        # ── 分层感知：hot 优先 → warm 补充 → cold 排除 ──
        if settings.tier_enabled:
            hot_eps = [ep for ep in episodes if ep.get("tier") == "hot"]
            warm_eps = [ep for ep in episodes if ep.get("tier") == "warm"]
            # cold 层不做召回

            hot_scored = self._score_episodes(hot_eps, dist_map, threshold)  # type: ignore[arg-type]
            warm_scored = self._score_episodes(warm_eps, dist_map, threshold)  # type: ignore[arg-type]

            # 两阶段：hot 全量优先，warm 补充不足
            scored: list[tuple[dict[str, object], float]] = list(hot_scored)
            remaining = max(0, top_k - len(scored))
            if remaining > 0:
                scored.extend(warm_scored[:remaining])
        else:
            scored = self._score_episodes(episodes, dist_map, threshold)  # type: ignore[arg-type]

        # ── facts 始终参与召回（无分层概念）──
        for fact in facts:
            fid = fact["faiss_id"]
            similarity = dist_map.get(fid, 0.0)  # type: ignore[arg-type]
            confidence = fact["confidence"]
            if confidence < threshold:
                continue
            score = similarity * confidence
            fact["_row_type"] = "fact"  # type: ignore[typeddict-unknown-key]
            fact["composite_score"] = score  # type: ignore[typeddict-unknown-key]
            fact["similarity"] = similarity  # type: ignore[typeddict-unknown-key]
            scored.append((fact, score))  # type: ignore[arg-type]

        # 分层模式下热层优先顺序已由两阶段构造保证，不再全量重排；
        # 非分层模式按评分重排。
        if not settings.tier_enabled:
            scored.sort(key=lambda x: x[1], reverse=True)

        # MMR 多样性重排（若启用）
        if settings.mmr_enabled and len(scored) > 1:
            selected, mmr_dropped = mmr_rerank(
                scored,
                top_k,
                mmr_lambda if mmr_lambda is not None else settings.mmr_lambda,
                self.index.reconstruct,
            )
        else:
            selected = [row for row, _ in scored[:top_k]]
            mmr_dropped = [row for row, _ in scored[top_k:]]

        # 构建遗憾分析
        deduped_items = [
            {"faiss_id": fid, "_row_type": "deduped", "composite_score": sim}
            for fid, sim in dedup_result.removed
        ]
        self.last_regret = analyze_regret(deduped_items, mmr_dropped, [])

        # 为每条入选记忆构建召回理由（可解释性，q2.18）
        for row in selected:
            if "_row_type" not in row:
                row["_row_type"] = "episode"
            row["recall_reason"] = _build_recall_reason(row)

        # 召回后增强（仅 episodes；搜索时可跳过）
        result: list[dict[str, object]] = []
        for row in selected:
            if row.get("_row_type") == "fact":
                result.append(row)
            elif strengthen:
                old_strength = self.forgetting.current_strength(row)  # type: ignore[arg-type]
                new_strength = ForgettingEngine.strengthen(old_strength)
                eid = cast(int, row["id"])
                self.store.update_strength(eid, new_strength)
                self.store.log_recall(eid, old_strength, new_strength)
                result.append(row)
            else:
                result.append(row)

        return result

    def _score_episodes(
        self,
        episodes: list[dict[str, object]],
        dist_map: dict[int, float],
        threshold: float,
    ) -> list[tuple[dict[str, object], float]]:
        """评分并排序 episodes——相似度 × 强度 × 重要性，过滤低于阈值的项。

        Args:
            episodes: 待评分的 episode 列表。
            dist_map: faiss_id → 语义相似度映射。
            threshold: 强度阈值，低于此值的 episode 被过滤。

        Returns:
            (episode, composite_score) 列表，按评分降序排列。
        """
        scored: list[tuple[dict[str, object], float]] = []
        for ep in episodes:
            fid = ep["faiss_id"]
            similarity = dist_map.get(fid, 0.0)  # type: ignore[call-overload]
            strength = self.forgetting.current_strength(ep)  # type: ignore[arg-type]
            if strength < threshold:
                continue
            score = similarity * strength * ep["importance"]
            ep["composite_score"] = score
            ep["similarity"] = similarity
            ep["current_strength"] = strength
            scored.append((ep, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored


@dataclass
class RegretAnalysis:
    """被排除在召回结果之外的记忆及原因。"""

    deduped: list[dict[str, object]] = field(default_factory=list)
    mmr_dropped: list[dict[str, object]] = field(default_factory=list)
    truncated: list[dict[str, object]] = field(default_factory=list)


def mmr_rerank(
    scored: list[tuple[dict[str, object], float]],
    top_k: int,
    lambda_: float,
    reconstruct_fn: Callable[[int], np.ndarray],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """MMR (Maximal Marginal Relevance) 多样性重排。

    MMR = argmax [λ·rel(c) - (1-λ)·max_sim(c, S)]

    贪心选择 top_k 条：首轮选最高分，后续每轮选 MMR 得分最高的。
    λ=1.0 等价于纯相关性排序；λ=0.0 最大化多样性。
    """
    if top_k >= len(scored):
        return [row for row, _ in scored], []

    # 预取所有候选向量（缓存一次）
    vec_cache: dict[int, np.ndarray] = {}
    for row, _ in scored:
        fid_raw = row.get("faiss_id")
        if fid_raw is not None:
            fid = cast(int, fid_raw)
            if fid not in vec_cache:
                try:
                    vec_cache[fid] = reconstruct_fn(fid)
                except KeyError:
                    pass

    remaining = list(scored)  # (item, score)
    selected: list[dict[str, object]] = []
    selected_vecs: list[np.ndarray] = []

    # 首轮：选最高分
    best = remaining.pop(0)
    selected.append(best[0])
    best_fid_raw = best[0].get("faiss_id")
    if best_fid_raw is not None:
        best_fid = cast(int, best_fid_raw)
        if best_fid in vec_cache:
            selected_vecs.append(vec_cache[best_fid])

    # 后续轮次：MMR 贪心
    while len(selected) < top_k and remaining:
        best_idx = 0
        best_mmr = -float("inf")
        for i, (item, score) in enumerate(remaining):
            max_sim = 0.0
            fid_raw = item.get("faiss_id")
            if fid_raw is not None:
                fid = cast(int, fid_raw)
                if fid in vec_cache:
                    item_vec = vec_cache[fid]
                    for svec in selected_vecs:
                        sim = float(np.dot(item_vec, svec))
                        if sim > max_sim:
                            max_sim = sim
            mmr = lambda_ * score - (1.0 - lambda_) * max_sim
            if mmr > best_mmr:
                best_mmr = mmr
                best_idx = i
        selected.append(remaining[best_idx][0])
        fid_raw2 = remaining[best_idx][0].get("faiss_id")
        if fid_raw2 is not None:
            fid2 = cast(int, fid_raw2)
            if fid2 in vec_cache:
                selected_vecs.append(vec_cache[fid2])
        remaining.pop(best_idx)

    for item in selected:
        item["_mmr_selected"] = True

    dropped = [row for row, _ in remaining]
    return selected, dropped


def analyze_regret(
    deduped: list[dict[str, object]],
    mmr_dropped: list[dict[str, object]],
    truncated: list[dict[str, object]],
) -> RegretAnalysis:
    """合并三种排除源为统一遗憾分析。"""
    return RegretAnalysis(deduped=deduped, mmr_dropped=mmr_dropped, truncated=truncated)


def _build_recall_reason(row: dict[str, object]) -> str:
    """为单条召回结果构建人类可读的召回理由（q2.18 记忆可解释性）。

    理由说明「为什么我觉得这条记忆跟当前查询有关」——拆解为评分组分：
    语义相似度、记忆强度/置信度、重要性、MMR 多样性、分层策略。
    """
    row_type = row.get("_row_type", "")
    sim = float(cast(float, row.get("similarity", 0)))
    is_mmr = bool(row.get("_mmr_selected"))
    tier = row.get("tier", "")
    importance = cast(float, row.get("importance", 1.0))

    parts: list[str] = []

    if row_type == "fact":
        # 事实：语义相似度 × 置信度
        conf = float(cast(float, row.get("confidence", 0)))
        parts.append(f"语义 {sim:.0%} × 置信度 {conf:.0%}")
    else:
        # Episode：语义相似度 × 当前强度 × 重要性
        strength = float(cast(float, row.get("current_strength", 0)))
        parts.append(f"语义 {sim:.0%} × 强度 {strength:.0%} × 重要性 {importance:.0%}")

        # 分层感知标注
        if tier == "hot":
            parts.append("热层优先")
        elif tier == "warm" and settings.tier_enabled:
            parts.append("温层补充")

    # MMR 多样性标注
    if is_mmr:
        parts.append(f"MMR 多样性优选 (λ={settings.mmr_lambda})")

    return " · ".join(parts)


def apply_truncation(
    recalled: list[dict[str, object]],
    threshold: float,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """按 composite_score 阈值截断召回结果。

    返回 (kept, truncated)。threshold <= 0 时不做截断，全部保留。
    """
    if threshold <= 0 or not recalled:
        return recalled, []
    kept: list[dict[str, object]] = []
    truncated: list[dict[str, object]] = []
    for r in recalled:
        score = float(cast(float, r.get("composite_score", 0)))
        if score >= threshold:
            kept.append(r)
        else:
            truncated.append(r)
    return kept, truncated

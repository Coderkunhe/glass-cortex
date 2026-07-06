"""记忆引导规划——从历史 PlanRun 中检索相似计划、提取成败模式。

PlanHistoryRetriever 遵循 ConsolidationCore 模式：
store 构造注入 + config 可覆盖 + feature flag 门控 + 纯逻辑零 LLM 调用。
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast

from src.config import Settings, settings

if TYPE_CHECKING:
    from src.memory.store import MemoryStore


# ── 实体提取正则 ──
_CHINESE_ENTITY_RE = re.compile(r"[一-鿿]{2,4}")
_URL_RE = re.compile(r"https?://[^\s]+")
_FILE_PATH_RE = re.compile(r"(?:/[\w.-]+)+\.\w{1,6}")
_VERSION_RE = re.compile(r"\bv?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?\b")


@dataclass(frozen=True)
class HistoricalPlan:
    """单个历史计划，含相似度分数和内联 subtasks。

    Attributes:
        plan_run_id: plan_runs 主键。
        session_id: 所属会话 id。
        user_msg: 原始用户消息。
        intent_category: L1 意图分类结果。
        rationale: 规划理由。
        confidence: 规划置信度 [0, 1]。
        subtask_count: 子任务数量。
        created_at: 创建时间戳。
        subtasks: 内联的 plan_subtasks 行列表。
        similarity_score: 与当前用户消息的 Jaccard 相似度 [0, 1]。
    """

    plan_run_id: int
    session_id: str
    user_msg: str
    intent_category: str
    rationale: str
    confidence: float
    subtask_count: int
    created_at: float
    subtasks: list[dict[str, object]] = field(default_factory=list)
    similarity_score: float = 0.0
    entities: set[str] = field(default_factory=set, compare=False, hash=False)


@dataclass(frozen=True)
class PlanHistoryResult:
    """历史计划检索的综合结果。

    Attributes:
        historical_plans: 按相似度降序排列的 Top-K 历史计划。
        success_templates: 提取的成功模板列表（B2 填充）。
        failure_patterns: 提取的失败模式列表（B2 填充）。
        total_candidates: 原始候选计划总数（过滤前）。
        retrieval_time_ms: 检索耗时（毫秒）。
    """

    historical_plans: list[HistoricalPlan] = field(default_factory=list)
    success_templates: list[dict[str, object]] = field(default_factory=list)
    failure_patterns: list[dict[str, object]] = field(default_factory=list)
    total_candidates: int = 0
    retrieval_time_ms: float = 0.0


@dataclass(frozen=True)
class PatternReport:
    """从 plan 历史中提取的成败模式统计报告。

    Attributes:
        success_templates: 成功模板列表（全部子任务成功的 plan_run 摘要）。
        failure_patterns: 失败模式列表（重复出现 ≥2 次的失败子任务描述）。
        duration_stats: 耗时统计 {"min_s": float, "avg_s": float, "max_s": float}。
        total_plans_analyzed: 分析的 plan 总数。
        success_rate: 成功率 (0.0 ~ 1.0)。
    """

    success_templates: list[dict[str, object]] = field(default_factory=list)
    failure_patterns: list[dict[str, object]] = field(default_factory=list)
    duration_stats: dict[str, object] = field(default_factory=dict)
    total_plans_analyzed: int = 0
    success_rate: float = 0.0


class PlanHistoryRetriever:
    """检索历史计划中与当前用户消息最相似的 PlanRun。

    纯逻辑模块——实体提取用正则，相似度用 Jaccard，不产生 LLM 调用。
    遵循 ConsolidationCore 构造模式：__init__(store, config=None)。
    """

    def __init__(
        self,
        store: MemoryStore,
        config: Settings | None = None,
    ) -> None:
        """构造 PlanHistoryRetriever。

        Args:
            store: MemoryStore 实例（读取 plan_runs + plan_subtasks 表）。
            config: 可选的 Settings 覆盖，None 使用模块级 settings 单例。
        """
        self._store = store
        self._config = config or settings
        self._entity_cache: dict[int, set[str]] = {}

    # ── 公开入口 ──

    def retrieve(
        self,
        user_msg: str,
        intent_category: str = "提问",
        limit: int | None = None,
    ) -> PlanHistoryResult:
        """检索与当前用户消息最相似的 Top-K 历史计划。

        管线：
        1. 提取当前用户消息的实体
        2. 从 plan_runs 表列出候选计划（受 config.search_limit 约束）
        3. 按 intent_category 过滤 + entity Jaccard 相似度评分
        4. 取 Top-K，调用 store.get_plan() 获取完整 subtasks
        5. 构造 PlanHistoryResult 返回

        Args:
            user_msg: 当前用户消息文本。
            intent_category: L1 意图分类结果（用于过滤历史计划）。
            limit: 检索上限覆盖，None 使用 config 默认值。

        Returns:
            PlanHistoryResult —— 即使无匹配历史计划也返回空列表（非 None）。
        """
        t0 = time.time()
        effective_limit = limit if limit is not None else self._config.plan_history_search_limit
        top_k = self._config.plan_history_top_k
        threshold = self._config.plan_history_similarity_threshold

        # 1. 提取当前消息的实体
        current_entities = self._extract_entities(user_msg)

        # 2. 列出候选历史计划
        candidates = self._store.list_plans(session_id=None, limit=effective_limit)
        total_candidates = len(candidates)

        # 3. 评分 + 过滤
        scored: list[tuple[float, dict[str, object]]] = []
        for plan in candidates:
            plan_intent = str(plan.get("intent_category", ""))
            # 意图不匹配则跳过（与当前意图不同的计划参考价值低）
            if plan_intent and plan_intent != intent_category:
                continue
            score = self._score_plan(plan, current_entities)
            if score >= threshold:
                scored.append((score, plan))

        # 按相似度降序排列，取 Top-K
        scored.sort(key=lambda x: x[0], reverse=True)
        top_plans = scored[:top_k]

        # 4. 获取完整 subtasks
        historical: list[HistoricalPlan] = []
        for score, plan in top_plans:
            plan_id = cast(int, plan["id"])
            full_plan = self._store.get_plan(plan_id)
            if not full_plan:
                continue
            entities = self._entity_cache.get(plan_id, set())
            subtask_rows = cast(list[dict[str, object]], full_plan.get("subtasks", []))
            historical.append(
                HistoricalPlan(
                    plan_run_id=plan_id,
                    session_id=cast(str, plan.get("session_id", "")),
                    user_msg=cast(str, plan.get("user_msg", "")),
                    intent_category=cast(str, plan.get("intent_category", "")),
                    rationale=cast(str, plan.get("rationale", "")),
                    confidence=cast(float, plan.get("confidence", 0.3)),
                    subtask_count=cast(int, plan.get("subtask_count", 0)),
                    created_at=cast(float, plan.get("created_at", 0.0)),
                    subtasks=[dict(st) for st in subtask_rows] if full_plan else [],
                    similarity_score=round(score, 4),
                    entities=entities,
                )
            )

        elapsed_ms = round((time.time() - t0) * 1000, 1)
        return PlanHistoryResult(
            historical_plans=historical,
            total_candidates=total_candidates,
            retrieval_time_ms=elapsed_ms,
        )

    # ── 实体提取 ──

    @staticmethod
    def _extract_entities(text: str) -> set[str]:
        """从文本中提取候选实体——中文词组 + 技术标识符。

        策略：
        - 中文：连续 2-4 个汉字 (`[一-鿿]{2,4}`)
        - 技术：URL、文件路径、版本号
        - 全部小写去重

        Args:
            text: 任意文本。

        Returns:
            提取的实体集合（可能为空）。
        """
        entities: set[str] = set()

        # 中文词组
        for m in _CHINESE_ENTITY_RE.finditer(text):
            entities.add(m.group())

        # 技术模式
        for pattern in (_URL_RE, _FILE_PATH_RE, _VERSION_RE):
            for m in pattern.finditer(text):
                entities.add(m.group().lower())

        return entities

    # ── 相似度评分 ──

    @staticmethod
    def _jaccard_similarity(set_a: set[str], set_b: set[str]) -> float:
        """计算两个实体集合的 Jaccard 相似度。

        Args:
            set_a: 第一个实体集合。
            set_b: 第二个实体集合。

        Returns:
            Jaccard 系数 [0, 1]。两个集合都为空时返回 0.0。
        """
        if not set_a and not set_b:
            return 0.0
        intersection = len(set_a & set_b)
        union = len(set_a | set_b)
        return intersection / union if union > 0 else 0.0

    def _score_plan(
        self,
        plan_run: dict[str, object],
        current_entities: set[str],
    ) -> float:
        """对单个历史 plan_run 计算相似度分数。

        score = 0.4 + 0.6 × Jaccard(entity_current, entity_plan)
        意图类别已在 retrieve() 过滤阶段匹配，故 bonus 为常数。

        Args:
            plan_run: plan_runs 行 dict（含 user_msg 字段）。
            current_entities: 当前用户消息的实体集合。

        Returns:
            相似度分数 [0, 1]。
        """
        plan_msg = str(plan_run.get("user_msg", ""))
        plan_id = cast(int, plan_run["id"])

        # 从缓存获取或计算实体
        if plan_id not in self._entity_cache:
            self._entity_cache[plan_id] = self._extract_entities(plan_msg)

        plan_entities = self._entity_cache[plan_id]
        jaccard = self._jaccard_similarity(current_entities, plan_entities)
        # intent 已在 retrieve() 过滤阶段匹配，bonus 为常数 0.4
        return 0.4 + 0.6 * jaccard

    # ── 模式提取 (B2) ──

    @staticmethod
    def _normalize_description(desc: str) -> str:
        """归一化子任务描述，用于模式匹配。

        移除空白、标点后小写化，使「获取 数据」和「获取数据」匹配为同一模式。

        Args:
            desc: 原始子任务描述文本。

        Returns:
            归一化的描述字符串。
        """
        # 移除中文/英文标点和多余空白
        cleaned = re.sub(r"[，。！？、：；（）”“【】『』《》,.!?:;()\"'\[\]{}<>\s]+", "", desc)
        return cleaned.lower()

    def extract_patterns(
        self,
        session_id: str | None = None,
        limit: int = 100,
    ) -> PatternReport:
        """从历史 plan 中提取成功模板和失败模式。

        成功模板：所有 subtasks status=="success" 的 plan_run。
        失败模式：status=="failed" 的 subtask description 归一化后
                  出现 ≥2 次则视为失败模式。

        Args:
            session_id: 可选的会话过滤；None 为全局。
            limit: 分析的历史计划数量上限。

        Returns:
            PatternReport —— 含 success_templates、failure_patterns、
            duration_stats 和 success_rate。
        """
        plans = self._store.list_plans(session_id=session_id, limit=limit)
        if not plans:
            return PatternReport(total_plans_analyzed=0)

        success_count = 0
        total_ct = len(plans)
        success_templates: list[dict[str, object]] = []
        # 统计失败描述出现次数
        fail_desc_counter: dict[str, int] = {}
        fail_desc_examples: dict[str, list[str]] = {}  # 归一化 key → 原始描述样本
        all_durations: list[float] = []

        for plan in plans:
            plan_id = cast(int, plan["id"])
            full = self._store.get_plan(plan_id)
            if not full:
                continue
            subtasks = full.get("subtasks", [])
            if not isinstance(subtasks, list) or not subtasks:
                continue

            statuses = [str(st.get("status", "pending")) for st in subtasks if isinstance(st, dict)]
            all_success = all(s == "succeeded" for s in statuses)
            if all_success:
                success_count += 1
                success_templates.append(
                    {
                        "plan_run_id": plan_id,
                        "user_msg": plan.get("user_msg", ""),
                        "intent_category": plan.get("intent_category", ""),
                        "subtask_count": len(subtasks),
                        "subtask_descriptions": [
                            str(st.get("description", ""))
                            for st in subtasks
                            if isinstance(st, dict)
                        ],
                    }
                )

            # 收集失败子任务
            for st in subtasks:
                if not isinstance(st, dict):
                    continue
                if str(st.get("status", "")) == "failed":
                    desc = str(st.get("description", ""))
                    norm = self._normalize_description(desc)
                    fail_desc_counter[norm] = fail_desc_counter.get(norm, 0) + 1
                    if norm not in fail_desc_examples:
                        fail_desc_examples[norm] = []
                    if desc not in fail_desc_examples[norm]:
                        fail_desc_examples[norm].append(desc)

            # 耗时估算
            created = cast(float, plan.get("created_at", 0.0))
            if created > 0 and len(subtasks) > 0:
                # 简单估算：每个子任务平均 2 秒（实际需 pipeline_trace 精确数据）
                all_durations.append(len(subtasks) * 2.0)

        # 构建失败模式列表（出现 ≥2 次）
        failure_patterns: list[dict[str, object]] = []
        for norm_desc, count in fail_desc_counter.items():
            if count >= 2:
                failure_patterns.append(
                    {
                        "pattern": norm_desc,
                        "occurrences": count,
                        "examples": fail_desc_examples.get(norm_desc, []),
                    }
                )

        # 耗时统计
        duration_stats: dict[str, object] = {}
        if all_durations:
            duration_stats["min_s"] = round(min(all_durations), 1)
            duration_stats["avg_s"] = round(sum(all_durations) / len(all_durations), 1)
            duration_stats["max_s"] = round(max(all_durations), 1)
        else:
            duration_stats = {"min_s": 0.0, "avg_s": 0.0, "max_s": 0.0}

        return PatternReport(
            success_templates=success_templates,
            failure_patterns=failure_patterns,
            duration_stats=duration_stats,
            total_plans_analyzed=total_ct,
            success_rate=round(success_count / total_ct, 4) if total_ct > 0 else 0.0,
        )

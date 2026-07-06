"""上下文预算——查询复杂度分类 + 四区 Token 预算分配 + 自动降级引擎。

Phase 63 (四支柱 2.1)：QueryClassifier 根据意图/消息长度/历史长度
将查询分为 LIGHT/MEDIUM/HEAVY 三级；BudgetAllocator 按三级配比
将上下文窗口 token 分配给四个 zone（system/recalled/history/tools），
recalled zone 获得可配置比例的预算。

Phase 63 Batch 2 (四支柱 2.1 收尾 + 3.2 降级)：AutoDegradationEngine
运行时监控 token 用量——超标按优先级砍：①事实抽取 ②温层摘要
③召回数量。DegradationPlan 作为决策输出，供管线步骤门控消费。

设计原则：
- 分类器是纯函数，不访问 I/O，方便测试和调参。
- 分配器通过 Settings 注入配比，实验时新建 Settings 实例即可 A/B 对比。
- 降级引擎同样是纯计算——输入预算 + 当前 token 估算，输出决策。
- 默认 feature flag 关闭（budget_enabled=False），不影响现有管线。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.config import Settings


class QueryClass(StrEnum):
    """查询复杂度分级——决定上下文预算的配比策略。

    LIGHT:   闲聊/澄清，短消息，短历史 → 记忆召回仅需少量 budget。
    MEDIUM:  混合特征 → 标准配比（默认兜底）。
    HEAVY:   探索/指令，长消息，长历史 → 记忆召回需要更多 budget。
    """

    LIGHT = "light"
    MEDIUM = "medium"
    HEAVY = "heavy"


class QueryClassifier:
    """查询复杂度分类器——基于意图、消息长度、历史长度三信号分类。

    分类规则（优先级: HEAVY > LIGHT > MEDIUM 默认）:
      1. HEAVY: 意图 in ("探索", "指令") AND 消息 > 200 chars AND 历史 > 15 turns
      2. LIGHT: 意图 in ("闲聊", "澄清") AND 消息 < 50 chars AND 历史 < 5 turns
      3. MEDIUM: 上述条件均不满足（默认兜底）

    所有阈值均为类常量，可通过子类化覆盖以支持 A/B 实验。
    """

    # ── 分类阈值（类常量，方便测试和 A/B）──
    LIGHT_INTENTS: tuple[str, ...] = ("闲聊", "澄清")
    HEAVY_INTENTS: tuple[str, ...] = ("探索", "指令")
    SHORT_MSG_LEN: int = 50  # < 此值为短消息
    LONG_MSG_LEN: int = 200  # > 此值为长消息
    SHORT_HISTORY_LEN: int = 5  # < 此值为短历史
    LONG_HISTORY_LEN: int = 15  # > 此值为长历史

    @classmethod
    def classify(
        cls,
        intent: str | None,
        message_length: int,
        history_length: int,
    ) -> QueryClass:
        """根据意图、消息长度、历史轮数返回查询复杂度等级。

        Args:
            intent: 意图分类标签（来自 IntentResult.category），可为 None。
            message_length: 用户输入字符数（len(user_input)）。
            history_length: 当前会话前序轮数（user+assistant 配对计数）。

        Returns:
            QueryClass 枚举值——LIGHT / MEDIUM / HEAVY。
        """
        # HEAVY: all three signals agree on "complex"
        if (
            intent in cls.HEAVY_INTENTS
            and message_length > cls.LONG_MSG_LEN
            and history_length > cls.LONG_HISTORY_LEN
        ):
            return QueryClass.HEAVY

        # LIGHT: all three signals agree on "simple"
        if (
            intent in cls.LIGHT_INTENTS
            and message_length < cls.SHORT_MSG_LEN
            and history_length < cls.SHORT_HISTORY_LEN
        ):
            return QueryClass.LIGHT

        # MEDIUM: default for mixed signals or unknown intent
        return QueryClass.MEDIUM


class BudgetAllocator:
    """上下文预算分配器——按查询等级将窗口 token 分配给四个 zone。

    分配规则（三级配比）:
      - LIGHT:   recalled = window × light_budget_pct   (default 10%)
      - MEDIUM:  recalled = window × medium_budget_pct  (default 40%)
      - HEAVY:   recalled = window × heavy_budget_pct   (default 60%)
      - system:  window × 5%  (固定开销)
      - tools:   window × 3%  (最小预留)
      - history: 剩余全部 (window - sum of above)

    配比通过 Settings 注入，支持 A/B 实验。
    """

    # ── 固定分配比例 ──
    SYSTEM_OVERHEAD_PCT: float = 0.05  # 系统提示固定开销
    TOOLS_MINIMAL_PCT: float = 0.03  # 工具定义最小预留

    def __init__(self, config: Settings | None = None) -> None:
        """初始化分配器。

        Args:
            config: Settings 实例，None 时使用模块级单例 settings。
        """
        from src.config import settings as _default_settings

        self._config = config or _default_settings

    @property
    def is_enabled(self) -> bool:
        """Feature flag 快捷访问——关闭时调用方应跳过分配。"""
        return self._config.budget_enabled

    def allocate(
        self,
        query_class: QueryClass,
        window_size: int | None = None,
    ) -> dict[str, int]:
        """根据查询等级和窗口大小计算四区 token 预算。

        Args:
            query_class: 查询复杂度（LIGHT / MEDIUM / HEAVY）。
            window_size: 上下文窗口总 token 数，None 时使用
                         config.context_window_size（默认 4096）。

        Returns:
            dict 映射 zone_key → 推荐 token 预算:
              {"system": N, "recalled": N, "history": N, "tools": N}
            四项之和等于 window_size。
        """
        if window_size is None:
            window_size = self._config.context_window_size

        # 根据查询等级选择 recalled 配比
        recalled_pct = self.get_recalled_pct(query_class)

        # 计算各 zone token 数
        system_tokens = int(window_size * self.SYSTEM_OVERHEAD_PCT)
        tools_tokens = int(window_size * self.TOOLS_MINIMAL_PCT)
        recalled_tokens = int(window_size * recalled_pct)

        # history 拿走剩余全部（确保总和等于 window_size）
        history_tokens = window_size - system_tokens - tools_tokens - recalled_tokens
        # 安全钳：分配溢出时缩减 recalled，history 归零（极端配置下配比 > 0.92 触发）
        if history_tokens < 0:
            recalled_tokens = window_size - system_tokens - tools_tokens
            history_tokens = 0

        return {
            "system": system_tokens,
            "recalled": recalled_tokens,
            "history": history_tokens,
            "tools": tools_tokens,
        }

    def get_recalled_pct(self, query_class: QueryClass) -> float:
        """返回指定查询等级对应的 recalled 分配比例。

        便捷方法——供调用方在不需要完整 allocation 时
        快速获取 recalled zone 的预算比例。

        Args:
            query_class: 查询复杂度。

        Returns:
            recalled zone 分配比例 (0.0-1.0)。
        """
        if query_class == QueryClass.LIGHT:
            return self._config.light_budget_pct
        if query_class == QueryClass.HEAVY:
            return self._config.heavy_budget_pct
        # MEDIUM (and any future class defaults to MEDIUM)
        return self._config.medium_budget_pct


def classify_and_allocate(
    intent: str | None,
    message_length: int,
    history_length: int,
    window_size: int | None = None,
    config: Settings | None = None,
) -> tuple[QueryClass, dict[str, int]]:
    """便捷函数：一步完成查询分类 + 预算分配。

    组合 QueryClassifier.classify() + BudgetAllocator.allocate()，
    减少调用方样板代码。

    Args:
        intent: 意图分类标签。
        message_length: 用户输入字符数。
        history_length: 当前会话前序轮数。
        window_size: 上下文窗口总 token 数，None 使用 config 默认。
        config: Settings 实例，None 使用模块单例 settings。

    Returns:
        (QueryClass, zone_budget_dict) 元组。
    """
    qc = QueryClassifier.classify(intent, message_length, history_length)
    allocator = BudgetAllocator(config)
    budget = allocator.allocate(qc, window_size)
    return qc, budget


# ═══════════════════════════════════════════════════════════════════════
# Phase 63 Batch 2 — 自动降级引擎
# ═══════════════════════════════════════════════════════════════════════


class DegradationLevel(StrEnum):
    """降级级别——从轻到重，越高表示越激进地砍非核心步骤。

    NONE:   预算充足，全功能运行。
    LIGHT:  跳过事实抽取（非核心 LLM 调用，节省 ~700 tokens）。
    MEDIUM: 跳过事实抽取 + 过滤温层召回摘要。
    HEAVY:  跳过事实抽取 + 过滤温层 + 缩减召回数量（最后手段）。
    """

    NONE = "none"
    LIGHT = "light"
    MEDIUM = "medium"
    HEAVY = "heavy"


@dataclass
class DegradationPlan:
    """降级计划——AutoDegradationEngine.evaluate() 的决策输出。

    供管线步骤门控函数（如 should_skip_step）消费。
    每个 bool 字段对应一个可降级的管线步骤。

    Attributes:
        level: 降级级别（NONE → 无降级，HEAVY → 最激进）。
        skip_fact_extraction: 跳过事实抽取步骤。
        skip_warm_summaries: 过滤 warm-tier 召回条目。
        reduce_recall_to: 缩减召回数量至此值（None=不缩减）。
        reason: 人类可读的降级原因。
    """

    level: DegradationLevel
    skip_fact_extraction: bool = False
    skip_warm_summaries: bool = False
    reduce_recall_to: int | None = None
    reason: str = ""


class AutoDegradationEngine:
    """自动降级引擎——运行时 token 预算监控 + 超标降级决策。

    降级优先级（从先到后——先砍代价最小的）:
      1. 事实抽取 (fact_extraction) — 非核心 LLM 调用，token 紧张时首先砍。
      2. 温层摘要 (warm_summaries) — warm-tier 召回有益但非必需。
      3. 召回数量 (recall_count) — 减少 top_k 牺牲召回覆盖率，最后手段。

    降级触发基于 recalled zone 用量 vs recalled 预算的比率:
      - 用量 >  100% 预算 → LIGHT（跳过事实抽取）
      - 用量 >  120% 预算 → MEDIUM（跳过事实抽取 + 温层过滤）
      - 用量 >  150% 预算 → HEAVY（跳过事实抽取 + 温层过滤 + 召回缩减至 50%）

    设计原则:
      - 接受 BudgetAllocator 产出的四区预算作为目标。
      - 调用方负责传入 estimated_recall_tokens（当前召回条目的 token 估算）。
      - 纯计算引擎，不访问 I/O，方便测试。
      - 阈值可通过子类化覆盖以支持 A/B 实验。
    """

    # ── 降级触发阈值（recalled 用量 / recalled 预算）──
    LIGHT_DEGRADE_RATIO: float = 1.0  # > 100% → LIGHT
    MEDIUM_DEGRADE_RATIO: float = 1.2  # > 120% → MEDIUM
    HEAVY_DEGRADE_RATIO: float = 1.5  # > 150% → HEAVY

    # ── HEAVY 降级时缩减 recall 的比例 ──
    HEAVY_RECALL_REDUCTION_PCT: float = 0.5  # 砍到原来的 50%

    def __init__(self, config: Settings | None = None) -> None:
        """初始化降级引擎。

        Args:
            config: Settings 实例，None 时使用模块级单例 settings。
        """
        from src.config import settings as _default_settings

        self._config = config or _default_settings

    @property
    def is_enabled(self) -> bool:
        """Feature flag 快捷访问——关闭时调用方应跳过降级评估。"""
        return self._config.budget_enabled

    def evaluate(
        self,
        budget: dict[str, int],
        estimated_recall_tokens: int = 0,
        recall_count: int = 0,
        warm_count: int = 0,
    ) -> DegradationPlan:
        """评估当前管线状态并生成降级计划。

        核心逻辑：比较 estimated_recall_tokens 与 budget["recalled"] 的比率，
        超出阈值时按优先级逐级降级。

        Args:
            budget: BudgetAllocator.allocate() 产出的四区 token 预算。
            estimated_recall_tokens: 当前召回条目的 token 估算总和。
            recall_count: 当前召回条目总数（用于计算缩减后的数量）。
            warm_count: 其中 warm-tier 条目数（MEDIUM 降级时过滤对象）。

        Returns:
            DegradationPlan——管线步骤据此决定跳过/缩减哪些操作。
        """
        recalled_budget = budget.get("recalled", 0)

        # 安全钳：预算为 0 时（极端配置）直接 HEAVY 降级
        if recalled_budget <= 0:
            return DegradationPlan(
                level=DegradationLevel.HEAVY,
                skip_fact_extraction=True,
                skip_warm_summaries=True,
                reduce_recall_to=max(1, int(recall_count * self.HEAVY_RECALL_REDUCTION_PCT)),
                reason="recalled 预算为 0，强制 HEAVY 降级",
            )

        ratio = estimated_recall_tokens / recalled_budget

        # ── HEAVY: > 150% 预算 ──
        if ratio > self.HEAVY_DEGRADE_RATIO:
            reduced = max(1, int(recall_count * self.HEAVY_RECALL_REDUCTION_PCT))
            return DegradationPlan(
                level=DegradationLevel.HEAVY,
                skip_fact_extraction=True,
                skip_warm_summaries=True,
                reduce_recall_to=reduced,
                reason=(
                    f"召回 token ({estimated_recall_tokens}) 超过 recalled 预算 "
                    f"({recalled_budget}) 的 {self.HEAVY_DEGRADE_RATIO:.0%}，"
                    f"触发 HEAVY 降级：跳过事实抽取 + 过滤温层 + 召回缩减至 {reduced}"
                ),
            )

        # ── MEDIUM: > 120% 预算 ──
        if ratio > self.MEDIUM_DEGRADE_RATIO:
            warm_note = f"（含 {warm_count} 条温层）" if warm_count > 0 else ""
            return DegradationPlan(
                level=DegradationLevel.MEDIUM,
                skip_fact_extraction=True,
                skip_warm_summaries=warm_count > 0,
                reason=(
                    f"召回 token ({estimated_recall_tokens}) 超过 recalled 预算 "
                    f"({recalled_budget}) 的 {self.MEDIUM_DEGRADE_RATIO:.0%}，"
                    f"触发 MEDIUM 降级：跳过事实抽取 + 过滤温层摘要{warm_note}"
                ),
            )

        # ── LIGHT: > 100% 预算 ──
        if ratio > self.LIGHT_DEGRADE_RATIO:
            return DegradationPlan(
                level=DegradationLevel.LIGHT,
                skip_fact_extraction=True,
                reason=(
                    f"召回 token ({estimated_recall_tokens}) 超过 recalled 预算 "
                    f"({recalled_budget})，触发 LIGHT 降级：跳过事实抽取"
                ),
            )

        # ── 预算充足 ──
        return DegradationPlan(
            level=DegradationLevel.NONE,
            reason=(
                f"召回 token ({estimated_recall_tokens}) 在 recalled 预算 "
                f"({recalled_budget}) 范围内，无需降级"
            ),
        )


def should_skip_step(step_name: str, plan: DegradationPlan | None) -> bool:
    """管线步骤门控——查询降级计划决定是否跳过指定步骤。

    供 `api/routers/chat.py` 的每步前 budget check 使用。

    Args:
        step_name: 步骤标识符——"fact_extraction" | "warm_summaries"。
        plan: AutoDegradationEngine.evaluate() 产出的降级计划，None 表示不跳过。

    Returns:
        True 表示该步骤应被跳过。
    """
    if plan is None or plan.level == DegradationLevel.NONE:
        return False
    if step_name == "fact_extraction":
        return plan.skip_fact_extraction
    if step_name == "warm_summaries":
        return plan.skip_warm_summaries
    return False

"""Planner 透明化引擎包 — L1 意图分类 + L2 任务规划 + L2.5 重规划检测 + L3 规划反思 + 记忆引导。

导出：
- PlannerEngine: L1 意图分类器（5 类 LLM 分类）
- PlanGenerator: L2 任务规划器（子任务 DAG 分解）
- ReplanDetector: L2.5 重规划检测器（意图漂移 + 修正计划 + 步骤执行监控）
- ReflectionEngine: L3 规划反思器（事后反思 + 改进建议）
- PlanHistoryRetriever: 记忆引导规划 — 检索相似历史计划 + 提取成败模式 (Phase 60)
- PostMortemDeviation / PostMortemResult: 事后总结 — 对比计划与实际执行偏差 (Phase 61 B1)
- ReflectionInsight: 元知识洞察 — 从多次反思提取跨计划通用模式 (Phase 61 B2)
- IntentResult / PlanResult / ReplanResult / ReflectionResult: 不可变结果数据类
- HistoricalPlan / PlanHistoryResult / PatternReport: 记忆引导数据类 (Phase 60)
- StepStatus / PlanStepRecord: 步骤执行状态追踪 (Phase 57 B1)
- PartialReplanResult: 局部重规划结果 (Phase 57 B2)
- INTENT_CATEGORIES / INTENT_COLORS: 意图类别常量
"""

from __future__ import annotations

from src.planner.intent import INTENT_CATEGORIES, INTENT_COLORS, IntentResult, PlannerEngine
from src.planner.plan import PlanGenerator, PlanResult
from src.planner.plan_history import (
    HistoricalPlan,
    PatternReport,
    PlanHistoryResult,
    PlanHistoryRetriever,
)
from src.planner.reflection import (
    PostMortemDeviation,
    PostMortemResult,
    ReflectionEngine,
    ReflectionInsight,
    ReflectionResult,
)
from src.planner.replan import (
    PartialReplanResult,
    PlanStepRecord,
    ReplanDetector,
    ReplanResult,
    StepStatus,
)

__all__ = [
    "INTENT_CATEGORIES",
    "INTENT_COLORS",
    "HistoricalPlan",
    "IntentResult",
    "PartialReplanResult",
    "PatternReport",
    "PlanGenerator",
    "PlanHistoryResult",
    "PlanHistoryRetriever",
    "PlanResult",
    "PlannerEngine",
    "PostMortemDeviation",
    "PostMortemResult",
    "ReflectionEngine",
    "ReflectionInsight",
    "ReflectionResult",
    "ReplanDetector",
    "ReplanResult",
    "PlanStepRecord",
    "StepStatus",
]

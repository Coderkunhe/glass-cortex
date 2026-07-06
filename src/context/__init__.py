"""上下文工程包——溢出模拟引擎 + 窗口分区计算 + 关键信息保护。"""

from src.context.budget import (
    AutoDegradationEngine,
    BudgetAllocator,
    DegradationLevel,
    DegradationPlan,
    QueryClass,
    QueryClassifier,
    classify_and_allocate,
    should_skip_step,
)
from src.context.overflow_sim import (
    STRATEGY_PERSONAS,
    OverflowSimResult,
    compare_strategies,
    simulate_overflow,
)
from src.context.partition import (
    ContextPartitions,
    ZonePartition,
    compute_partitions,
)
from src.context.protector import (
    CriticalInfoProtector,
    ProtectCategory,
    ProtectedSpan,
    ProtectionReport,
    TemporalAnchor,
    TemporalFidelityEvaluator,
    TemporalFidelityReport,
    TemporalFidelityResult,
    VerificationResult,
)
from src.context.session_boundary import (
    RegressionSummary,
    SessionBoundaryDetector,
    SessionBoundaryResult,
)

__all__ = [
    "AutoDegradationEngine",
    "BudgetAllocator",
    "ContextPartitions",
    "CriticalInfoProtector",
    "DegradationLevel",
    "DegradationPlan",
    "OverflowSimResult",
    "ProtectCategory",
    "ProtectedSpan",
    "ProtectionReport",
    "QueryClass",
    "QueryClassifier",
    "RegressionSummary",
    "STRATEGY_PERSONAS",
    "SessionBoundaryDetector",
    "SessionBoundaryResult",
    "TemporalAnchor",
    "TemporalFidelityEvaluator",
    "TemporalFidelityReport",
    "TemporalFidelityResult",
    "VerificationResult",
    "ZonePartition",
    "classify_and_allocate",
    "compare_strategies",
    "compute_partitions",
    "should_skip_step",
    "simulate_overflow",
]

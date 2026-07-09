"""全局配置——Settings 数据类（路径/Embedding/LLM 参数）+ Profile 名称消毒。

B77: 首批嵌套化——PathsConfig / EmbedConfig / LLMConfig / PricingConfig。
B78: 二批嵌套化——RecallConfig / DedupConfig / ContextConfig / MemoryConfig / ForgettingConfig。
B79: 三批嵌套化——FactExtractionConfig / PlannerConfig / PlanHistoryConfig。
B80: 四批嵌套化——TierConfig / ConsolidationConfig / RouterConfig / LocalRouterConfig。
B81: 收官嵌套化——ResponseCacheConfig / BudgetConfig / SessionBoundaryConfig / ObservabilityConfig。
Settings 100% 嵌套化完成。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypedDict

# ── 文件名/URL 常量（避免硬编码散落各模块）──
DB_FILENAME = "memory.db"
INDEX_FILENAME = "index.usearch"
LOG_FILENAME = "glasscortex.log"
DEFAULT_PROFILE = "default"


class SettingsExtra(TypedDict, total=False):
    """Known keys for the Settings.extra extension slot.

    ``total=False`` means all keys are optional — consumers can omit any key
    without mypy errors. Keys not listed here pass at runtime but are flagged
    by the type checker on access.

    This is the first TypedDict in the codebase; the pattern will be reused
    for I-102 (8 × dict[str, object]) and I-110 (read-path type safety).
    """

    experiment_id: str


# ══════════════════════════════════════════════════════════════════════
# B77: 嵌套配置 dataclass（首 4 个分组）
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class PathsConfig:
    """路径相关配置——B77 从 Settings 扁平字段提取。

    所有字段都有生产级默认值，实验时创建新实例即可。
    """

    data_dir: Path = Path("data")
    db_path: Path | None = None  # None 时默认 profile_data_dir / DB_FILENAME
    index_path: Path | None = None  # None 时默认 profile_data_dir / INDEX_FILENAME
    env_file: Path = Path(".env")
    user_profile: str = DEFAULT_PROFILE

    @property
    def profile_data_dir(self) -> Path:
        """Profile 数据目录路径：``data/{user_profile}``。"""
        return self.data_dir / self.user_profile

    @property
    def resolved_db_path(self) -> Path:
        """解析后的 SQLite 数据库路径——显式设置者优先，否则回退到 profile 目录。"""
        return self.db_path if self.db_path is not None else self.profile_data_dir / DB_FILENAME

    @property
    def resolved_index_path(self) -> Path:
        """解析后的向量索引路径——显式设置者优先，否则回退到 profile 目录。"""
        return (
            self.index_path
            if self.index_path is not None
            else self.profile_data_dir / INDEX_FILENAME
        )

    @staticmethod
    def sanitize_profile_name(name: str) -> str:
        """将任意字符串映射为安全的文件系统目录名。

        只保留 [a-zA-Z0-9_-]，连续特殊字符压缩为单个下划线，
        首尾剥离，空/点/点点 → "default"。
        """
        if not name or not name.strip():
            return DEFAULT_PROFILE
        safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip())
        safe = re.sub(r"_+", "_", safe)
        safe = safe.strip("-_")
        if safe in ("", ".", "..") or safe.isdigit():
            return DEFAULT_PROFILE
        return safe


@dataclass(frozen=True)
class EmbedConfig:
    """嵌入模型配置——B77 从 Settings 扁平字段提取。"""

    embed_model: str = "all-MiniLM-L6-v2"
    embed_dim: int = 384
    embed_device: str = "cpu"


@dataclass(frozen=True)
class LLMConfig:
    """大语言模型配置——B77 从 Settings 扁平字段提取。"""

    llm_model: str = "deepseek-chat"
    llm_base_url: str = "https://api.deepseek.com"
    llm_api_key_env: str = "DEEPSEEK_API_KEY"
    llm_max_tokens: int = 1024
    llm_temperature: float = 0.7
    llm_timeout: float = 60.0  # OpenAI 客户端请求超时（秒），默认 60s
    fact_extraction_max_tokens: int = 512
    # 可用模型列表 — 用于 Web UI 下拉选择
    available_models: tuple[str, ...] = ("deepseek-chat", "deepseek-reasoner")


@dataclass(frozen=True)
class PricingConfig:
    """定价配置——B77 从 Settings 扁平字段提取。"""

    llm_input_price_per_1m: float = 1.0  # ¥1 per 1M input tokens (DeepSeek 默认定价)
    llm_output_price_per_1m: float = 2.0  # ¥2 per 1M output tokens (DeepSeek 默认定价)


# ══════════════════════════════════════════════════════════════════════
# B78: 嵌套配置 dataclass（第 2 批 5 个分组）
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class RecallConfig:
    """召回引擎配置——B78 从 Settings 扁平字段提取。"""

    recall_search_k: int = 20
    recall_top_k: int = 5
    recall_threshold: float = 0.1
    recall_truncation_threshold: float = 0.0  # 综合评分截断阈值，0=禁用
    compress_threshold: int = 500  # Token 数阈值，超过此值的消息触发 LLM 压缩


@dataclass(frozen=True)
class DedupConfig:
    """语义去重 + MMR 多样性配置——B78 从 Settings 扁平字段提取。"""

    semantic_dedup_threshold: float = 0.92  # 余弦相似度 ≥ 此值视为重复候选
    mmr_enabled: bool = True  # 启用 MMR 多样性重排
    mmr_lambda: float = 0.7  # 1.0=纯相关性, 0.0=纯多样性


@dataclass(frozen=True)
class ContextConfig:
    """上下文窗口配置——B78 从 Settings 扁平字段提取。"""

    context_window_size: int = 4096
    context_overflow_strategy: str = "prioritize"


@dataclass(frozen=True)
class MemoryConfig:
    """记忆参数配置——B78 从 Settings 扁平字段提取。"""

    default_importance: float = 0.5
    default_decay_lambda: float = 0.1
    default_confidence: float = 0.5
    assistant_importance: float = 0.4


@dataclass(frozen=True)
class ForgettingConfig:
    """遗忘/增强配置——B78 从 Settings 扁平字段提取。"""

    strengthen_boost: float = 0.3
    strength_cap: float = 1.0


# ══════════════════════════════════════════════════════════════════════
# B79: 嵌套配置 dataclass（第 3 批 3 个分组）
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class FactExtractionConfig:
    """事实抽取配置——B79 从 Settings 扁平字段提取。"""

    dedup_threshold: float = 0.85  # 旧数据兼容：余弦去重阈值（三元组路径不使用）
    fact_delta_base: float = 0.05
    fact_delta_sim_multiplier: float = 0.1
    fact_initial_confidence: float = 0.6
    conflict_confidence_penalty: float = 0.2  # 三元组冲突时置信度降低幅度
    loss_detection_enabled: bool = True  # 抽取 prompt 中启用完整性自检


@dataclass(frozen=True)
class PlannerConfig:
    """Planner 意图分类 + 任务规划配置——B79 从 Settings 扁平字段提取。"""

    planner_enabled: bool = True
    planner_max_tokens: int = 128
    planner_temperature: float = 0.1
    plan_generation_enabled: bool = True  # L2 任务规划生成开关
    plan_storage_enabled: bool = False  # 任务规划持久化开关


@dataclass(frozen=True)
class PlanHistoryConfig:
    """历史计划检索配置——B79 从 Settings 扁平字段提取。"""

    plan_history_enabled: bool = False  # 历史计划检索总开关
    plan_history_search_limit: int = 20  # 检索候选计划的最大数量
    plan_history_top_k: int = 3  # 返回的最相似历史计划数量
    plan_history_similarity_threshold: float = 0.3  # 最低相似度阈值


# ══════════════════════════════════════════════════════════════════════
# B80: 嵌套配置 dataclass（第 4 批 4 个分组）
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class TierConfig:
    """多层记忆分级配置——B80 从 Settings 扁平字段提取。"""

    tier_enabled: bool = False  # 分级存储总开关
    tier_search_k: int = 30  # 分层模式下 FAISS 搜索候选数
    tier_hot_threshold: float = 0.7  # 热力评分 ≥ 此值 → hot 层
    tier_warm_threshold: float = 0.3  # 热力评分 ≥ 此值 → warm 层
    tier_recency_weight: float = 0.4  # 时间新鲜度权重
    tier_access_weight: float = 0.3  # 访问频率权重
    tier_importance_weight: float = 0.3  # 重要性权重


@dataclass(frozen=True)
class ConsolidationConfig:
    """记忆固化配置——B80 从 Settings 扁平字段提取。"""

    consolidation_enabled: bool = False  # 日终慢降温总开关
    consolidation_interval_seconds: float = 86400.0  # 降温间隔（默认 24h）
    consolidation_cooldown_rate: float = 0.02  # 每次降温 importance 衰减比例
    consolidation_cooldown_min_importance: float = 0.05  # importance 衰减下限
    consolidation_grace_period_hours: float = 24.0  # 新/刚召回记忆豁免窗口
    consolidation_access_boost_rate: float = 0.2  # 访问频率 boost 系数
    consolidation_access_boost_max: float = 0.5  # 单次提升倍数上限
    consolidation_protect_consecutive_n: int = 3  # 连续召回 N 次触发遗忘豁免
    consolidation_protect_window_hours: float = 168.0  # 连续召回窗口（7 天）
    consolidation_protect_boost: float = 0.3  # 豁免触发后 importance 增量


@dataclass(frozen=True)
class RouterConfig:
    """模型路由配置——B80 从 Settings 扁平字段提取。"""

    routing_enabled: bool = False  # 模型路由总开关
    simple_model: str = "deepseek-chat"  # 简单意图使用模型
    complex_model: str = "deepseek-reasoner"  # 复杂意图使用模型
    simple_intents: tuple[str, ...] = ("闲聊", "澄清")  # 简单意图标签


@dataclass(frozen=True)
class LocalRouterConfig:
    """敏感信息本地分流配置——B80 从 Settings 扁平字段提取。"""

    local_routing_enabled: bool = False  # 本地分流总开关


# ══════════════════════════════════════════════════════════════════════
# B81: 嵌套配置 dataclass（第 5 批 4 个分组 — 收官）
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class ResponseCacheConfig:
    """语义响应缓存配置——B81 从 Settings 扁平字段提取。"""

    enabled: bool = False  # 语义响应缓存总开关，默认关闭
    min_similarity: float = 0.95  # 余弦相似度阈值（L2 归一化向量点积）
    max_entries: int = 64  # FIFO 容量上限


@dataclass(frozen=True)
class BudgetConfig:
    """上下文预算配置——B81 从 Settings 扁平字段提取。"""

    enabled: bool = False  # 上下文预算总开关，默认关闭
    light_pct: float = 0.10  # LIGHT 查询 → recalled zone 占比
    medium_pct: float = 0.40  # MEDIUM 查询 → recalled zone 占比
    heavy_pct: float = 0.60  # HEAVY 查询 → recalled zone 占比


@dataclass(frozen=True)
class SessionBoundaryConfig:
    """会话边界检测配置——B81 从 Settings 扁平字段提取。"""

    enabled: bool = False  # feature flag, default off
    session_gap_seconds: float = 1800.0  # 30 min 无活动视为新会话
    num_sessions_for_regression: int = 3  # 回归摘要回顾的最近会话数


@dataclass(frozen=True)
class ObservabilityConfig:
    """可观测性配置——B81 从 Settings 扁平字段提取。"""

    log_level: str = "INFO"  # 日志级别：DEBUG | INFO | WARNING | ERROR
    trace_retention_limit: int = 0  # 0 = 无限，>0 = 保留最近 N 条管道 trace


# ══════════════════════════════════════════════════════════════════════
# Settings — 全局配置聚合根
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class Settings:
    """全局配置，单一入口。实验时创建新实例即可 A/B 对比。

    B77: paths / embed / llm / pricing 四个分组已提取为嵌套 dataclass。
    B78: recall / dedup / context / memory / forgetting 五个分组已提取。
    B79: fact_extraction / planner / plan_history 三个分组已提取。
    B80: tier / consolidation / router / local_router 四个分组已提取。
    B81: response_cache / budget / session_boundary / observability 四分组已提取。
    Settings 100% 嵌套化完成。向后兼容 property 保持消费者无感。
    """

    # ── B77: 嵌套配置 ──
    paths: PathsConfig = field(default_factory=PathsConfig)
    embed: EmbedConfig = field(default_factory=EmbedConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    pricing: PricingConfig = field(default_factory=PricingConfig)

    # ── B78: 嵌套配置 ──
    recall: RecallConfig = field(default_factory=RecallConfig)
    dedup: DedupConfig = field(default_factory=DedupConfig)
    context: ContextConfig = field(default_factory=ContextConfig)
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    forgetting: ForgettingConfig = field(default_factory=ForgettingConfig)
    # 遗忘引擎强度公式（按小时衰减）：S₀ × e^(-λ × hours)
    # 数据库中的 lambda 是小时级衰减率

    # ── B79: 嵌套配置 ──
    fact_extraction: FactExtractionConfig = field(default_factory=FactExtractionConfig)
    planner: PlannerConfig = field(default_factory=PlannerConfig)
    plan_history: PlanHistoryConfig = field(default_factory=PlanHistoryConfig)

    # ── B80: 嵌套配置 ──
    tier: TierConfig = field(default_factory=TierConfig)
    consolidation: ConsolidationConfig = field(default_factory=ConsolidationConfig)
    router: RouterConfig = field(default_factory=RouterConfig)
    local_router: LocalRouterConfig = field(default_factory=LocalRouterConfig)

    # ── B81: 嵌套配置 ──
    response_cache: ResponseCacheConfig = field(default_factory=ResponseCacheConfig)
    budget: BudgetConfig = field(default_factory=BudgetConfig)
    session_boundary: SessionBoundaryConfig = field(default_factory=SessionBoundaryConfig)
    observability: ObservabilityConfig = field(default_factory=ObservabilityConfig)

    # ── 扩展槽 ──
    extra: SettingsExtra = field(default_factory=dict)  # type: ignore[assignment]  # TypedDict vs dict() factory — known mypy edge case

    # ═══════════════════════════════════════════════════════════════
    # B77: 向后兼容 property — 委托到嵌套 dataclass
    # ═══════════════════════════════════════════════════════════════

    # ── PathsConfig ──
    @property
    def data_dir(self) -> Path:
        return self.paths.data_dir

    @property
    def db_path(self) -> Path | None:
        return self.paths.db_path

    @property
    def index_path(self) -> Path | None:
        return self.paths.index_path

    @property
    def env_file(self) -> Path:
        return self.paths.env_file

    @property
    def user_profile(self) -> str:
        return self.paths.user_profile

    @property
    def profile_data_dir(self) -> Path:
        return self.paths.profile_data_dir

    @property
    def resolved_db_path(self) -> Path:
        return self.paths.resolved_db_path

    @property
    def resolved_index_path(self) -> Path:
        return self.paths.resolved_index_path

    # ── EmbedConfig ──
    @property
    def embed_model(self) -> str:
        return self.embed.embed_model

    @property
    def embed_dim(self) -> int:
        return self.embed.embed_dim

    @property
    def embed_device(self) -> str:
        return self.embed.embed_device

    # ── LLMConfig ──
    @property
    def llm_model(self) -> str:
        return self.llm.llm_model

    @property
    def llm_base_url(self) -> str:
        return self.llm.llm_base_url

    @property
    def llm_api_key_env(self) -> str:
        return self.llm.llm_api_key_env

    @property
    def llm_max_tokens(self) -> int:
        return self.llm.llm_max_tokens

    @property
    def llm_temperature(self) -> float:
        return self.llm.llm_temperature

    @property
    def llm_timeout(self) -> float:
        return self.llm.llm_timeout

    @property
    def fact_extraction_max_tokens(self) -> int:
        return self.llm.fact_extraction_max_tokens

    @property
    def available_models(self) -> tuple[str, ...]:
        return self.llm.available_models

    # ── PricingConfig ──
    @property
    def llm_input_price_per_1m(self) -> float:
        return self.pricing.llm_input_price_per_1m

    @property
    def llm_output_price_per_1m(self) -> float:
        return self.pricing.llm_output_price_per_1m

    # ── RecallConfig ──
    @property
    def recall_search_k(self) -> int:
        return self.recall.recall_search_k

    @property
    def recall_top_k(self) -> int:
        return self.recall.recall_top_k

    @property
    def recall_threshold(self) -> float:
        return self.recall.recall_threshold

    @property
    def recall_truncation_threshold(self) -> float:
        return self.recall.recall_truncation_threshold

    @property
    def compress_threshold(self) -> int:
        return self.recall.compress_threshold

    # ── DedupConfig ──
    @property
    def semantic_dedup_threshold(self) -> float:
        return self.dedup.semantic_dedup_threshold

    @property
    def mmr_enabled(self) -> bool:
        return self.dedup.mmr_enabled

    @property
    def mmr_lambda(self) -> float:
        return self.dedup.mmr_lambda

    # ── ContextConfig ──
    @property
    def context_window_size(self) -> int:
        return self.context.context_window_size

    @property
    def context_overflow_strategy(self) -> str:
        return self.context.context_overflow_strategy

    # ── MemoryConfig ──
    @property
    def default_importance(self) -> float:
        return self.memory.default_importance

    @property
    def default_decay_lambda(self) -> float:
        return self.memory.default_decay_lambda

    @property
    def default_confidence(self) -> float:
        return self.memory.default_confidence

    @property
    def assistant_importance(self) -> float:
        return self.memory.assistant_importance

    # ── ForgettingConfig ──
    @property
    def strengthen_boost(self) -> float:
        return self.forgetting.strengthen_boost

    @property
    def strength_cap(self) -> float:
        return self.forgetting.strength_cap

    # ── FactExtractionConfig ──
    @property
    def dedup_threshold(self) -> float:
        return self.fact_extraction.dedup_threshold

    @property
    def fact_delta_base(self) -> float:
        return self.fact_extraction.fact_delta_base

    @property
    def fact_delta_sim_multiplier(self) -> float:
        return self.fact_extraction.fact_delta_sim_multiplier

    @property
    def fact_initial_confidence(self) -> float:
        return self.fact_extraction.fact_initial_confidence

    @property
    def conflict_confidence_penalty(self) -> float:
        return self.fact_extraction.conflict_confidence_penalty

    @property
    def loss_detection_enabled(self) -> bool:
        return self.fact_extraction.loss_detection_enabled

    # ── PlannerConfig ──
    @property
    def planner_enabled(self) -> bool:
        return self.planner.planner_enabled

    @property
    def planner_max_tokens(self) -> int:
        return self.planner.planner_max_tokens

    @property
    def planner_temperature(self) -> float:
        return self.planner.planner_temperature

    @property
    def plan_generation_enabled(self) -> bool:
        return self.planner.plan_generation_enabled

    @property
    def plan_storage_enabled(self) -> bool:
        return self.planner.plan_storage_enabled

    # ── PlanHistoryConfig ──
    @property
    def plan_history_enabled(self) -> bool:
        return self.plan_history.plan_history_enabled

    @property
    def plan_history_search_limit(self) -> int:
        return self.plan_history.plan_history_search_limit

    @property
    def plan_history_top_k(self) -> int:
        return self.plan_history.plan_history_top_k

    @property
    def plan_history_similarity_threshold(self) -> float:
        return self.plan_history.plan_history_similarity_threshold

    # ═══════════════════════════════════════════════════════════════
    # B80: 向后兼容 property — 委托到嵌套 dataclass
    # ═══════════════════════════════════════════════════════════════

    # ── TierConfig ──
    @property
    def tier_enabled(self) -> bool:
        return self.tier.tier_enabled

    @property
    def tier_search_k(self) -> int:
        return self.tier.tier_search_k

    @property
    def tier_hot_threshold(self) -> float:
        return self.tier.tier_hot_threshold

    @property
    def tier_warm_threshold(self) -> float:
        return self.tier.tier_warm_threshold

    @property
    def tier_recency_weight(self) -> float:
        return self.tier.tier_recency_weight

    @property
    def tier_access_weight(self) -> float:
        return self.tier.tier_access_weight

    @property
    def tier_importance_weight(self) -> float:
        return self.tier.tier_importance_weight

    # ── ConsolidationConfig ──
    @property
    def consolidation_enabled(self) -> bool:
        return self.consolidation.consolidation_enabled

    @property
    def consolidation_interval_seconds(self) -> float:
        return self.consolidation.consolidation_interval_seconds

    @property
    def consolidation_cooldown_rate(self) -> float:
        return self.consolidation.consolidation_cooldown_rate

    @property
    def consolidation_cooldown_min_importance(self) -> float:
        return self.consolidation.consolidation_cooldown_min_importance

    @property
    def consolidation_grace_period_hours(self) -> float:
        return self.consolidation.consolidation_grace_period_hours

    @property
    def consolidation_access_boost_rate(self) -> float:
        return self.consolidation.consolidation_access_boost_rate

    @property
    def consolidation_access_boost_max(self) -> float:
        return self.consolidation.consolidation_access_boost_max

    @property
    def consolidation_protect_consecutive_n(self) -> int:
        return self.consolidation.consolidation_protect_consecutive_n

    @property
    def consolidation_protect_window_hours(self) -> float:
        return self.consolidation.consolidation_protect_window_hours

    @property
    def consolidation_protect_boost(self) -> float:
        return self.consolidation.consolidation_protect_boost

    # ── RouterConfig ──
    @property
    def routing_enabled(self) -> bool:
        return self.router.routing_enabled

    @property
    def simple_model(self) -> str:
        return self.router.simple_model

    @property
    def complex_model(self) -> str:
        return self.router.complex_model

    @property
    def simple_intents(self) -> tuple[str, ...]:
        return self.router.simple_intents

    # ── LocalRouterConfig ──
    @property
    def local_routing_enabled(self) -> bool:
        return self.local_router.local_routing_enabled

    # ═══════════════════════════════════════════════════════════════
    # B81: 向后兼容 property — 委托到嵌套 dataclass
    # ═══════════════════════════════════════════════════════════════

    # ── ResponseCacheConfig ──
    @property
    def response_cache_enabled(self) -> bool:
        return self.response_cache.enabled

    @property
    def response_cache_min_similarity(self) -> float:
        return self.response_cache.min_similarity

    @property
    def response_cache_max_entries(self) -> int:
        return self.response_cache.max_entries

    # ── BudgetConfig ──
    @property
    def budget_enabled(self) -> bool:
        return self.budget.enabled

    @property
    def light_budget_pct(self) -> float:
        return self.budget.light_pct

    @property
    def medium_budget_pct(self) -> float:
        return self.budget.medium_pct

    @property
    def heavy_budget_pct(self) -> float:
        return self.budget.heavy_pct

    # ── SessionBoundaryConfig ──
    @property
    def session_boundary_enabled(self) -> bool:
        return self.session_boundary.enabled

    @property
    def session_boundary_session_gap_seconds(self) -> float:
        return self.session_boundary.session_gap_seconds

    @property
    def num_sessions_for_regression(self) -> int:
        return self.session_boundary.num_sessions_for_regression

    # ── ObservabilityConfig ──
    @property
    def log_level(self) -> str:
        return self.observability.log_level

    @property
    def trace_retention_limit(self) -> int:
        return self.observability.trace_retention_limit

    # ── 向后兼容类方法 ──

    @staticmethod
    def sanitize_profile_name(name: str) -> str:
        """将任意字符串映射为安全的文件系统目录名。

        委托到 PathsConfig.sanitize_profile_name。
        """
        return PathsConfig.sanitize_profile_name(name)

    # ═══════════════════════════════════════════════════════════════
    # __post_init__ 验证
    # ═══════════════════════════════════════════════════════════════

    def __post_init__(self) -> None:
        """验证字段组合的合法性——拦截会导致静默异常的值组合。

        仅检查"单个字段合法但组合非法"的场景（如 tier 阈值反转）。
        单字段范围由类型系统 + 调用方自行保证。
        """
        # ── 分层阈值：hot 必须严格高于 warm ──
        #   反转 → TierClassifier 将所有记忆永远打入 cold 层，用户不感知。
        if self.tier_hot_threshold <= self.tier_warm_threshold:
            raise ValueError(
                f"tier_hot_threshold ({self.tier_hot_threshold}) must be > "
                f"tier_warm_threshold ({self.tier_warm_threshold})"
            )

        # ── 预算分配：light ≤ medium ≤ heavy 非严格递增 ──
        #   反转（light > medium 或 medium > heavy）→ BudgetAllocator 行为未定义。
        if not (0 <= self.light_budget_pct <= self.medium_budget_pct <= self.heavy_budget_pct <= 1):
            raise ValueError(
                f"Budget percentages must satisfy 0 <= light ({self.light_budget_pct}) <= "
                f"medium ({self.medium_budget_pct}) <= heavy ({self.heavy_budget_pct}) <= 1"
            )

        # ── 召回容量：搜索候选数不能少于返回数 ──
        if self.recall_search_k < self.recall_top_k:
            raise ValueError(
                f"recall_search_k ({self.recall_search_k}) must be >= "
                f"recall_top_k ({self.recall_top_k})"
            )

        # ── 历史计划容量：同上约束 ──
        if self.plan_history.plan_history_search_limit < self.plan_history.plan_history_top_k:
            raise ValueError(
                f"plan_history_search_limit "
                f"({self.plan_history.plan_history_search_limit}) must be >= "
                f"plan_history_top_k ({self.plan_history.plan_history_top_k})"
            )

        # ── 正数约束：时间间隔和计数不能为负或零 ──
        for name, val in [
            ("consolidation_interval_seconds", self.consolidation_interval_seconds),
            ("consolidation_grace_period_hours", self.consolidation_grace_period_hours),
            ("session_boundary_session_gap_seconds", self.session_boundary_session_gap_seconds),
            ("num_sessions_for_regression", self.num_sessions_for_regression),
        ]:
            if val <= 0:
                raise ValueError(f"{name} must be > 0, got {val}")

    # ═══════════════════════════════════════════════════════════════
    # from_flat — 扁平字段名自动路由到嵌套 dataclass
    # ═══════════════════════════════════════════════════════════════

    @classmethod
    def from_flat(cls, **overrides: Any) -> Settings:
        """用扁平字段名构造 Settings，自动路由到对应的嵌套 dataclass。

        B77: 建立路由表 — paths/embed/llm/pricing 四个域。
        B78: 扩展路由表 — recall/dedup/context/memory/forgetting 五个域。
        B79: 扩展路由表 — fact_extraction/planner/plan_history 三个域。
        B80: 扩展路由表 — tier/consolidation/router/local_router 四个域。
        B81: 扩展路由表 — response_cache/budget/session_boundary/observability 四个域。
        Settings 100% 嵌套化完成。
        """
        _paths_fields = {f.name for f in PathsConfig.__dataclass_fields__.values()}
        _embed_fields = {f.name for f in EmbedConfig.__dataclass_fields__.values()}
        _llm_fields = {f.name for f in LLMConfig.__dataclass_fields__.values()}
        _pricing_fields = {f.name for f in PricingConfig.__dataclass_fields__.values()}
        _recall_fields = {f.name for f in RecallConfig.__dataclass_fields__.values()}
        _dedup_fields = {f.name for f in DedupConfig.__dataclass_fields__.values()}
        _context_fields = {f.name for f in ContextConfig.__dataclass_fields__.values()}
        _memory_fields = {f.name for f in MemoryConfig.__dataclass_fields__.values()}
        _forgetting_fields = {f.name for f in ForgettingConfig.__dataclass_fields__.values()}
        _fact_extraction_fields = {
            f.name for f in FactExtractionConfig.__dataclass_fields__.values()
        }
        _planner_fields = {f.name for f in PlannerConfig.__dataclass_fields__.values()}
        _plan_history_fields = {f.name for f in PlanHistoryConfig.__dataclass_fields__.values()}
        _tier_fields = {f.name for f in TierConfig.__dataclass_fields__.values()}
        _consolidation_fields = {f.name for f in ConsolidationConfig.__dataclass_fields__.values()}
        _router_fields = {f.name for f in RouterConfig.__dataclass_fields__.values()}
        _local_router_fields = {f.name for f in LocalRouterConfig.__dataclass_fields__.values()}
        _response_cache_fields = {f.name for f in ResponseCacheConfig.__dataclass_fields__.values()}
        _budget_fields = {f.name for f in BudgetConfig.__dataclass_fields__.values()}
        _session_boundary_fields = {
            f.name for f in SessionBoundaryConfig.__dataclass_fields__.values()
        }
        _observability_fields = {f.name for f in ObservabilityConfig.__dataclass_fields__.values()}
        _nested_fields = (
            _paths_fields
            | _embed_fields
            | _llm_fields
            | _pricing_fields
            | _recall_fields
            | _dedup_fields
            | _context_fields
            | _memory_fields
            | _forgetting_fields
            | _fact_extraction_fields
            | _planner_fields
            | _plan_history_fields
            | _tier_fields
            | _consolidation_fields
            | _router_fields
            | _local_router_fields
            | _response_cache_fields
            | _budget_fields
            | _session_boundary_fields
            | _observability_fields
        )

        flat: dict[str, Any] = {}
        paths: dict[str, Any] = {}
        embed: dict[str, Any] = {}
        llm: dict[str, Any] = {}
        pricing: dict[str, Any] = {}
        recall: dict[str, Any] = {}
        dedup: dict[str, Any] = {}
        context: dict[str, Any] = {}
        memory: dict[str, Any] = {}
        forgetting: dict[str, Any] = {}
        fact_extraction: dict[str, Any] = {}
        planner: dict[str, Any] = {}
        plan_history: dict[str, Any] = {}
        tier: dict[str, Any] = {}
        consolidation: dict[str, Any] = {}
        router: dict[str, Any] = {}
        local_router: dict[str, Any] = {}
        response_cache: dict[str, Any] = {}
        budget: dict[str, Any] = {}
        session_boundary: dict[str, Any] = {}
        observability: dict[str, Any] = {}

        for k, v in overrides.items():
            if v is None:
                continue
            if k in _paths_fields:
                paths[k] = v
            elif k in _embed_fields:
                embed[k] = v
            elif k in _llm_fields:
                llm[k] = v
            elif k in _pricing_fields:
                pricing[k] = v
            elif k in _recall_fields:
                recall[k] = v
            elif k in _dedup_fields:
                dedup[k] = v
            elif k in _context_fields:
                context[k] = v
            elif k in _memory_fields:
                memory[k] = v
            elif k in _forgetting_fields:
                forgetting[k] = v
            elif k in _fact_extraction_fields:
                fact_extraction[k] = v
            elif k in _planner_fields:
                planner[k] = v
            elif k in _plan_history_fields:
                plan_history[k] = v
            elif k in _tier_fields:
                tier[k] = v
            elif k in _consolidation_fields:
                consolidation[k] = v
            elif k in _router_fields:
                router[k] = v
            elif k in _local_router_fields:
                local_router[k] = v
            elif k in _response_cache_fields:
                response_cache[k] = v
            elif k in _budget_fields:
                budget[k] = v
            elif k in _session_boundary_fields:
                session_boundary[k] = v
            elif k in _observability_fields:
                observability[k] = v
            else:
                flat[k] = v

        return cls(
            paths=PathsConfig(**paths),
            embed=EmbedConfig(**embed),
            llm=LLMConfig(**llm),
            pricing=PricingConfig(**pricing),
            recall=RecallConfig(**recall),
            dedup=DedupConfig(**dedup),
            context=ContextConfig(**context),
            memory=MemoryConfig(**memory),
            forgetting=ForgettingConfig(**forgetting),
            fact_extraction=FactExtractionConfig(**fact_extraction),
            planner=PlannerConfig(**planner),
            plan_history=PlanHistoryConfig(**plan_history),
            tier=TierConfig(**tier),
            consolidation=ConsolidationConfig(**consolidation),
            router=RouterConfig(**router),
            local_router=LocalRouterConfig(**local_router),
            response_cache=ResponseCacheConfig(**response_cache),
            budget=BudgetConfig(**budget),
            session_boundary=SessionBoundaryConfig(**session_boundary),
            observability=ObservabilityConfig(**observability),
            **flat,
        )


# 模块级单例——运行时唯一真实实例
settings = Settings()

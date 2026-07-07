"""GlassCortex REST API 的 Pydantic 请求/响应模型。"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, TypedDict

from pydantic import BaseModel, Field

# ── TypedDict 协议类型 (I-102: 8 × dict[str, object] → TypedDict) ──────
# total=False = 所有键可选，未知键运行时通过但被类型检查器标记。
# B71 I-103 SettingsExtra 建立此模式，I-102 规模化推广。


class Metrics(TypedDict, total=False):
    """管线追踪步骤的 Token/性能指标快照。

    用于 TraceItem.metrics——自由键值对但常见键在此声明以启用 mypy 校验。
    """

    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    session_count: int
    cache_hit: bool


class PlanTrace(TypedDict, total=False):
    """LLM API 调用追踪——planner/reflection/replan 步骤级 trace。

    用于 PlannerClassifyResponse / PlanGenerateResponse / ReplanDetectResponse /
    ReflectionResponse 的 trace 字段。
    """

    model: str
    system_prompt: str
    user_prompt: str
    raw_response: str
    parse_error: str | None
    token_usage: dict[str, int] | None
    elapsed_ms: float
    llm_called: bool


class ConfigSnapshot(TypedDict, total=False):
    """Tier 分级阈值/权重快照。

    用于 TierDistributionResponse.config。
    """

    hot_threshold: float
    warm_threshold: float
    recall_top_k: int
    tier_enabled: bool
    tier_hot_threshold: float
    tier_warm_threshold: float
    tier_recency_weight: float
    tier_access_weight: float
    tier_importance_weight: float


class ExperimentSettings(TypedDict, total=False):
    """A/B 实验预设的参数覆盖。

    用于 ExperimentPreset.settings_a/b · ExperimentRunRequest.settings_a/b ·
    ExperimentResultSchema.settings。
    """

    recall_top_k: int
    temperature: float
    llm_model: str
    hot_threshold: float
    warm_threshold: float


# ── 健康检查 ──────────────────────────────────────────────────────────


class HealthComponent(BaseModel):
    """单个组件的健康检查结果。"""

    status: str  # "ok" | "warn" | "error"
    latency_ms: float
    detail: str


class HealthResponse(BaseModel):
    """跨所有组件的聚合健康检查结果。"""

    service: str = "glasscortex"
    components: dict[str, HealthComponent]
    overall_status: str = "ok"
    recovery_suggestions: list[dict[str, str]] = []


# ── 根路由 ────────────────────────────────────────────────────────────


class RootResponse(BaseModel):
    """GET / 响应——服务身份信息。"""

    service: str = "glasscortex"
    version: str = "0.1.0"
    status: str = "ok"


# ── 聊天 ────────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    """POST /chat 请求体。"""

    user_input: str = Field(..., min_length=1, description="用户消息文本")
    context_window_size: int = Field(4096, ge=256, le=32768, description="上下文窗口最大 Token 数")
    context_overflow_strategy: str = Field(
        "prioritize",
        pattern=r"^(truncate|prioritize|summarize)$",
        description="溢出处理策略",
    )
    model: str | None = Field(None, description="LLM 模型名称（默认使用 settings.llm_model）")
    temperature: float | None = Field(None, ge=0.0, le=2.0, description="LLM 温度参数")
    max_tokens: int | None = Field(None, ge=1, le=32768, description="最大生成 Token 数")
    include_system_prompt: bool = Field(
        False,
        description="是否在响应中返回完整 system prompt（Ghost Prompt 视图）",
    )
    session_id: str = Field("", description="会话标识（可选，用于关联 Plan 存储）")
    recall_top_k: int = Field(5, ge=1, le=50, description="召回最大条目数")
    recall_threshold: float = Field(0.1, ge=0.0, le=1.0, description="最低相关性分数阈值")
    recall_mmr_lambda: float | None = Field(
        None, ge=0.0, le=1.0, description="MMR λ 覆盖（None=使用默认 0.7）"
    )


class ContextMeta(BaseModel):
    """上下文窗口组成元数据。

    引擎可能附加额外字段（如 system_prompt、fact_extraction_trace），
    通过 extra="allow" 允许透传而不丢失数据。
    """

    model_config = {"extra": "allow"}

    window_size: int
    base_tokens: int
    memories_before: int
    memories_token_before: int
    memories_after: int
    overflow_applied: bool
    strategy: str
    dropped_count: int
    dropped_items: list[dict[str, Any]]
    user_message_tokens: int
    total_estimated_tokens: int
    usage_pct: float = 0.0
    memories_token_after: int = 0


class ApiTrace(BaseModel):
    """LLM API 调用追踪（完整追踪的子集）。

    引擎可能附加额外字段（如 system_prompt、raw_response、parsed_result），
    通过 extra="allow" 允许透传。
    """

    model_config = {"extra": "allow"}

    caller: str
    model: str
    temperature: float
    max_tokens: int
    elapsed_ms: float
    prompt_tokens: int
    completion_tokens: int


class IntentResult(BaseModel):
    """意图分类结果。"""

    category: str
    confidence: float
    rationale: str


class RoutingInfo(BaseModel):
    """模型路由决策信息——哪个模型被选中、为什么、是否触发回退（Phase 55 Batch 4）。

    在 ``routing_enabled=True`` 且用户未显式指定模型时，每次聊天响应附带此信息。
    """

    model: str = Field(..., description="选中的模型名")
    reason: str = Field(..., description="路由决策理由（人类可读）")
    intent_category: str = Field(..., description="触发决策的意图分类")
    complexity: str = Field(..., description="'simple' 或 'complex'")
    fallback_model: str | None = Field(None, description="回退模型名（主模型故障时使用）")
    fallback_triggered: bool = Field(False, description="本次响应是否触发了回退")
    attempts: int = Field(1, ge=1, le=2, description="模型调用总次数（1=直接成功，2=回退后成功）")


class ColdStartProfile(BaseModel):
    """冷启动状态画像 — q2.19：系统对自身「记忆成熟度」的自我感知。

    在每次聊天响应中注入，让前端可以展示系统「了解用户多少」。
    四个阶段：cold (0-10) → warming (10-50) → near_hot (50-200) → hot (200+)。
    """

    episode_count: int = Field(..., description="累计对话片段数", ge=0)
    phase: str = Field(..., description="阶段标识：cold | warming | near_hot | hot")
    phase_label: str = Field(..., description="中文阶段标签")
    progression_pct: float = Field(..., description="冷→热进度百分比", ge=0.0, le=100.0)
    hint: str | None = Field(None, description="冷启动阶段提示文案")


class ChatResponse(BaseModel):
    """POST /chat 响应体。"""

    response_text: str
    episode_id: int
    intent: IntentResult | None = None
    context_meta: ContextMeta
    api_trace: ApiTrace
    recall_items: list[RecallItem] = []
    system_prompt: str | None = Field(
        None,
        description="完整 system prompt（仅当 include_system_prompt=True 时返回）",
    )
    routing: RoutingInfo | None = Field(
        None,
        description="模型路由决策（仅 routing_enabled 时非空，Phase 55 Batch 4）",
    )
    cold_start_profile: ColdStartProfile | None = Field(
        None,
        description="冷启动状态画像（q2.19 — 系统对自身记忆成熟度的自我感知）",
    )
    from_cache: bool = Field(
        False,
        description="本次响应是否来自语义缓存命中（Phase 62）",
    )
    cache_hit_score: float | None = Field(
        None,
        description="缓存命中时的语义相似度分数（0.0-1.0，仅 from_cache=True 时有值）",
    )


class ChatError(BaseModel):
    """POST /chat 错误响应。"""

    error: str
    detail: str
    response_text: str = ""  # 降级回复（如有）
    recovery_hint: str = ""


# ── 记忆 ──────────────────────────────────────────────────────────


class EpisodeOut(BaseModel):
    """序列化的 episode 记录。"""

    id: int
    content: str
    importance: float
    initial_strength: float
    lambda_: float = Field(..., alias="lambda")
    timestamp: float
    faiss_id: int | None = None
    access_count: int = 0
    last_recall: float | None = None
    tier: str = "warm"  # 记忆分级标签（hot/warm/cold）

    model_config = {"from_attributes": True}


class FactOut(BaseModel):
    """序列化的事实记录。"""

    id: int
    content: str
    confidence: float
    source_episode_id: int | None = None
    faiss_id: int | None = None
    subject: str | None = None
    relation: str | None = None
    object: str | None = None
    timestamp: float | None = None

    model_config = {"from_attributes": True}


class EpisodeRecallItem(BaseModel):
    """Episode 召回条目——对话轮次的语义召回结果。

    仅包含 episode 独有字段和双方共有字段；fact 字段不在本模型定义范围内。
    I-101：从 RecallItem 双用途模型中拆分，与 FactRecallItem 并列。
    """

    id: int
    content: str
    # Episode 特有字段
    importance: float | None = None
    initial_strength: float | None = None
    lambda_: float | None = Field(None, alias="lambda")
    access_count: int | None = None
    last_recall: float | None = None
    # 双方共有
    faiss_id: int | None = None
    timestamp: float | None = None
    # Recall 引擎注入
    composite_score: float | None = None
    similarity: float | None = None
    recall_reason: str | None = None  # q2.18 记忆可解释性——为什么召回这条

    model_config = {"from_attributes": True, "populate_by_name": True}


class FactRecallItem(BaseModel):
    """Fact 召回条目——结构化知识三元组的语义召回结果。

    仅包含 fact 独有字段和双方共有字段；episode 字段不在本模型定义范围内。
    I-101：从 RecallItem 双用途模型中拆分，与 EpisodeRecallItem 并列。
    """

    id: int
    content: str
    # Fact 特有字段
    confidence: float | None = None
    source_episode_id: int | None = None
    subject: str | None = None
    relation: str | None = None
    object_: str | None = Field(None, alias="object")
    # 双方共有
    faiss_id: int | None = None
    timestamp: float | None = None
    # Recall 引擎注入
    composite_score: float | None = None
    similarity: float | None = None
    recall_reason: str | None = None  # q2.18 记忆可解释性——为什么召回这条

    model_config = {"from_attributes": True, "populate_by_name": True}


# I-101：双用途模型拆分——编译期类型为联合类型，运行时按 _row_type 路由
RecallItem = EpisodeRecallItem | FactRecallItem


class RecallRequest(BaseModel):
    """POST /memory/recall 请求体。"""

    query: str = Field(..., min_length=1, description="语义召回查询文本")
    top_k: int = Field(5, ge=1, le=50, description="最大召回条目数")
    threshold: float = Field(0.1, ge=0.0, le=1.0, description="最低相关性分数阈值")
    strengthen: bool = Field(True, description="对返回的 episode 应用召回强度增强")


class RecallResponse(BaseModel):
    """POST /memory/recall 响应体。"""

    query: str
    items: list[RecallItem]
    count: int


# ── 标签详情 ──────────────────────────────────────────────────────────


class FactConfidenceLogItem(BaseModel):
    """单条事实置信度变更日志。"""

    fact_id: int
    confidence_before: float
    confidence_after: float
    reason: str = ""
    logged_at: float | None = None


class TagFactItem(BaseModel):
    """标签详情中的单条事实——含来源 episode 和置信度变更历史。"""

    id: int
    content: str
    confidence: float
    object: str | None = None
    source_episode_id: int | None = None
    episode_content: str | None = None
    episode_timestamp: float | None = None
    created_at: float | None = None
    updated_at: float | None = None
    confidence_log: list[FactConfidenceLogItem] = []

    model_config = {"from_attributes": True}


class TagDetailResponse(BaseModel):
    """GET /memory/tag-detail 响应——标签来源追溯全量数据。"""

    subject: str
    relation: str
    max_confidence: float
    fact_count: int
    distinct_objects: int
    facts: list[TagFactItem]


# ── 分级分布 (Phase 54 Batch 5) ───────────────────────────────────────


class TierDistributionResponse(BaseModel):
    """GET /memory/tiers 响应——三层记忆分级分布 + 每层 episode 摘要。

    包含三个维度：
    1. distribution: 各层 episode 数量统计
    2. episodes_by_tier: 各层 episode id 列表（前端过滤用）
    3. config: 分级阈值/权重快照（前端可能展示调参面板）
    """

    distribution: dict[str, int]  # {"hot": N, "warm": N, "cold": N}
    episodes_by_tier: dict[str, list[int]]  # {"hot": [1,2], ...}
    config: dict[str, object]  # ConfigSnapshot TypedDict available for consumers
    tier_enabled: bool  # 当前是否启用分级


# ── 错误 ───────────────────────────────────────────────────────────


class ErrorResponse(BaseModel):
    """通用错误响应。"""

    error: str
    detail: str
    error_code: str | None = None
    field_errors: list[dict[str, object]] | None = None


# ── Profile 管理 ──────────────────────────────────────────────────────────


class ProfileInfo(BaseModel):
    """单个用户 Profile 的元数据。"""

    name: str
    db_size_bytes: int = 0
    has_index: bool = False
    episode_count: int = 0
    fact_count: int = 0
    index_vectors: int = 0


class ProfileListResponse(BaseModel):
    """GET /profiles 响应——可用 Profile 列表及当前标记。"""

    profiles: list[ProfileInfo]
    current: str


class ProfileSwitchRequest(BaseModel):
    """POST /profiles/switch 请求体。"""

    name: str = Field(..., min_length=1, description="目标 Profile 名称")


class ProfileSwitchResponse(BaseModel):
    """POST /profiles/switch 响应。"""

    profile: str
    status: str  # "switched" | "already_active"


# ── 指标 ───────────────────────────────────────────────────────────


class TokenSummary(BaseModel):
    """GET /metrics/tokens 响应体。"""

    by_call_point: dict[str, dict[str, int]]
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int


class StepSummary(BaseModel):
    """GET /metrics/steps 响应体。"""

    steps: dict[str, dict[str, float]]


# ── 错误码 ───────────────────────────────────────────────────────


class ErrorCode(StrEnum):
    """API 错误响应的标准错误码枚举。"""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    LLM_UNAVAILABLE = "LLM_UNAVAILABLE"
    ENGINE_NOT_INITIALIZED = "ENGINE_NOT_INITIALIZED"
    RECALL_FAILED = "RECALL_FAILED"
    PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND"
    PROFILE_ALREADY_EXISTS = "PROFILE_ALREADY_EXISTS"
    PROFILE_IS_CURRENT = "PROFILE_IS_CURRENT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NOT_FOUND = "NOT_FOUND"


# ── 追踪 ────────────────────────────────────────────────────────────


class TraceItem(BaseModel):
    """序列化的管线追踪记录。"""

    id: int
    session_id: str
    step_name: str
    elapsed_ms: float
    status: str
    metrics: dict[str, object]  # Metrics TypedDict available for consumers
    created_at: float


class TraceCountResponse(BaseModel):
    """GET /traces/count 响应体。"""

    count: int
    session_id: str | None = None
    step_name: str | None = None


class DeleteTracesRequest(BaseModel):
    """POST /traces/delete-old 请求体。"""

    retention_limit: int = Field(..., ge=1, description="最多保留的 Trace 记录条数")


class DeleteTracesResponse(BaseModel):
    """POST /traces/delete-old 响应。"""

    deleted: int
    retention_limit: int


# ── 上下文实验 ───────────────────────────────────────────────────────


class SimulateOverflowRequest(BaseModel):
    """POST /context/simulate-overflow 请求体。"""

    recalled: list[dict[str, object]] = []
    strategy: str = Field("prioritize", pattern=r"^(truncate|prioritize|summarize)$")
    window_size: int = Field(4096, ge=256, le=32768)
    user_input: str = ""
    base_tokens_override: int | None = Field(None, ge=0)


class OverflowSimResponse(BaseModel):
    """单个策略的溢出模拟结果。"""

    strategy: str
    window_size: int
    base_tokens: int
    user_tokens: int
    memories_before: int
    memories_token_before: int
    memories_after: int
    memories_token_after: int
    dropped_count: int
    dropped_items: list[str]
    kept_items: list[dict[str, object]]
    overflow_triggered: bool
    total_estimated_tokens: int
    usage_pct: float
    wasted_tokens: int
    available_tokens: int
    summary_line: str
    strategy_label: str


class CompareStrategiesRequest(BaseModel):
    """POST /context/compare-strategies 请求体。"""

    recalled: list[dict[str, object]] = []
    window_size: int = Field(4096, ge=256, le=32768)
    user_input: str = ""
    base_tokens_override: int | None = Field(None, ge=0)


class CompareStrategiesResponse(BaseModel):
    """三种溢出策略并排对比结果。"""

    truncate: OverflowSimResponse
    prioritize: OverflowSimResponse
    summarize: OverflowSimResponse


# ── 意图分类 + 任务规划 ──────────────────────────────────────────────────


class PlannerClassifyRequest(BaseModel):
    """POST /planner/classify 请求体。"""

    user_msg: str = Field(..., min_length=1, description="待分类的用户消息")


class PlannerClassifyResponse(BaseModel):
    """POST /planner/classify 响应体。"""

    category: str
    confidence: float
    rationale: str
    trace: dict[str, object]  # PlanTrace TypedDict available for consumers


class PlanGenerateRequest(BaseModel):
    """POST /planner/generate-plan 请求体。"""

    user_msg: str = Field(..., min_length=1, description="用户消息文本")
    intent_category: str = Field("提问", description="L1 意图分类结果，用于调整分解粒度")


class SubTaskSchema(BaseModel):
    """单个子任务 — 含 id、描述和前置依赖列表。"""

    id: str
    description: str
    depends_on: list[str] = []


class PlanGenerateResponse(BaseModel):
    """POST /planner/generate-plan 响应体。"""

    subtasks: list[SubTaskSchema]
    dag_edges: list[list[str]]  # [[from_id, to_id], ...]
    rationale: str
    confidence: float
    trace: dict[str, object]  # PlanTrace TypedDict available for consumers


class ReplanDetectRequest(BaseModel):
    """POST /planner/detect-replan 请求体。"""

    original_user_msg: str = Field(..., min_length=1, description="用户原始消息文本")
    original_intent: str = Field("提问", description="原始 L1 意图分类结果")
    revised_user_msg: str = Field(..., min_length=1, description="用户修正后的消息文本")
    original_plan_json: str | None = Field(None, description="原始任务计划 JSON 字符串（可选）")


class ReplanDetectResponse(BaseModel):
    """POST /planner/detect-replan 响应体。"""

    drift_detected: bool
    drift_reason: str
    revised_intent: str
    revised_plan: PlanGenerateResponse | None
    diff_summary: str
    confidence: float
    trace: dict[str, object]  # PlanTrace TypedDict available for consumers


# ── 规划反思 ─────────────────────────────────────────────────────────────


class ReflectionRequest(BaseModel):
    """POST /planner/reflect 请求体。"""

    user_msg: str = Field(..., min_length=1, description="用户消息文本")
    intent_category: str = Field("提问", description="L1 意图分类结果")
    plan_json: str | None = Field(None, description="任务计划 JSON 字符串（可选）")
    conversation_summary: str = Field("", description="对话摘要文本（可选）")


class ReflectionResponse(BaseModel):
    """POST /planner/reflect 响应体。"""

    reflections: list[str]
    improvement_suggestions: list[str]
    plan_quality_score: float
    confidence: float
    trace: dict[str, object]  # PlanTrace TypedDict available for consumers


# ── Plan 存储查询 (Phase 53 Batch 2) ──────────────────────────────────────


class PlanRunOut(BaseModel):
    """GET /planner/plans 列表项——plan_run 行（不含 subtasks）。"""

    id: int
    session_id: str
    user_msg: str
    intent_category: str
    rationale: str
    confidence: float
    subtask_count: int
    dag_edges_json: str
    created_at: float


class PlanSubtaskOut(BaseModel):
    """plan_subtasks 行的 API 表示。"""

    id: int
    plan_run_id: int
    subtask_id: str
    description: str
    depends_on_json: str
    sort_order: int
    status: str
    created_at: float


class PlanDetailOut(BaseModel):
    """GET /planner/plans/{id} 响应——plan_run + 内联 subtasks。"""

    id: int
    session_id: str
    user_msg: str
    intent_category: str
    rationale: str
    confidence: float
    subtask_count: int
    dag_edges_json: str
    created_at: float
    subtasks: list[PlanSubtaskOut]


# ── 遗忘衰减 ─────────────────────────────────────────────────────────────


class DecayRequest(BaseModel):
    """POST /memory/decay 请求体。"""

    lambda_override: float | None = Field(
        None, ge=0.001, le=1.0, description="覆盖每条 episode 的衰减 lambda 参数"
    )


class DecayDelta(BaseModel):
    """每条 episode 的衰减结果。"""

    id: int
    old_strength: float
    new_strength: float


class DecayResponse(BaseModel):
    """POST /memory/decay 响应体。"""

    items_decayed: int
    deltas: list[DecayDelta]


# ── 日志 ─────────────────────────────────────────────────────────────


class LogQueryParams(BaseModel):
    """GET /logs 查询参数。"""

    profile: str | None = Field(None, description="Profile 名称，默认使用当前 active profile")
    tail_n: int = Field(200, ge=1, le=10000, description="从文件末尾读取的行数")
    level: str | None = Field(
        None,
        pattern=r"^(DEBUG|INFO|WARNING|ERROR|CRITICAL)$",
        description="按日志级别筛选",
    )
    keyword: str | None = Field(None, min_length=1, description="日志消息关键词搜索")
    page: int = Field(1, ge=1, description="页码（1-based）")
    page_size: int = Field(20, ge=1, le=200, description="每页条数")


class LogEntry(BaseModel):
    """单条解析后的日志条目。"""

    id: int  # 文件中的行号（1-indexed），用于单条详情定位
    timestamp: str
    level: str
    logger: str
    message: str
    raw: str  # 原始 JSON 行文本（用于详情面板）


class LogResponse(BaseModel):
    """GET /logs 响应体。"""

    entries: list[LogEntry]
    total_lines: int  # 文件总行数
    file_size_bytes: int
    page: int
    page_size: int


class LogDetailResponse(BaseModel):
    """GET /logs/{id} 响应体——单条日志完整详情，支持前后导航。"""

    id: int
    timestamp: str
    level: str
    logger: str
    message: str
    raw: str
    prev_id: int | None = None  # 上一条日志行号，首条为 None
    next_id: int | None = None  # 下一条日志行号，末条为 None
    total_lines: int  # 文件总行数


# ── Session Reset / Wipe ─────────────────────────────────────────────────


class SessionForgetRequest(BaseModel):
    """POST /session/forget 请求体——按 session_id 定向遗忘。"""

    session_id: str = Field(..., min_length=1, description="待遗忘的会话标识")


class SessionForgetResponse(BaseModel):
    """POST /session/forget 响应体——遗忘操作的回执统计。"""

    episodes_deleted: int
    facts_deleted: int
    faiss_vectors_removed: int
    session_id: str


class WipeResponse(BaseModel):
    """POST /session/reset 响应体——一键清空所有数据后的回执。"""

    status: str  # "wiped"
    profile: str
    detail: str = "所有数据已清空，引擎已重新初始化"


# ── Lab 实验与分析 ───────────────────────────────────────────────────────


class CacheStats(BaseModel):
    """单个缓存的命中率统计。"""

    hits: int
    misses: int
    size: int
    total_requests: int
    hit_rate_pct: float


class CacheStatsResponse(BaseModel):
    """GET /lab/cache-stats 响应——嵌入缓存 + 事实缓存统计。"""

    embedding: CacheStats
    fact: CacheStats | None  # None = FactExtractor 未加载


class CacheEntryItem(BaseModel):
    """单个缓存条目的可读摘要——供缓存内容面板展示。"""

    key: str  # 缓存键（文本或 hash 前缀）
    preview: str = ""  # 人类可读摘要
    tokens_est: int = 0  # 该条目的预估 token 节省量
    kind: str = ""  # "embedding" | "fact" | "response"


class CacheEntriesResponse(BaseModel):
    """GET /lab/cache-entries 响应——指定缓存的实际条目内容。"""

    cache_type: str
    entries: list[CacheEntryItem]
    total_entries: int
    hits: int
    misses: int
    hit_rate_pct: float


class EmbeddingCoord(BaseModel):
    """单个向量的 PCA 坐标 + 标签。"""

    id: int
    x: float
    y: float
    z: float
    label: str  # 截断至 60 字符
    kind: str  # "episode" | "fact"
    color: str  # "#4f6ef7" | "#e53e3e"


class EmbeddingCoordsResponse(BaseModel):
    """GET /lab/embedding-coords 响应——PCA 降维后的 3D 坐标集合。"""

    coords: list[EmbeddingCoord]
    total_vectors: int
    pca_variance_explained: list[float]  # 3 个主成分的方差解释比


class DecayBin(BaseModel):
    """衰减直方图的一个强度区间桶。"""

    bin_label: str  # "0.0-0.1" 等
    count: int
    avg_strength: float


class DecayDistributionResponse(BaseModel):
    """GET /lab/memory-decay-distribution 响应——Ebbinghaus 衰减分布。"""

    bins: list[DecayBin]
    total_episodes: int
    decay_lambda: float


class GraphNode(BaseModel):
    """知识图谱节点（实体或概念）。"""

    id: str
    label: str
    group: str  # "subject" | "object" 用于着色
    weight: int  # 关联 fact 数量，决定节点大小


class GraphEdge(BaseModel):
    """知识图谱边（三元组关系）。"""

    source: str  # subject id
    target: str  # object id
    label: str  # relation 标签
    confidence: float  # 边粗细/透明度


class KnowledgeGraphResponse(BaseModel):
    """GET /lab/knowledge-graph 响应——三元组图节点+边数据。"""

    nodes: list[GraphNode]
    edges: list[GraphEdge]
    total_facts: int


# ── Lab: A/B 实验 ────────────────────────────────────────────────────────


class ExperimentPreset(BaseModel):
    """单个 A/B 实验预设——预定义的参数对比方案。"""

    id: str  # "recall_top_k_3_vs_7"
    label_a: str  # "top_k=3 (保守)"
    label_b: str  # "top_k=7 (激进)"
    settings_a: dict[str, object]  # ExperimentSettings TypedDict available for consumers
    settings_b: dict[str, object]  # ExperimentSettings TypedDict available for consumers
    description: str  # 人类可读的实验说明


class ExperimentPresetsResponse(BaseModel):
    """GET /lab/experiment-presets 响应——全部可用预设列表。"""

    presets: list[ExperimentPreset]


class ExperimentRunRequest(BaseModel):
    """POST /lab/experiment-run 请求体。

    可用 preset_id 引用预设，或传 settings_a/settings_b 自定义。
    """

    user_input: str = Field(..., min_length=1, description="实验用输入文本")
    preset_id: str | None = Field(None, description="预设 ID（如 recall_top_k_3_vs_7）")
    settings_a: dict[str, object] | None = Field(
        None, description="A 组 Settings 覆盖（自定义模式）"
    )
    settings_b: dict[str, object] | None = Field(
        None, description="B 组 Settings 覆盖（自定义模式）"
    )
    label_a: str | None = Field(None, description="A 组标签（覆盖预设）")
    label_b: str | None = Field(None, description="B 组标签（覆盖预设）")


class ExperimentResultSchema(BaseModel):
    """序列化的单次实验运行结果快照。"""

    label: str
    settings: dict[str, object]  # ExperimentSettings TypedDict available for consumers
    recalled_count: int
    response_text: str
    response_length: int
    chat_prompt_tokens: int
    chat_completion_tokens: int
    chat_total_tokens: int
    fact_prompt_tokens: int
    fact_completion_tokens: int
    fact_total_tokens: int
    facts_extracted: int
    fact_contents: list[str]
    db_path: str


class ExperimentDiffSchema(BaseModel):
    """单个维度的 A/B 差异对比。"""

    dimension: str
    label_a: str
    label_b: str
    value_a: object | None = None
    value_b: object | None = None
    delta: str
    direction: str  # "a_better" | "b_better" | "neutral"
    detail: str | None = None


class ExperimentRunResponse(BaseModel):
    """POST /lab/experiment-run 响应——A/B 结果 + 差异对比。"""

    result_a: ExperimentResultSchema
    result_b: ExperimentResultSchema
    diffs: list[ExperimentDiffSchema]
    elapsed_ms: float = 0.0


# ── Lab: 策略人格 ─────────────────────────────────────────────────────────


class StrategyPersona(BaseModel):
    """单个上下文溢出策略的人格描述。"""

    id: str  # "truncate" | "prioritize" | "summarize"
    name: str  # "守门员"
    subtitle: str  # "严格先到先出"
    icon: str  # "ri-door-line"
    description: str  # 详细说明
    color: str  # CSS 变量或颜色值


class StrategyPersonasResponse(BaseModel):
    """GET /lab/strategy-personas 响应——三种策略人格列表。"""

    personas: list[StrategyPersona]


# ── Lab: 成本瀑布 ─────────────────────────────────────────────────────────


class CostWaterfallStep(BaseModel):
    """瀑布图中的单步——从原始调用到净消耗的逐步拆解。"""

    label: str  # "LLM 调用" | "缓存节省" | "压缩节省" | "净用量"
    tokens: int  # 本步 token 数（节省项为正值，前端处理正负显示）
    kind: str  # "gross" | "savings" | "net"
    color: str  # CSS 颜色 hex 字符串（瀑布段填充色）


class CostWaterfallResponse(BaseModel):
    """GET /lab/cost-waterfall 响应——Token 消耗瀑布流。"""

    steps: list[CostWaterfallStep]
    gross_tokens: int  # 原始 LLM 调用总额
    cache_savings: int  # 缓存命中的 token 节省
    compression_savings: int  # 压缩的 token 节省
    net_tokens: int  # 实际净消耗


# ── 压缩统计 ─────────────────────────────────────────────────────────────


class CompressionStatsResponse(BaseModel):
    """GET /metrics/compression 响应——压缩 token 节省统计。

    双数据源聚合：TokenLedger（当前会话内存） + pipeline_trace 表（历史持久化）。
    """

    session_compression_count: int  # ledger call_point="compression" 条数
    session_tokens_saved: int  # ledger call_point="compression_savings" prompt_tokens 累计
    session_prompt_tokens: int  # 压缩 LLM 调用消耗的 prompt tokens
    session_completion_tokens: int  # 压缩 LLM 调用消耗的 completion tokens
    historical_compression_count: int  # pipeline_trace step_name="compression" 条数


# ── 事实置信度调整 ──


class FactConfidenceUpdateRequest(BaseModel):
    """事实置信度调整请求——用户纠正或加星。

    正 delta = 加星（提升置信度），负 delta = 纠正（降低置信度）。
    """

    delta: float = Field(
        default=...,
        ge=-1.0,
        le=1.0,
        description="置信度变化量，正数=加星，负数=纠正",
    )
    reason: str = Field(
        default=...,
        min_length=1,
        max_length=128,
        description="变更原因，如 'user_correction' 或 'user_star'",
    )


class FactConfidenceUpdateResponse(BaseModel):
    """事实置信度调整结果——包含变更前/后置信度与审计日志时间戳。"""

    fact_id: int
    confidence_before: float
    confidence_after: float
    reason: str
    logged_at: float


# ── 规划用户干预 (Phase 57 Batch 3) ──────────────────────────────────────


class PlanOverrideAction(StrEnum):
    """用户对子任务的手动干预动作类型。"""

    SKIP = "skip"  # 跳过该步骤
    RETRY = "retry"  # 重新执行该步骤
    MODIFY = "modify"  # 修改步骤描述后重新执行
    ACCEPT = "accept"  # 接受 AI 修正计划
    REJECT = "reject"  # 拒绝 AI 修正计划，回退到原始步骤


class PlanOverride(BaseModel):
    """用户对单个子任务的手动干预。

    step_id 对应 PlanResult.subtasks 中的子任务 id，
    action 指定干预类型，new_description 在 action=modify 时提供新的步骤描述。
    """

    step_id: str = Field(..., min_length=1, description="目标子任务 id")
    action: PlanOverrideAction = Field(..., description="干预动作")
    new_description: str | None = Field(
        None, min_length=1, description="修改后的步骤描述（action=modify 时必填）"
    )


class PlanOverrideRequest(BaseModel):
    """PATCH /planner/plans/{plan_id} 请求体——批量子任务干预。

    支持单次请求对多个子任务执行不同动作，max 16 条防止批量过大。
    """

    overrides: list[PlanOverride] = Field(
        ..., min_length=1, max_length=16, description="用户干预列表"
    )


class PlanOverrideResponse(BaseModel):
    """PATCH /planner/plans/{plan_id} 响应——返回更新后的计划详情。"""

    plan_id: int
    applied: int = Field(..., description="成功应用的干预数量")
    rejected: int = Field(0, description="因状态冲突被拒绝的干预数量")
    detail: PlanDetailOut

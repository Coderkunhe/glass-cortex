/** 聊天 + Planner + Health + Context 溢出模拟领域类型 */

/** 聊天请求 — 镜像 api/schemas.py ChatRequest */
export interface ChatRequest {
  user_input: string;
  context_window_size?: number;
  context_overflow_strategy?: "truncate" | "prioritize" | "summarize";
  model?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  /** 是否在响应中返回完整 system prompt（Ghost Prompt 视图） */
  include_system_prompt?: boolean;
  /** 会话标识（必填，与后端 session_id: str = "" 对齐；可为空字符串） */
  session_id: string;
  /** 召回最大条目数（默认 5） */
  recall_top_k?: number;
  /** 最低相关性分数阈值（默认 0.1） */
  recall_threshold?: number;
  /** MMR λ 覆盖（null=使用默认 0.7） */
  recall_mmr_lambda?: number | null;
  /** 是否启用 SSE 流式输出（Phase 66 — B134 后端已支持，B135 前端消费） */
  stream?: boolean;
}

/** 意图分类结果 — 与后端 src/planner.py INTENT_CATEGORIES 保持一致。
 * 后端返回任意字符串；前端不再维护字面量联合——用 `string` 避免类型过窄。 */
export type IntentCategory = string;

/** Planner 返回的单次意图分类结果 */
export interface IntentResult {
  category: IntentCategory;
  confidence: number;
  rationale: string;
  /** 任务复杂度（来自路由决策，仅 routing_enabled 时可用）。"simple" | "complex" */
  complexity?: string;
}

/** 单次请求的上下文工程元数据 */
export interface ContextMeta {
  window_size: number;
  base_tokens: number;
  memories_before: number;
  memories_token_before: number;
  memories_after: number;
  overflow_applied: boolean;
  strategy: string;
  dropped_count: number;
  dropped_items: Array<Record<string, unknown>>;
  user_message_tokens: number;
  total_estimated_tokens: number;
  usage_pct: number;
  memories_token_after: number;
  /** 引擎可能附加额外字段（system_prompt, fact_extraction_trace 等） */
  [key: string]: unknown;
}

/** 单次 API 调用的 trace 追踪数据 */
export interface ApiTrace {
  caller: string;
  model: string;
  temperature: number;
  max_tokens: number;
  elapsed_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** 引擎可能附加额外字段（system_prompt, raw_response, parsed_result 等） */
  [key: string]: unknown;
}

/** Episode 召回条目 — 对话轮次的语义召回结果 (I-101 拆分) */
export interface EpisodeRecallItem {
  id: number;
  content: string;
  // Episode 特有
  importance?: number | null;
  initial_strength?: number | null;
  lambda?: number | null;
  access_count?: number | null;
  last_recall?: number | null;
  // 共有
  faiss_id?: number | null;
  timestamp?: number | null;
  // 引擎注入
  composite_score?: number | null;
  similarity?: number | null;
  /** q2.18 记忆可解释性——为什么召回这条记忆 */
  recall_reason?: string | null;
}

/** Fact 召回条目 — 结构化知识三元组的语义召回结果 (I-101 拆分) */
export interface FactRecallItem {
  id: number;
  content: string;
  // Fact 特有
  confidence?: number | null;
  source_episode_id?: number | null;
  subject?: string | null;
  relation?: string | null;
  object?: string | null;
  // 共有
  faiss_id?: number | null;
  timestamp?: number | null;
  // 引擎注入
  composite_score?: number | null;
  similarity?: number | null;
  /** q2.18 记忆可解释性——为什么召回这条记忆 */
  recall_reason?: string | null;
}

/** 单条召回条目 — episode 或 fact 的字段并集（向后兼容；新代码优先用 EpisodeRecallItem | FactRecallItem） */
export interface RecallItem {
  id: number;
  content: string;
  // Episode 特有
  importance?: number | null;
  initial_strength?: number | null;
  lambda?: number | null;
  access_count?: number | null;
  last_recall?: number | null;
  // Fact 特有
  confidence?: number | null;
  source_episode_id?: number | null;
  subject?: string | null;
  relation?: string | null;
  object?: string | null;
  // 共有
  faiss_id?: number | null;
  timestamp?: number | null;
  // 引擎注入
  composite_score?: number | null;
  similarity?: number | null;
  /** q2.18 记忆可解释性——为什么召回这条记忆 */
  recall_reason?: string | null;
}

/** 模型路由决策信息（Phase 55 Batch 4 — 前端可见） */
export interface RoutingInfo {
  model: string;
  reason: string;
  intent_category: string;
  complexity: string;
  fallback_model?: string | null;
  fallback_triggered: boolean;
  attempts: number;
}

/** 冷启动状态画像 (q2.19) — 系统对自身记忆成熟度的自我感知 */
export interface ColdStartProfile {
  episode_count: number;
  phase: "cold" | "warming" | "near_hot" | "hot";
  phase_label: string;
  progression_pct: number;
  hint?: string | null;
}

/** 聊天完整响应 — 镜像 api/schemas.py ChatResponse */
export interface ChatResponse {
  response_text: string;
  episode_id: number;
  intent: IntentResult | null;
  context_meta: ContextMeta;
  api_trace: ApiTrace;
  recall_items: RecallItem[];
  /** 完整 system prompt（仅当请求 include_system_prompt=True 时返回） */
  system_prompt?: string | null;
  /** 模型路由决策（仅 routing_enabled 时非空，Phase 55 Batch 4） */
  routing?: RoutingInfo | null;
  /** 冷启动状态画像（q2.19 — 系统对自身记忆成熟度的自我感知） */
  cold_start_profile?: ColdStartProfile | null;
  /** 本次响应是否来自语义缓存命中（Phase 62） */
  from_cache?: boolean;
  /** 缓存命中时的语义相似度分数（0.0-1.0，仅 from_cache=true 时有值） */
  cache_hit_score?: number | null;
}

// ── Planner ──────────────────────────────────────────────────────────

/** POST /planner/classify 请求 — 独立的意图分类测试 */
export interface PlannerClassifyRequest {
  user_msg: string;
}

/** POST /planner/classify 响应 */
export interface PlannerClassifyResponse {
  category: string;
  confidence: number;
  rationale: string;
  trace: Record<string, unknown>;
}

/** POST /planner/reflect 请求 — 规划反思 */
export interface ReflectionRequest {
  user_msg: string;
  intent_category: string;
  plan_json?: string | null;
  conversation_summary?: string;
}

/** POST /planner/reflect 响应 */
export interface ReflectionResponse {
  reflections: string[];
  improvement_suggestions: string[];
  plan_quality_score: number;
  confidence: number;
  trace: Record<string, unknown>;
}

// ── Plan Storage (Phase 53 Batch 2) ───────────────────────────────────

/** plan_subtasks 行的前端表示 */
export interface PlanSubtask {
  id: number;
  plan_run_id: number;
  subtask_id: string;
  description: string;
  depends_on_json: string;
  sort_order: number;
  status: string;
  created_at: number;
}

/** plan_runs 行的前端表示（列表视图，不含 subtasks） */
export interface PlanRun {
  id: number;
  session_id: string;
  user_msg: string;
  intent_category: string;
  rationale: string;
  confidence: number;
  subtask_count: number;
  dag_edges_json: string;
  created_at: number;
}

/** 单次规划详情——PlanRun + 内联 subtasks */
export interface PlanDetail extends PlanRun {
  subtasks: PlanSubtask[];
}

// ── Health ───────────────────────────────────────────────────────────

/** 单个健康检查组件状态 */
export interface HealthComponent {
  status: string;
  latency_ms: number;
  detail: string;
}

/** GET /health 响应 — 全局健康检查聚合 */
export interface HealthResponse {
  service: string;
  components: Record<string, HealthComponent>;
  overall_status: string;
  recovery_suggestions: Array<Record<string, string>>;
}

/** 统一 API 错误响应 — 镜像 api/schemas.py 9 错误码模型 */
export interface ApiError {
  error: string;
  detail: string;
  error_code?: string;
  /** 422 校验失败时附带的字段级错误。结构：[{ field, message, type }] */
  field_errors?: Array<{
    field: string;
    message: string;
    type: string;
  }>;
}

/** 异步数据获取的四态状态机。用于 DataState 组件和所有 fetch-on-mount 面板。 */
export type FetchState = "idle" | "loading" | "success" | "error";

// ── Context ─────────────────────────────────────────────────────────

/** POST /context/simulate-overflow 请求 */
export interface SimulateOverflowRequest {
  recalled?: Array<Record<string, unknown>>;
  strategy?: "truncate" | "prioritize" | "summarize";
  window_size?: number;
  user_input?: string;
  base_tokens_override?: number | null;
}

/** 单个策略的溢出模拟结果 */
export interface OverflowSimResponse {
  strategy: string;
  window_size: number;
  base_tokens: number;
  user_tokens: number;
  memories_before: number;
  memories_token_before: number;
  memories_after: number;
  memories_token_after: number;
  dropped_count: number;
  dropped_items: string[];
  kept_items: Array<Record<string, unknown>>;
  overflow_triggered: boolean;
  total_estimated_tokens: number;
  usage_pct: number;
  wasted_tokens: number;
  available_tokens: number;
  summary_line: string;
  strategy_label: string;
}

/** POST /context/compare-strategies 请求 */
export interface CompareStrategiesRequest {
  recalled?: Array<Record<string, unknown>>;
  window_size?: number;
  user_input?: string;
  base_tokens_override?: number | null;
}

/** 三种溢出策略并排对比 */
export interface CompareStrategiesResponse {
  truncate: OverflowSimResponse;
  prioritize: OverflowSimResponse;
  summarize: OverflowSimResponse;
}

// ── 规划用户干预 (Phase 57 Batch 3) ────────────────────────────────────

/** 用户干预动作类型 — 镜像 api/schemas.py PlanOverrideAction */
export type PlanOverrideAction = "skip" | "retry" | "modify" | "accept" | "reject";

/** 用户对单个子任务的手动干预 — 镜像 api/schemas.py PlanOverride */
export interface PlanOverride {
  step_id: string;
  action: PlanOverrideAction;
  new_description?: string | null;
}

/** PATCH /planner/plans/{plan_id} 请求体 */
export interface PlanOverrideRequest {
  overrides: PlanOverride[];
}

/** PATCH /planner/plans/{plan_id} 响应体 */
export interface PlanOverrideResponse {
  plan_id: number;
  applied: number;
  rejected: number;
  detail: PlanDetail;
}

/** 聊天认知参数类型与默认值 — 供 ChatParamsContext + ParamSliders 使用 */

// ── L2 记忆召回参数 ────────────────────────────────────────────────

/** L2 记忆召回参数 — 控制从记忆存储中召回相关记忆的数量、阈值与压缩策略。 */
export interface L2RecallParams {
  /** 每条消息召回多少条相关记忆 (1-15) */
  top_k: number;
  /** 强度/置信度低于此阈值的记忆被过滤 (0.0-1.0) */
  recall_threshold: number;
  /** 综合得分低于此阈值的记忆不注入上下文 (0.0-0.5, 0=禁用) */
  truncation_threshold: number;
  /** 召回记忆超过此 token 数时压缩 (0-4096, 0=禁用) */
  compress_threshold: number;
}

/** L2 记忆召回参数的默认值。 */
export const DEFAULT_L2_RECALL: L2RecallParams = {
  top_k: 5,
  recall_threshold: 0.1,
  truncation_threshold: 0.0,
  compress_threshold: 500,
};

// ── L3 上下文窗口参数 ──────────────────────────────────────────────

/** 上下文溢出策略 — truncate=先入先出截断 | prioritize=按相关性得分保留 | summarize=压缩旧记忆。 */
export type OverflowStrategy = "truncate" | "prioritize" | "summarize";

/** L3 上下文窗口参数 — 控制上下文窗口大小与溢出行为。 */
export interface L3ContextParams {
  /** 上下文窗口最大 token 数 (512-8192) */
  window_size: number;
  /** 溢出策略：truncate=FIFO截断 | prioritize=按得分保留 | summarize=压缩旧记忆 */
  overflow_strategy: OverflowStrategy;
}

/** L3 上下文窗口参数的默认值。 */
export const DEFAULT_L3_CONTEXT: L3ContextParams = {
  window_size: 4096,
  overflow_strategy: "prioritize",
};

// ── 会话统计 ───────────────────────────────────────────────────────

/** 会话级 token 累计 — 前端聚合自各轮 api_trace.token_breakdown。
 *  清空聊天时由 messages 派生归零（无独立累加器状态，避免失同步）。 */
export interface SessionTokenStats {
  /** 本次会话累计输入 token（prompt，跨 chat/intent/fact_extraction 三调用点）。 */
  input: number;
  /** 本次会话累计输出 token（completion）。 */
  output: number;
  /** 本次会话已完成的 assistant 轮数（用于 avg per turn）。 */
  turns: number;
  /** 本次会话估算成本（¥，按各轮 token_breakdown.pricing 折算后累加）。 */
  cost: number;
  /** 是否有有效定价数据（pricing 存在且单价 > 0）。 */
  hasPricing: boolean;
}

/** 会话统计快照 — 展示当前会话中的消息数、记忆数、token 累计与会话启动时间戳。 */
export interface SessionStats {
  /** 会话中已交换的消息数。 */
  messageCount: number;
  /** 当前会话关联的记忆条目数。 */
  memoryCount: number;
  /** 本次会话累计 token（前端聚合，清空聊天归零）。 */
  sessionTokens: SessionTokenStats;
  /** 会话启动时的 Unix 时间戳 (ms)。 */
  sessionStart: number;
}

// ── L5 模型推理参数 ────────────────────────────────────────────────

/** L5 层支持的模型选项列表。 */
export const L5_MODEL_OPTIONS = ["deepseek-chat", "deepseek-reasoner"] as const;

/** L5 模型标识 — 从 L5_MODEL_OPTIONS 派生的联合类型。 */
export type L5Model = (typeof L5_MODEL_OPTIONS)[number];

/** L5 模型的人类可读标签，用于下拉选择器等 UI 展示。 */
export const L5_MODEL_LABELS: Record<L5Model, string> = {
  "deepseek-chat": "deepseek-chat — 日常对话",
  "deepseek-reasoner": "deepseek-reasoner — 复杂推理",
};

/** L5 模型推理参数 — 控制模型选择、温度与输出长度。 */
export interface L5InferenceParams {
  /** 模型名称 (deepseek-chat / deepseek-reasoner) */
  model: L5Model;
  /** 采样温度 (0.0-2.0, step 0.1)，越高越有创造性 */
  temperature: number;
  /** 单次回复最大 token 数 (256-4096, step 128) */
  max_tokens: number;
}

/** L5 模型推理参数的默认值。 */
export const DEFAULT_L5_INFERENCE: L5InferenceParams = {
  model: "deepseek-chat",
  temperature: 0.7,
  max_tokens: 1024,
};

// ── L6 遗忘曲线参数 ────────────────────────────────────────────────

/** L6 遗忘曲线参数 — 控制艾宾浩斯衰减速率。 */
export interface L6DecayParams {
  /** 艾宾浩斯衰减速率 (0.01-1.0, step 0.01)，λ 越高记忆遗忘越快 */
  lambda: number;
}

/** L6 遗忘曲线参数的默认值。 */
export const DEFAULT_L6_DECAY: L6DecayParams = {
  lambda: 0.1,
};

// ── 聚合类型（传给 useChat 的最小集合）──────────────────────────────

/** L3 + L5 参数经 useChat → api.chat() 送达后端。
 *  L2 + L6 参数在 Context 中存储展示，接线留待后续 Batch。 */
export interface ChatParams {
  context_window_size?: number;
  context_overflow_strategy?: OverflowStrategy;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

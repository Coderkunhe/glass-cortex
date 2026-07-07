/**
 * 管线步骤 + 调用点显示标签与颜色常量。
 *
 * 集中管理各面板中重复的 STEP_LABELS / CALL_POINT_LABELS / CALL_POINT_COLORS，
 * 消除 PipelineTracePanel、StepLatencyPanel、TokenDashboardPanel、
 * StepLatencyCard、TokenMetricsCard 五文件中的重复定义。
 *
 * @module lib/labels
 */

/** 步骤名 → 中文显示名映射 */
export const STEP_LABELS: Record<string, string> = {
  chat: "聊天引擎",
  chat_engine: "聊天引擎",
  intent_classify: "意图分类",
  fact_extraction: "事实抽取",
  recall: "语义召回",
  store: "记忆存储",
  planner: "Planner",
};

/** 调用点 → 中文显示名映射。未在映射中的 key 直接用原始值。 */
export const CALL_POINT_LABELS: Record<string, string> = {
  chat: "聊天引擎",
  chat_engine: "聊天引擎",
  intent_classify: "意图分类",
  fact_extraction: "事实抽取",
  planner: "Planner",
};

/** 调用点 → 颜色映射（prompt 段 / completion 段） */
export const CALL_POINT_COLORS: Record<
  string,
  { prompt: string; completion: string }
> = {
  chat: { prompt: "bg-brand", completion: "bg-brand/60" },
  chat_engine: { prompt: "bg-brand", completion: "bg-brand/60" },
  intent_classify: { prompt: "bg-accent", completion: "bg-accent/60" },
  planner: { prompt: "bg-accent", completion: "bg-accent/60" },
  fact_extraction: { prompt: "bg-warning", completion: "bg-warning/60" },
};

/** 默认颜色（未识别的调用点） */
export const DEFAULT_CALL_POINT_COLORS = {
  prompt: "bg-info",
  completion: "bg-info/60",
};

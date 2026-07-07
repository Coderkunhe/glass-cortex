/** 追踪 + 指标 + 日志领域类型 */

// ── Metrics ──────────────────────────────────────────────────────────

/** GET /metrics/tokens 响应 — 按调用点汇总 token 消耗 */
export interface TokenSummary {
  by_call_point: Record<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
}

/** GET /metrics/steps 响应 — 各步骤耗时汇总 */
export interface StepSummary {
  steps: Record<string, { count: number; total_ms: number; avg_ms: number; min_ms: number; max_ms: number }>;
}

// ── Traces ──────────────────────────────────────────────────────────

/** GET /traces 单条追踪记录 */
export interface TraceItem {
  id: number;
  session_id: string;
  step_name: string;
  elapsed_ms: number;
  status: string;
  metrics: Record<string, unknown>;
  created_at: number;
}

/** GET /traces/count 响应 */
export interface TraceCountResponse {
  count: number;
  session_id: string | null;
  step_name: string | null;
}

/** POST /traces/delete-old 请求 */
export interface DeleteTracesRequest {
  retention_limit: number;
}

/** POST /traces/delete-old 响应 */
export interface DeleteTracesResponse {
  deleted: number;
  retention_limit: number;
}

// ── Logs ────────────────────────────────────────────────────────────

/** GET /logs 查询参数 */
export interface LogQueryParams {
  profile?: string;
  tail_n?: number;
  level?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
}

/** 单条解析后的日志条目 */
export interface LogEntry {
  id: number;  // 文件行号（1-indexed）
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  raw: string;
}

/** GET /logs 响应 */
export interface LogResponse {
  entries: LogEntry[];
  total_lines: number;
  file_size_bytes: number;
  page: number;
  page_size: number;
}

/** GET /metrics/compression 响应 — 压缩 token 节省统计（双源聚合：ledger + pipeline_trace） */
export interface CompressionStatsResponse {
  session_compression_count: number;
  session_tokens_saved: number;
  session_prompt_tokens: number;
  session_completion_tokens: number;
  historical_compression_count: number;
}

/** GET /logs/{id} 响应 — 单条日志完整详情 */
export interface LogDetailResponse {
  id: number;
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  raw: string;
  prev_id: number | null;
  next_id: number | null;
  total_lines: number;
}

/** Admin API 领域类型 — Phase 68 Batch 3。
 *
 * 对应 api/routers/admin.py 的三端点响应结构。
 */

// ── Health (GET /admin/health) ──────────────────────────────────────

/** 单项门禁检查结果 */
export interface CheckItem {
  exit_code: number;
  is_critical: boolean;
  lines: string[];
}

/** L5 拉通自检状态 */
export interface L5Status {
  batches_since_last: number;
  last_l5_batch: string;
  blocked: boolean;
}

/** 日报状态 */
export interface DailyStatus {
  yesterday_exists: boolean;
  yesterday_date: string | null;
  today_exists: boolean;
  today_date: string | null;
}

/** 违纪统计 */
export interface ViolationsStatus {
  summary: string;
  is_blocked: boolean;
}

// ── Phase 69 B5 — 钻取面板结构化数据 ────────────────────────────

/** L5 拉通历史条目 */
export interface L5HistoryEntry {
  date: string;
  label: string;
  phase: number;
  covered: string;
}

/** 违纪触发日志条目 */
export interface ViolationTriggerEntry {
  date: string;
  batch: string;
  description: string;
  type: string;
  wasted_min: number | null;
  is_first: boolean;
  root_fixed: string | null;
}

/** 违纪 VIO 条目 */
export interface ViolationVioEntry {
  id: string;
  title?: string;
  status?: string;
  trigger_types?: string;
}

/** 违纪结构化数据 */
export interface ViolationsStructured {
  trigger_log: ViolationTriggerEntry[];
  active_vios: ViolationVioEntry[];
  closed: ViolationVioEntry[];
  total_triggers: number;
  closed_count: number;
  summary: string;
}

/** 需求覆盖度结构化数据 */
export interface RequirementsCoverage {
  total_entries: number;
  verified_count: number;
  coverage_pct: number;
  by_type: Record<string, number>;
  by_phase: Array<{ phase: string; total: number; verified: number }>;
  uncovered: Array<{ phase: string; title: string; date: string }>;
}

/** 文档新鲜度 */
export interface DocFreshness {
  requirements_last_date: string | null;
  doc_dates: Record<string, string>;
}

/** GET /admin/health 完整响应 — check-docs --json 输出 */
export interface AdminHealthResponse {
  timestamp: string;
  hard_failures: number;
  current_phase: string | null;
  current_batch: string | null;
  recent_commits: string[];
  l5: L5Status;
  /** Phase 69 B5 — L5 拉通历史时间线 */
  l5_history?: L5HistoryEntry[];
  daily: DailyStatus;
  violations: ViolationsStatus;
  /** Phase 69 B5 — 违纪结构化数据 */
  violations_structured?: ViolationsStructured;
  /** Phase 69 B5 — 需求覆盖度钻取数据 */
  requirements_coverage?: RequirementsCoverage;
  doc_freshness: DocFreshness;
  checks: Record<string, CheckItem>;
  /** 非 check-docs 标准输出的错误信息（API 层异常兜底） */
  error?: string;
  stderr?: string;
  raw?: string;
}

// ── Docs (GET /admin/docs) ──────────────────────────────────────────

/** 文档清单单项 */
export interface DocListItem {
  name: string;
  path: string;
  group: string;
  size_bytes: number;
  mtime: string;
  lines: number;
  /** 从文档首段提取的概要（≤120 字符） */
  summary?: string;
  /** 目录项标记 */
  is_directory?: boolean;
  /** 目录内文档数 */
  count?: number;
  /** 目录下的子文档列表 */
  children?: DocListItem[];
}

// ── Doc Content (GET /admin/docs/{name}) ────────────────────────────

/** GET /admin/docs/{name} 响应 */
export interface DocContentResponse {
  name: string;
  path: string;
  content: string;
  lines: number;
}

// ── Doc Search (GET /admin/search?q=) ────────────────────────────────

/** GET /admin/search?q= 单条搜索结果 */
export interface DocSearchResult {
  path: string;
  name: string;
  group: string;
  summary: string;
  /** 首条匹配行 ± 1 行上下文的文本片段（最长 300 字符） */
  snippet: string;
  /** 文档中匹配行数 */
  match_count: number;
}

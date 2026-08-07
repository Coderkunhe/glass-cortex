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
  daily: DailyStatus;
  violations: ViolationsStatus;
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

/**
 * GlassCortex 前端全局常量。
 *
 * 集中管理 API 基地址、上下文窗口默认值、溢出策略等编译时常量，
 * 避免散落在组件中各处的 magic values。
 *
 * 使用方式：`import { API_BASE_URL } from "@/lib/constants";`
 */

// ── localStorage 键名 ────────────────────────────────────────

/** Learn 页最后阅读的问题 ID。 */
export const LEARN_LAST_READ_KEY = "gm-learn-last-read";

/** Learn 页被折叠的章节 ID 列表。 */
export const LEARN_COLLAPSED_KEY = "gm-learn-collapsed";

/** Learn 页侧栏收起/展开状态。 */
export const LEARN_SIDEBAR_KEY = "gm-learn-sidebar";

/** Learn 页访问历史（最近 5 条问题 ID，滑动窗口）。 */
export const LEARN_VISIT_HISTORY_KEY = "gm-learn-visit-history";

/** Learn 页用户收藏的问题 ID 列表。 */
export const LEARN_BOOKMARKS_KEY = "gm-learn-bookmarks";

/** Learn 页滚动位置记忆 — question ID → scroll percentage (0-100)。 */
export const LEARN_SCROLL_POSITIONS_KEY = "gm-learn-scroll-positions";

/** Learn 页阅读字号偏好 — "sm" | "md" | "lg"（默认 "md"）。 */
export const LEARN_FONT_SIZE_KEY = "gm-learn-font-size";

/** Learn 页用户学习进度存储 key — Record<questionId, LearnProgressEntry>。 */
export const LEARN_PROGRESS_KEY = "gm-learn-progress";

// ── 学习进度类型 ──────────────────────────────────────────────

/** 单条问题的用户学习进度。 */
export interface LearnProgressEntry {
  /** 首次阅读时间戳 (Date.now())。标记后不更新，保留首次阅读时刻。 */
  viewedAt: number;
}

/** 单章用户进度汇总（供 UI 组件消费）。 */
export interface ChapterProgress {
  viewed: number;
  total: number;
}

// ── 笔记类型 ──────────────────────────────────────────────────

/** 用户划词笔记 */
export interface LearnNote {
  /** 唯一 ID（crypto.randomUUID()） */
  id: string;
  /** 所属问题 ID */
  questionId: string;
  /** 标注的源文本片段（≤200 字符，B65 "+"创建时为空，B66 划词创建时填充） */
  selectedText: string;
  /** 用户笔记内容 */
  noteText: string;
  /** 创建时间 (Date.now()) */
  createdAt: number;
  /** 最后修改时间 (Date.now()) */
  updatedAt: number;
}

/** @deprecated B143 — 笔记已迁移至 IndexedDB (notesDb)，仅保留供 migrateNotes 迁移函数读取。新代码请使用 useNotesDb() hook。 */
export const LEARN_NOTES_KEY = "gm-learn-notes";

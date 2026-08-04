import Dexie, { type Table } from "dexie";

/**
 * IndexedDB 笔记记录 — 与 localStorage LearnNote 结构对齐。
 *
 * Dexie 表直接存储扁平对象，`id` 为主键，`questionId`/`createdAt`/`updatedAt`
 * 建复合索引支持按问题过滤 + 按时间排序。
 */
export interface NoteRecord {
  /** 唯一 ID（crypto.randomUUID()） */
  id: string;
  /** 所属问题 ID */
  questionId: string;
  /** 标注的源文本片段（≤200 字符） */
  selectedText: string;
  /** 用户笔记内容 */
  noteText: string;
  /** 创建时间 (Date.now()) */
  createdAt: number;
  /** 最后修改时间 (Date.now()) */
  updatedAt: number;
}

/**
 * GlassCortex 笔记数据库。
 *
 * 单表 `notes`，索引覆盖按问题过滤 + 时间排序两大查询模式。
 * Schema version 1 — 后续如需加字段（如 tags、color），通过 Dexie version().stores() 升级。
 */
class NotesDatabase extends Dexie {
  notes!: Table<NoteRecord, string>;

  constructor() {
    super("GlassCortexNotes");
    this.version(1).stores({
      notes: "id, questionId, createdAt, updatedAt",
    });
  }
}

/** 全局单例 — 整个应用共享同一数据库实例。 */
export const notesDb = new NotesDatabase();

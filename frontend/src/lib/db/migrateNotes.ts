import { notesDb, type NoteRecord } from "./notesDb";
import { LEARN_NOTES_KEY } from "@/lib/constants";

/** localStorage 迁移标记 — 写入此 key 后不再重复迁移。 */
const MIGRATED_FLAG = "gm-notes-migrated";

/** 迁移结果 */
export interface MigrationResult {
  /** 已迁移记录数（0 表示无数据或已迁移） */
  migrated: number;
  /** true = 该次调用前已完成迁移，本次跳过 */
  skipped: boolean;
}

/**
 * 一次性将 localStorage 笔记数据迁移到 IndexedDB。
 *
 * - 读取 `LEARN_NOTES_KEY`（`Record<questionId, NoteRecord[]>`）
 * - 展平为 `NoteRecord[]` 写入 Dexie `notes` 表
 * - `bulkPut` 后 `count()` 验证写入条数 ≥ 源记录数
 * - 验证通过 → 清理 localStorage 旧数据 → 标记迁移完成
 * - 验证失败 → 不标记、不清理，下次重试
 * - 幂等：已迁移 / localStorage 无数据 → 直接 resolve
 *
 * 应在应用首次挂载时调用（`LearnClientShell` useEffect），
 * 不应阻塞渲染——迁移失败时静默降级，不丢数据也不崩 UI。
 */
export async function migrateNotesToIndexedDB(): Promise<MigrationResult> {
  // 幂等检查
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === "1") {
      return { migrated: 0, skipped: true };
    }
  } catch {
    // localStorage 不可用（极端隐私模式），回退
    return { migrated: 0, skipped: true };
  }

  // 读取 localStorage 笔记
  let raw: string | null;
  try {
    raw = localStorage.getItem(LEARN_NOTES_KEY);
  } catch {
    // localStorage 读取失败，标记已迁移避免反复尝试
    try {
      localStorage.setItem(MIGRATED_FLAG, "1");
    } catch {
      // 连写标记都失败，放弃
    }
    return { migrated: 0, skipped: false };
  }

  if (!raw) {
    // 无数据 → 直接标记已迁移
    try {
      localStorage.setItem(MIGRATED_FLAG, "1");
    } catch {
      // 静默
    }
    return { migrated: 0, skipped: false };
  }

  // 解析 + 迁移
  try {
    const data = JSON.parse(raw) as Record<string, NoteRecord[]>;
    const records: NoteRecord[] = [];

    for (const notes of Object.values(data)) {
      for (const note of notes) {
        records.push({
          id: note.id,
          questionId: note.questionId,
          selectedText: note.selectedText,
          noteText: note.noteText,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        });
      }
    }

    if (records.length === 0) {
      try { localStorage.setItem(MIGRATED_FLAG, "1"); } catch {}
      return { migrated: 0, skipped: false };
    }

    await notesDb.notes.bulkPut(records);

    // 写入验证：确认 IndexedDB 里实际落盘条数
    const actualCount = await notesDb.notes.count();
    if (actualCount < records.length) {
      // 静默失败 — 不标记、不清理，下次页面加载重试
      return { migrated: 0, skipped: false };
    }

    // 清理 localStorage 旧数据
    try {
      localStorage.removeItem(LEARN_NOTES_KEY);
    } catch {
      // 清理失败不影响迁移标记（数据已安全迁移到 IndexedDB）
    }

    // 标记迁移完成
    try {
      localStorage.setItem(MIGRATED_FLAG, "1");
    } catch {
      // 静默
    }

    return { migrated: records.length, skipped: false };
  } catch {
    // 解析或 IndexedDB 写入失败 → 不标记迁移完成，下次重试
    // 数据仍在 localStorage 中，不会丢失
    return { migrated: 0, skipped: false };
  }
}

/** 检查是否已完成迁移（供测试用）。 */
export function isNotesMigrationDone(): boolean {
  try {
    return localStorage.getItem(MIGRATED_FLAG) === "1";
  } catch {
    return false;
  }
}

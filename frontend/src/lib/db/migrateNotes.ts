import { notesDb, type NoteRecord } from "./notesDb";
import { LEARN_NOTES_KEY, type LearnNote } from "@/lib/constants";

/** localStorage 迁移标记 — 写入此 key 后不再重复迁移。 */
const MIGRATED_FLAG = "gm-notes-migrated";

/**
 * 一次性将 localStorage 笔记数据迁移到 IndexedDB。
 *
 * - 读取 `LEARN_NOTES_KEY`（`Record<questionId, LearnNote[]>`）
 * - 展平为 `NoteRecord[]` 写入 Dexie `notes` 表
 * - 写入 `gm-notes-migrated` 标记防止重复迁移
 * - 幂等：已迁移 / localStorage 无数据 → 直接 resolve
 *
 * 应在应用首次挂载时调用（`LearnClientShell` useEffect），
 * 不应阻塞渲染——迁移失败时静默降级，不丢数据也不崩 UI。
 */
export async function migrateNotesToIndexedDB(): Promise<void> {
  // 幂等检查
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === "1") return;
  } catch {
    // localStorage 不可用（极端隐私模式），回退
    return;
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
    return;
  }

  if (!raw) {
    // 无数据 → 直接标记已迁移
    try {
      localStorage.setItem(MIGRATED_FLAG, "1");
    } catch {
      // 静默
    }
    return;
  }

  // 解析 + 迁移
  try {
    const data = JSON.parse(raw) as Record<string, LearnNote[]>;
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

    if (records.length > 0) {
      await notesDb.notes.bulkPut(records);
    }

    // 标记迁移完成
    try {
      localStorage.setItem(MIGRATED_FLAG, "1");
    } catch {
      // 静默
    }
  } catch {
    // 解析或 IndexedDB 写入失败 → 不标记迁移完成，下次重试
    // 数据仍在 localStorage 中，不会丢失
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

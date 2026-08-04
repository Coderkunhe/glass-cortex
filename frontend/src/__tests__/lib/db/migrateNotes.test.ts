import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { migrateNotesToIndexedDB, isNotesMigrationDone } from "@/lib/db/migrateNotes";
import { notesDb } from "@/lib/db/notesDb";

/** 创建可注入的 mock localStorage */
function createMockLocalStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn<(key: string) => string | null>(
      (key: string) => store[key] ?? null,
    ),
    setItem: vi.fn<(key: string, value: string) => void>(
      (key: string, value: string) => {
        store[key] = value;
      },
    ),
    removeItem: vi.fn<(key: string) => void>((key: string) => {
      delete store[key];
    }),
    clear: vi.fn<() => void>(() => {
      Object.keys(store).forEach((k) => delete store[k]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn<(index: number) => string | null>(
      (index: number) => Object.keys(store)[index] ?? null,
    ),
  };
}

describe("migrateNotesToIndexedDB", () => {
  let mockStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(async () => {
    mockStorage = createMockLocalStorage();
    vi.stubGlobal("localStorage", mockStorage);
    await notesDb.notes.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates notes from localStorage to IndexedDB", async () => {
    // 预种 localStorage 数据
    const notesData = {
      "q1.1": [
        {
          id: "note-a",
          questionId: "q1.1",
          selectedText: "选中文本A",
          noteText: "笔记A",
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: "note-b",
          questionId: "q1.1",
          selectedText: "选中文本B",
          noteText: "笔记B",
          createdAt: 2000,
          updatedAt: 2000,
        },
      ],
      "q2.1": [
        {
          id: "note-c",
          questionId: "q2.1",
          selectedText: "",
          noteText: "笔记C",
          createdAt: 3000,
          updatedAt: 3000,
        },
      ],
    };
    mockStorage.getItem.mockReturnValue(JSON.stringify(notesData));

    await migrateNotesToIndexedDB();

    // 验证 IndexedDB 数据
    const allNotes = await notesDb.notes.toArray();
    expect(allNotes).toHaveLength(3);

    const q1Notes = await notesDb.notes
      .where("questionId")
      .equals("q1.1")
      .toArray();
    expect(q1Notes).toHaveLength(2);

    // 验证迁移标记
    expect(mockStorage.setItem).toHaveBeenCalledWith("gm-notes-migrated", "1");
  });

  it("skips migration when already migrated", async () => {
    mockStorage.getItem.mockImplementation((key: string) => {
      if (key === "gm-notes-migrated") return "1";
      return null;
    });

    await migrateNotesToIndexedDB();

    // 不应写入任何 IndexedDB 数据
    const count = await notesDb.notes.count();
    expect(count).toBe(0);
  });

  it("skips migration when localStorage has no notes data", async () => {
    mockStorage.getItem.mockReturnValue(null);

    await migrateNotesToIndexedDB();

    // 应标记为已迁移
    expect(mockStorage.setItem).toHaveBeenCalledWith("gm-notes-migrated", "1");

    const count = await notesDb.notes.count();
    expect(count).toBe(0);
  });

  it("handles malformed localStorage JSON gracefully", async () => {
    mockStorage.getItem.mockReturnValue("not valid json {{{");

    await migrateNotesToIndexedDB();

    // 不应崩溃，不应标记迁移完成（下次重试）
    expect(mockStorage.setItem).not.toHaveBeenCalledWith(
      "gm-notes-migrated",
      "1",
    );

    const count = await notesDb.notes.count();
    expect(count).toBe(0);
  });

  it("handles localStorage unavailable gracefully", async () => {
    mockStorage.getItem.mockImplementation(() => {
      throw new Error("localStorage unavailable");
    });

    // 不应抛出
    await expect(migrateNotesToIndexedDB()).resolves.toBeUndefined();
  });

  it("isNotesMigrationDone reflects migration status", () => {
    mockStorage.getItem.mockImplementation((key: string) => {
      if (key === "gm-notes-migrated") return "1";
      return null;
    });

    expect(isNotesMigrationDone()).toBe(true);

    mockStorage.getItem.mockReturnValue(null);
    expect(isNotesMigrationDone()).toBe(false);
  });
});

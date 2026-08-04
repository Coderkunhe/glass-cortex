import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import "fake-indexeddb/auto";
import { useNotesDb } from "@/hooks/useNotesDb";
import { notesDb, type NoteRecord } from "@/lib/db/notesDb";

/** 工厂：创建测试用 NoteRecord */
function makeNoteRecord(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: "test-note-1",
    questionId: "q1.1",
    selectedText: "溢出的三种方式",
    noteText: "重要：滑动窗口适用于实时对话场景",
    highlightColor: "yellow",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe("useNotesDb", () => {
  beforeEach(async () => {
    // 清空 IndexedDB
    await notesDb.notes.clear();
  });

  afterEach(() => {
    // fake-indexeddb/auto 在每个测试后自动重置
  });

  it("returns empty notesMap and loaded=true when no notes exist", async () => {
    const { result } = renderHook(() => useNotesDb());

    // 初始状态：未加载
    expect(result.current.loaded).toBe(false);
    expect(result.current.notesMap).toEqual({});

    // 等待 IndexedDB 加载完成
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.notesMap).toEqual({});
  });

  it("loads existing notes from IndexedDB grouped by questionId", async () => {
    // 预种数据
    await notesDb.notes.bulkPut([
      makeNoteRecord({ id: "n1", questionId: "q1.1", noteText: "笔记A" }),
      makeNoteRecord({ id: "n2", questionId: "q1.1", noteText: "笔记B" }),
      makeNoteRecord({ id: "n3", questionId: "q2.1", noteText: "笔记C" }),
    ]);

    const { result } = renderHook(() => useNotesDb());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.notesMap["q1.1"]).toHaveLength(2);
    expect(result.current.notesMap["q2.1"]).toHaveLength(1);
    expect(result.current.notesMap["q1.1"][0].noteText).toBe("笔记A");
  });

  it("addNote writes to IndexedDB and updates state", async () => {
    const { result, rerender } = renderHook(() => useNotesDb());

    await waitFor(() => expect(result.current.loaded).toBe(true));

    const newNote = makeNoteRecord({
      id: "new-note",
      questionId: "q1.1",
      noteText: "新增笔记",
    });

    await act(async () => {
      await result.current.addNote(newNote);
    });
    rerender();

    // 验证 IndexedDB
    const stored = await notesDb.notes.get("new-note");
    expect(stored).toBeDefined();
    expect(stored!.noteText).toBe("新增笔记");

    // 验证 state
    expect(result.current.notesMap["q1.1"]).toHaveLength(1);
    expect(result.current.notesMap["q1.1"][0].noteText).toBe("新增笔记");
  });

  it("updateNote modifies existing note in IndexedDB and state", async () => {
    await notesDb.notes.put(
      makeNoteRecord({ id: "n1", questionId: "q1.1", noteText: "原始文本" }),
    );

    const { result, rerender } = renderHook(() => useNotesDb());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.updateNote("n1", "q1.1", "修改后的文本");
    });
    rerender();

    // 验证 IndexedDB
    const stored = await notesDb.notes.get("n1");
    expect(stored!.noteText).toBe("修改后的文本");
    expect(stored!.updatedAt).toBeGreaterThan(stored!.createdAt);

    // 验证 state
    expect(result.current.notesMap["q1.1"][0].noteText).toBe("修改后的文本");
  });

  it("deleteNote removes note from IndexedDB and state", async () => {
    await notesDb.notes.bulkPut([
      makeNoteRecord({ id: "n1", questionId: "q1.1" }),
      makeNoteRecord({ id: "n2", questionId: "q1.1" }),
    ]);

    const { result, rerender } = renderHook(() => useNotesDb());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.deleteNote("n1", "q1.1");
    });
    rerender();

    // 验证 IndexedDB
    const stored = await notesDb.notes.get("n1");
    expect(stored).toBeUndefined();

    // 验证 state
    expect(result.current.notesMap["q1.1"]).toHaveLength(1);
    expect(result.current.notesMap["q1.1"][0].id).toBe("n2");
  });

  it("addNote survives IndexedDB write failure (optimistic update)", async () => {
    const { result, rerender } = renderHook(() => useNotesDb());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Mock IndexedDB 写入失败
    const originalPut = notesDb.notes.put;
    notesDb.notes.put = vi.fn(() => {
      throw new Error("IndexedDB unavailable");
    }) as unknown as typeof notesDb.notes.put;

    const newNote = makeNoteRecord({
      id: "fallback-note",
      questionId: "q1.1",
      noteText: "离线笔记",
    });

    await act(async () => {
      await result.current.addNote(newNote);
    });
    rerender();

    // 即使 IndexedDB 失败，state 仍应更新（乐观）
    expect(result.current.notesMap["q1.1"]).toHaveLength(1);
    expect(result.current.notesMap["q1.1"][0].noteText).toBe("离线笔记");

    // 恢复
    notesDb.notes.put = originalPut;
  });

  it("handles IndexedDB load failure gracefully", async () => {
    // 删除数据库导致加载失败
    await notesDb.delete();

    const { result } = renderHook(() => useNotesDb());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    // 应降级为空数据而非崩溃
    expect(result.current.notesMap).toEqual({});
  });
});

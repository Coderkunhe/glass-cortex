"use client";

import { useState, useEffect, useCallback } from "react";
import { notesDb, type NoteRecord } from "@/lib/db/notesDb";

/**
 * IndexedDB 笔记数据访问 hook。
 *
 * - mount 时从 IndexedDB 全量加载 → 按 questionId 分组为 Record
 * - `loaded` 标志支持 hydration 过渡态（首帧空 → IndexedDB 返回后填充）
 * - CRUD 操作先写 IndexedDB → 再更新 React state
 * - IndexedDB 不可用时静默降级为空数据
 *
 * 与 localStorage 版 `useLocalStorage(LEARN_NOTES_KEY)` 的差异：
 * - 异步加载（loaded 标志代替 SSR-safe 级联渲染）
 * - 结构化查询（后续可低成本添加按时间/问题过滤，无需全量 JSON.parse）
 */
export function useNotesDb() {
  const [notesMap, setNotesMap] = useState<Record<string, NoteRecord[]>>({});
  const [loaded, setLoaded] = useState(false);

  // ── 初始化加载 ──────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const all = await notesDb.notes.toArray();
        if (cancelled) return;
        const grouped: Record<string, NoteRecord[]> = {};
        for (const note of all) {
          if (!grouped[note.questionId]) {
            grouped[note.questionId] = [];
          }
          grouped[note.questionId].push(note);
        }
        setNotesMap(grouped);
        setLoaded(true);
      } catch {
        // IndexedDB 不可用时静默降级
        if (!cancelled) setLoaded(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── CRUD 操作 ───────────────────────────────────────────────

  /** 新增笔记 — 写入 IndexedDB + 更新本地 state。 */
  const addNote = useCallback(async (note: NoteRecord) => {
    try {
      await notesDb.notes.put(note);
    } catch {
      // IndexedDB 写入失败，仍更新内存 state（乐观更新）
    }
    setNotesMap((prev) => {
      const existing = prev[note.questionId] || [];
      return { ...prev, [note.questionId]: [...existing, note] };
    });
  }, []);

  /** 更新笔记 — 按 id 匹配，更新 noteText + highlightColor（可选）+ updatedAt。 */
  const updateNote = useCallback(
    async (
      id: string,
      questionId: string,
      noteText: string,
      highlightColor?: string,
    ) => {
      const updatedAt = Date.now();
      const updates: Partial<NoteRecord> = { noteText, updatedAt };
      if (highlightColor !== undefined) {
        updates.highlightColor = highlightColor as NoteRecord["highlightColor"];
      }
      try {
        await notesDb.notes.update(id, updates);
      } catch {
        // 静默降级
      }
      setNotesMap((prev) => {
        const notes = prev[questionId] || [];
        return {
          ...prev,
          [questionId]: notes.map((n) =>
            n.id === id
              ? { ...n, noteText, updatedAt, ...(highlightColor !== undefined ? { highlightColor: highlightColor as NoteRecord["highlightColor"] } : {}) }
              : n,
          ),
        };
      });
    },
    [],
  );

  /** 删除笔记 — 按 id 从 IndexedDB + 本地 state 中移除。 */
  const deleteNote = useCallback(async (id: string, questionId: string) => {
    try {
      await notesDb.notes.delete(id);
    } catch {
      // 静默降级
    }
    setNotesMap((prev) => {
      const notes = prev[questionId] || [];
      return {
        ...prev,
        [questionId]: notes.filter((n) => n.id !== id),
      };
    });
  }, []);

  return { notesMap, loaded, addNote, updateNote, deleteNote } as const;
}

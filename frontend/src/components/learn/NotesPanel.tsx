"use client";

import { useState, useEffect } from "react";
import {
  RiStickyNoteLine,
  RiAddLine,
  RiPencilLine,
  RiDeleteBinLine,
  RiCheckLine,
  RiCloseLine,
  RiQuillPenLine,
} from "@remixicon/react";
import type { NoteRecord, HighlightColor } from "@/lib/db/notesDb";
import { HIGHLIGHT_COLORS } from "@/lib/db/notesDb";
import { useNotesDb } from "@/hooks/useNotesDb";
import { formatRelativeTime } from "@/lib/formatTime";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

/** 高亮颜色 → 圆点 Tailwind 类映射 */
const COLOR_DOT_CLASSES: Record<HighlightColor, string> = {
  yellow: "bg-yellow-400",
  green: "bg-green-400",
  blue: "bg-blue-400",
  pink: "bg-pink-400",
};

/** B147 高亮颜色 → 卡片左边框 Tailwind 类映射（对标微信读书） */
const COLOR_BORDER_CLASSES: Record<HighlightColor, string> = {
  yellow: "border-l-yellow-400",
  green: "border-l-green-400",
  blue: "border-l-blue-400",
  pink: "border-l-pink-400",
};

/** NotesPanel — 自包含划词笔记面板，内嵌 IndexedDB 读写（useNotesDb）。 */
export interface NotesPanelProps {
  /** 当前问题 ID */
  questionId: string;
  /** 从正文选中的文本片段，非空时自动进入创建模式并作为 selectedText 保存 */
  initialSelectedText?: string;
  /** 笔记创建/取消后的回调，用于父组件清理选中态 */
  onNoteCreated?: () => void;
  /** B146 高亮颜色预设（创建时使用，默认 "yellow"） */
  highlightColor?: HighlightColor;
}

/**
 * 自包含笔记面板。
 *
 * 使用 useNotesDb 直接管理 IndexedDB 笔记持久化，
 * 不需要父组件传递 state 或回调。仅需 `questionId` prop。
 *
 * 支持：创建（"+" 按钮 → 内联 textarea）、编辑、删除、确认弹窗。
 * B66 补齐正文选择工具栏 + 高亮渲染。
 * B143 数据源从 localStorage 迁移至 IndexedDB。
 */
export default function NotesPanel({
  questionId,
  initialSelectedText,
  onNoteCreated,
  highlightColor: presetColor = "yellow",
}: NotesPanelProps) {
  const { notesMap, addNote, updateNote, deleteNote } = useNotesDb();

  const currentNotes: NoteRecord[] = notesMap[questionId] || [];

  // ── 创建态 ─────────────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false);
  const [createText, setCreateText] = useState("");
  const [createColor, setCreateColor] = useState<HighlightColor>(presetColor);

  // ── 编辑态 ─────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingColor, setEditingColor] = useState<HighlightColor>("yellow");

  // ── 删除态 ─────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // questionId 变化时关闭所有交互态
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- questionId 切换需要同步复位交互态，避免编辑残留
    setIsCreating(false);
    setCreateText("");
    setEditingId(null);
    setEditingText("");
    setDeletingId(null);
  }, [questionId]);

  // initialSelectedText 非空 → 自动进入创建模式（同步颜色预设）
  useEffect(() => {
    if (initialSelectedText && initialSelectedText.trim()) {
      /* eslint-disable react-hooks/set-state-in-effect -- initialSelectedText 来自父组件划词回调，需同步触发创建模式 */
      setIsCreating(true);
      setCreateText("");
      setCreateColor(presetColor);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [initialSelectedText, presetColor]);

  // ── CRUD 操作 ──────────────────────────────────────────────

  async function handleCreate() {
    const trimmed = createText.trim();
    if (!trimmed) return;

    const newNote: NoteRecord = {
      id: crypto.randomUUID(),
      questionId,
      selectedText: initialSelectedText || "", // B66 划词创建时填充
      noteText: trimmed,
      highlightColor: createColor,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await addNote(newNote);
    setIsCreating(false);
    setCreateText("");
    setCreateColor(presetColor);
    onNoteCreated?.();
  }

  function handleCancelCreate() {
    setIsCreating(false);
    setCreateText("");
    setCreateColor(presetColor);
    onNoteCreated?.();
  }

  function startEdit(note: NoteRecord) {
    setEditingId(note.id);
    setEditingText(note.noteText);
    setEditingColor(note.highlightColor || "yellow");
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    const trimmed = editingText.trim();
    if (!trimmed) return;

    await updateNote(editingId, questionId, trimmed, editingColor);
    setEditingId(null);
    setEditingText("");
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditingText("");
  }

  async function handleDelete() {
    if (deletingId === null) return;
    await deleteNote(deletingId, questionId);
    setDeletingId(null);
  }

  // ── 渲染 ───────────────────────────────────────────────────

  return (
    <>
      <CollapsibleSection
        title="笔记"
        icon={<RiStickyNoteLine className="w-gm-icon-md h-gm-icon-md" />}
        rightAccessory={
          currentNotes.length > 0 ? (
            <span
              data-testid="notes-count"
              className="text-gm-xs text-text-muted"
            >
              {currentNotes.length}
            </span>
          ) : null
        }
        defaultOpen
      >
        <div data-testid="notes-panel" className="flex flex-col gap-gm-2">
          {/* 创建按钮 */}
          {!isCreating && (
            <button
              type="button"
              data-testid="note-create-btn"
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-gm-1 text-gm-sm text-text-muted
                         hover:text-text transition-all
                         focus-visible:ring-2 focus-visible:ring-brand/50
                         focus-visible:outline-none active:scale-[0.98] rounded-gm-xs
                         px-gm-1 py-gm-0.5 -ml-gm-1"
            >
              <RiAddLine className="w-gm-icon-sm h-gm-icon-sm" />
              <span>添加笔记</span>
            </button>
          )}

          {/* 内联创建区 */}
          {isCreating && (
            <div className="flex flex-col gap-gm-2">
              {/* 划词引用预览 */}
              {initialSelectedText && (
                <blockquote
                  data-testid="note-create-quote"
                  className="border-l-2 border-brand/30 pl-gm-2
                             text-gm-sm text-text-muted italic m-0
                             line-clamp-3"
                >
                  {initialSelectedText}
                </blockquote>
              )}
              {/* B146 颜色选择器 */}
              <div className="flex items-center gap-gm-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    data-testid={`create-color-${color}`}
                    aria-label={`${color} 划线色`}
                    onClick={() => setCreateColor(color)}
                    className={`w-6 h-6 rounded-full ${COLOR_DOT_CLASSES[color]}
                               transition-all hover:scale-110
                               focus-visible:ring-2 focus-visible:ring-brand/50
                               focus-visible:outline-none
                               ${createColor === color ? "ring-2 ring-offset-1 ring-offset-surface ring-brand" : "opacity-60 hover:opacity-100"}`}
                  />
                ))}
              </div>
              <textarea
                data-testid="note-create-textarea"
                value={createText}
                onChange={(e) => setCreateText(e.target.value)}
                placeholder="写下你的笔记…"
                rows={3}
                autoFocus
                className="w-full rounded-gm-md border border-border bg-surface
                           text-gm-sm text-text placeholder:text-text-muted
                           p-gm-2 resize-y transition-shadow
                           focus-visible:ring-2 focus-visible:ring-brand/50
                           focus-visible:outline-none"
              />
              <div className="flex items-center gap-gm-1">
                <button
                  type="button"
                  data-testid="note-create-save-btn"
                  onClick={handleCreate}
                  disabled={!createText.trim()}
                  className="flex items-center gap-gm-0.5 text-gm-xs
                             bg-brand text-white rounded-gm-md
                             px-gm-2 py-gm-0.5
                             hover:bg-brand/90 transition-all
                             disabled:opacity-50 disabled:cursor-not-allowed
                             focus-visible:ring-2 focus-visible:ring-brand/50
                             focus-visible:outline-none active:scale-[0.98]"
                >
                  <RiCheckLine className="w-gm-icon-sm h-gm-icon-sm" />
                  <span>保存</span>
                </button>
                <button
                  type="button"
                  data-testid="note-create-cancel-btn"
                  onClick={handleCancelCreate}
                  className="flex items-center gap-gm-0.5 text-gm-xs
                             text-text-muted hover:text-text
                             rounded-gm-md px-gm-2 py-gm-0.5
                             transition-all
                             focus-visible:ring-2 focus-visible:ring-brand/50
                             focus-visible:outline-none active:scale-[0.98]"
                >
                  <RiCloseLine className="w-gm-icon-sm h-gm-icon-sm" />
                  <span>取消</span>
                </button>
              </div>
            </div>
          )}

          {/* 笔记列表 */}
          {currentNotes.length > 0 ? (
            <ul className="flex flex-col gap-gm-2 m-0 p-0 list-none">
              {currentNotes.map((note) => {
                const noteColor: HighlightColor =
                  (note.highlightColor || "yellow") as HighlightColor;
                const hasNoteText = note.noteText && note.noteText.trim().length > 0;
                const borderClass = COLOR_BORDER_CLASSES[noteColor];

                return (
                  <li
                    key={note.id}
                    data-testid={`note-card-${note.id}`}
                    className={`gm-card-lift rounded-gm-lg border border-border
                               bg-surface-elevated shadow-gm-xs
                               flex flex-col
                               border-l-[3px] ${borderClass}
                               ${hasNoteText ? "p-gm-3 gap-gm-2" : "p-gm-2 gap-gm-1"}`}
                  >
                    {/* 选中文本引用块 + 颜色标识 */}
                    {note.selectedText && (
                      <div className="flex items-start gap-gm-2">
                        <span
                          data-testid={`note-color-dot-${note.id}`}
                          className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${COLOR_DOT_CLASSES[noteColor]}`}
                        />
                        <blockquote
                          data-testid={`note-quote-${note.id}`}
                          className="border-l-2 border-border pl-gm-2
                                     text-gm-sm text-text-secondary
                                     leading-relaxed line-clamp-3 m-0
                                     bg-surface rounded-gm-xs py-gm-0.5 pr-gm-1"
                        >
                          {note.selectedText}
                        </blockquote>
                      </div>
                    )}
                    {/* B146 无 selectedText 时也显示颜色点 */}
                    {!note.selectedText && (
                      <span
                        data-testid={`note-color-dot-${note.id}`}
                        className={`w-2 h-2 rounded-full ${COLOR_DOT_CLASSES[noteColor]}`}
                      />
                    )}

                    {/* 笔记正文 / 编辑态 */}
                    {editingId === note.id ? (
                      <div className="flex flex-col gap-gm-2">
                        {/* B146 编辑颜色选择器 */}
                        <div className="flex items-center gap-gm-1">
                          {HIGHLIGHT_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              data-testid={`edit-color-${color}`}
                              aria-label={`${color} 划线色`}
                              onClick={() => setEditingColor(color)}
                              className={`w-6 h-6 rounded-full ${COLOR_DOT_CLASSES[color]}
                                         transition-all hover:scale-110
                                         focus-visible:ring-2 focus-visible:ring-brand/50
                                         focus-visible:outline-none
                                         ${editingColor === color ? "ring-2 ring-offset-1 ring-offset-surface ring-brand" : "opacity-60 hover:opacity-100"}`}
                            />
                          ))}
                        </div>
                        <textarea
                          data-testid="note-edit-textarea"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          rows={3}
                          autoFocus
                          className="w-full rounded-gm-md border border-border
                                     bg-surface text-gm-sm text-text
                                     placeholder:text-text-muted
                                     p-gm-2 resize-y
                                     focus-visible:ring-2 focus-visible:ring-brand/50
                                     focus-visible:outline-none
                                     transition-shadow"
                        />
                        <div className="flex items-center gap-gm-1">
                          <button
                            type="button"
                            data-testid="note-save-btn"
                            onClick={handleSaveEdit}
                            disabled={!editingText.trim()}
                            className="flex items-center gap-gm-0.5 text-gm-xs
                                       bg-brand text-white rounded-gm-md
                                       px-gm-2 py-gm-0.5
                                       hover:bg-brand/90 transition-all
                                       disabled:opacity-50 disabled:cursor-not-allowed
                                       focus-visible:ring-2 focus-visible:ring-brand/50
                                       focus-visible:outline-none active:scale-[0.98]"
                          >
                            <RiCheckLine className="w-gm-icon-sm h-gm-icon-sm" />
                            <span>保存</span>
                          </button>
                          <button
                            type="button"
                            data-testid="note-cancel-btn"
                            onClick={handleCancelEdit}
                            className="flex items-center gap-gm-0.5 text-gm-xs
                                       text-text-muted hover:text-text
                                       rounded-gm-md px-gm-2 py-gm-0.5
                                       transition-all
                                       focus-visible:ring-2 focus-visible:ring-brand/50
                                       focus-visible:outline-none active:scale-[0.98]"
                          >
                            <RiCloseLine className="w-gm-icon-sm h-gm-icon-sm" />
                            <span>取消</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      hasNoteText && (
                        <p className="text-gm-sm text-text leading-relaxed m-0">
                          {note.noteText}
                        </p>
                      )
                    )}

                    {/* 元数据 + 操作 */}
                    {editingId !== note.id && (
                      <div className="flex items-center justify-between">
                        <span className="text-gm-xs text-text-muted">
                          {note.updatedAt !== note.createdAt
                            ? `已编辑 · ${formatRelativeTime(note.updatedAt)}`
                            : formatRelativeTime(note.createdAt)}
                        </span>
                        <div className="flex items-center gap-gm-0.5">
                          <button
                            type="button"
                            data-testid={`note-edit-btn-${note.id}`}
                            onClick={() => startEdit(note)}
                            aria-label="编辑笔记"
                            className="p-gm-0.5 text-text-muted hover:text-text
                                       hover:bg-surface rounded-gm-md
                                       transition-all
                                       focus-visible:ring-2 focus-visible:ring-brand/50
                                       focus-visible:outline-none active:scale-[0.98]"
                          >
                            <RiPencilLine className="w-gm-icon-sm h-gm-icon-sm" />
                          </button>
                          <button
                            type="button"
                            data-testid={`note-delete-btn-${note.id}`}
                            onClick={() => setDeletingId(note.id)}
                            aria-label="删除笔记"
                            className="p-gm-0.5 text-text-muted hover:text-danger
                                       hover:bg-surface rounded-gm-md
                                       transition-all
                                       focus-visible:ring-2 focus-visible:ring-brand/50
                                       focus-visible:outline-none active:scale-[0.98]"
                          >
                            <RiDeleteBinLine className="w-gm-icon-sm h-gm-icon-sm" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            !isCreating && (
              <div
                data-testid="notes-panel-empty"
                className="flex flex-col items-center gap-gm-2 py-gm-6"
              >
                <RiQuillPenLine className="w-8 h-8 text-text-muted/40" />
                <p className="text-gm-sm text-text-muted text-center m-0 leading-relaxed">
                  选中正文文字，划线标记或添加笔记
                </p>
              </div>
            )
          )}
        </div>
      </CollapsibleSection>

      {/* 删除确认 */}
      <ConfirmModal
        isOpen={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="删除笔记"
        message="确定要删除这条笔记吗？删除后不可恢复。"
        confirmLabel="删除"
        variant="danger"
      />
    </>
  );
}

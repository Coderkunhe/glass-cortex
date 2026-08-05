"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { RiCloseLine, RiCheckLine, RiQuillPenLine } from "@remixicon/react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/db/notesDb";

/** 高亮颜色 → 圆点 Tailwind 类映射 */
const COLOR_DOT_CLASSES: Record<HighlightColor, string> = {
  yellow: "bg-yellow-400 ring-yellow-500",
  green: "bg-green-400 ring-green-500",
  blue: "bg-blue-400 ring-blue-500",
  pink: "bg-pink-400 ring-pink-500",
};

/** 高亮颜色 → 引用块背景色映射 */
const COLOR_QUOTE_BG: Record<HighlightColor, string> = {
  yellow: "bg-yellow-50 dark:bg-yellow-500/10 border-l-yellow-400",
  green: "bg-green-50 dark:bg-green-500/10 border-l-green-400",
  blue: "bg-blue-50 dark:bg-blue-500/10 border-l-blue-400",
  pink: "bg-pink-50 dark:bg-pink-500/10 border-l-pink-400",
};

/**
 * NoteModal — 划词记笔记居中模态窗。
 *
 * 对标微信读书 UX：选中文本后点击"记笔记"→ 在当前滚动位置弹出模态窗，
 * 无需跳转到页面底部 NotesPanel。支持划词引用预览、颜色选择器、自由笔记输入。
 *
 * 对标 ConfirmModal 的 backdrop blur + fade-in 动画模式。
 */
export interface NoteModalProps {
  /** 是否显示弹窗 */
  isOpen: boolean;
  /** 关闭回调（取消/遮罩/Esc 触发） */
  onClose: () => void;
  /** 保存回调 — 异步写入 IndexedDB */
  onSave: (noteText: string, color: HighlightColor) => Promise<void>;
  /** 选中的原文引用文本（可选，为空时不显示引用预览） */
  selectedText?: string;
  /** 预设高亮颜色，默认 "yellow" */
  presetColor?: HighlightColor;
}

/**
 * 居中笔记编辑模态窗。
 *
 * 打开时自动聚焦 textarea，Esc/遮罩/X 按钮均可关闭。
 * 保存时按钮进入 loading 态，避免重复提交。
 */
export default function NoteModal({
  isOpen,
  onClose,
  onSave,
  selectedText,
  presetColor = "yellow",
}: NoteModalProps) {
  const [noteText, setNoteText] = useState("");
  const [color, setColor] = useState<HighlightColor>(presetColor);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 打开时重置状态 + 自动聚焦 textarea
  useEffect(() => {
    if (isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect -- isOpen 从 false→true 时需同步重置内部 UI 状态（对标 NotesPanel 模式） */
      setNoteText("");
      setColor(presetColor);
      setSaving(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      const id = requestAnimationFrame(() => textareaRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen, presetColor]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, saving, onClose]);

  const handleSave = useCallback(async () => {
    const trimmed = noteText.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed, color);
      onClose();
    } catch {
      setSaving(false);
    }
  }, [noteText, color, saving, onSave, onClose]);

  if (!isOpen) return null;

  const canSave = noteText.trim().length > 0 && !saving;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: "var(--gm-z-nav)" }}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-sm animate-gm-fade-in"
        onClick={() => {
          if (!saving) onClose();
        }}
        data-testid="note-modal-backdrop"
      />

      {/* 对话框 */}
      <div
        className="relative z-10 w-full max-w-xl mx-gm-4
                   bg-surface-elevated border border-border rounded-gm-xl
                   shadow-gm-xl animate-gm-fade-in"
        role="dialog"
        aria-modal="true"
        aria-label="记笔记"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between
                     px-gm-5 py-gm-4 border-b border-border"
        >
          <div className="flex items-center gap-gm-2">
            <span className="flex items-center justify-center w-8 h-8 rounded-gm-lg
                            bg-brand/10 text-brand">
              <RiQuillPenLine className="w-4 h-4" />
            </span>
            <h2 className="text-gm-base font-semibold text-text">记笔记</h2>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-gm-1 rounded-gm-sm text-text-muted
                       hover:text-text hover:bg-surface-lowered
                       transition-all disabled:opacity-40
                       focus-visible:ring-2 focus-visible:ring-brand/50
                       focus-visible:outline-none"
            aria-label="关闭"
          >
            <RiCloseLine className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-gm-5 py-gm-4 flex flex-col gap-gm-3">
          {/* 划词引用预览 */}
          {selectedText && selectedText.trim() && (
            <blockquote
              data-testid="note-modal-quote"
              className={`border-l-[3px] pl-gm-3 pr-gm-2 py-gm-2
                         rounded-gm-sm text-gm-sm text-text-secondary
                         leading-relaxed line-clamp-4 m-0 italic
                         ${COLOR_QUOTE_BG[color]}`}
            >
              {selectedText}
            </blockquote>
          )}

          {/* 颜色选择器 */}
          <div className="flex items-center gap-gm-1.5">
            <span className="text-gm-xs text-text-muted mr-gm-1">划线色：</span>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`note-modal-color-${c}`}
                aria-label={`${c} 划线色`}
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full ${COLOR_DOT_CLASSES[c]}
                           transition-all hover:scale-110
                           focus-visible:ring-2 focus-visible:ring-brand/50
                           focus-visible:outline-none
                           ${color === c
                             ? "ring-2 ring-offset-1 ring-offset-surface-elevated ring-brand scale-110"
                             : "opacity-60 hover:opacity-100"}`}
              />
            ))}
          </div>

          {/* 笔记输入区 */}
          <textarea
            ref={textareaRef}
            data-testid="note-modal-textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="写下你的想法…"
            rows={4}
            className="w-full rounded-gm-lg border border-border bg-surface
                       text-gm-sm text-text placeholder:text-text-muted
                       p-gm-3 resize-y transition-shadow
                       focus-visible:ring-2 focus-visible:ring-brand/50
                       focus-visible:outline-none"
          />
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-gm-2
                     px-gm-5 py-gm-4 border-t border-border"
        >
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-gm-lg px-gm-4 py-gm-2
                       text-gm-sm text-text-secondary
                       hover:text-text hover:bg-surface-lowered
                       transition-all disabled:opacity-40
                       focus-visible:ring-2 focus-visible:ring-brand/50
                       focus-visible:outline-none
                       active:scale-[0.98]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-gm-1 rounded-gm-lg
                       px-gm-4 py-gm-2 text-gm-sm font-medium
                       bg-brand text-white
                       hover:bg-brand/90 transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:ring-2 focus-visible:ring-brand/50
                       focus-visible:outline-none active:scale-[0.98]"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                保存中…
              </>
            ) : (
              <>
                <RiCheckLine className="w-gm-icon-sm h-gm-icon-sm" />
                保存笔记
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

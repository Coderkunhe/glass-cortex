"use client";

import { useState, useEffect, useCallback, useLayoutEffect } from "react";
import {
  useFloating,
  flip,
  shift,
  offset,
} from "@floating-ui/react";
import {
  RiDeleteBinLine,
  RiFileCopyLine,
  RiStickyNoteLine,
} from "@remixicon/react";
import type { HighlightColor } from "@/lib/db/notesDb";

/** HighlightPopover — 点击划线文本弹出的操作菜单。对标微信读书划线交互。 */
export interface HighlightPopoverProps {
  /** NoteRecord.id，用于删除回调定位 */
  noteId: string;
  /** 选中的文本内容 */
  selectedText: string;
  /** 划线颜色 */
  color: HighlightColor;
  /** 被点击 <mark> 元素的 getBoundingClientRect()，为 null 时弹窗隐藏 */
  referenceRect: DOMRect | null;
  /** 删除划线回调 */
  onDelete: (noteId: string) => void;
  /** 记笔记回调 — 打开 NotesPanel 编辑 */
  onAddNote: (text: string, color: HighlightColor) => void;
  /** 弹窗关闭回调 */
  onClose: () => void;
}

/** 弹窗自动消失延迟（ms） */
const AUTO_CLOSE_DELAY = 3000;

/**
 * 划线点击操作弹窗。
 *
 * 对标微信读书 UX：点击划线文本 → 弹出操作菜单（删除/复制/记笔记）。
 * 使用 @floating-ui/react 智能定位（flip + shift），自动适应视口边界。
 */
export default function HighlightPopover({
  noteId,
  selectedText,
  color,
  referenceRect,
  onDelete,
  onAddNote,
  onClose,
}: HighlightPopoverProps) {
  const [copied, setCopied] = useState(false);

  // (destructured as `fRefs` to avoid react-hooks/refs false-positive)
  const { refs: fRefs, floatingStyles } = useFloating({
    placement: "top",
    middleware: [
      offset(8),
      shift({ padding: 8 }),
      flip({ padding: 8 }),
    ],
    open: referenceRect !== null,
  });

  // B147 虚拟参考元素 — 用 setPositionReference 而非 elements.reference
  // floating-ui 不允许在 elements.reference 中传虚拟元素，必须用此 API。
  useLayoutEffect(() => {
    if (referenceRect) {
      fRefs.setPositionReference({
        getBoundingClientRect: () => referenceRect,
      });
    }
  }, [referenceRect, fRefs]);

  // 自动消失计时器
  useEffect(() => {
    if (!referenceRect) return;
    const timer = setTimeout(onClose, AUTO_CLOSE_DELAY);
    return () => clearTimeout(timer);
  }, [referenceRect, onClose]);

  // Esc 关闭
  useEffect(() => {
    if (!referenceRect) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [referenceRect, onClose]);

  // 点击外部关闭
  useEffect(() => {
    if (!referenceRect) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-highlight-popover]")) {
        onClose();
      }
    };
    // 延迟绑定避免同一 click 事件触发关闭
    const id = setTimeout(() => {
      document.addEventListener("mousedown", onMouseDown);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [referenceRect, onClose]);

  // 复制到剪贴板
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(selectedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用，静默失败
    }
  }, [selectedText]);

  if (!referenceRect) return null;

  return (
    <div
      data-highlight-popover
      role="dialog"
      aria-label="划线操作"
      ref={
        // eslint-disable-next-line react-hooks/refs
        fRefs.setFloating
      }
      style={floatingStyles}
      className="fixed z-50"
    >
      <div
        className="flex items-center gap-gm-1 px-gm-2 py-gm-1
                   bg-deep text-inverse rounded-gm-md shadow-gm-md
                   select-none animate-gm-onion-in"
      >
        {/* 删除划线 */}
        <button
          type="button"
          data-testid="highlight-popover-delete"
          aria-label="删除划线"
          onClick={() => {
            onDelete(noteId);
            onClose();
          }}
          className="flex items-center gap-gm-0.5 text-gm-xs font-medium
                     text-inverse/70 hover:text-danger-light
                     transition-colors
                     focus-visible:ring-2 focus-visible:ring-brand/50
                     focus-visible:outline-none active:scale-[0.98]
                     whitespace-nowrap"
        >
          <RiDeleteBinLine className="w-gm-icon-sm h-gm-icon-sm" />
          <span>删除</span>
        </button>

        {/* 分隔线 */}
        <span className="w-px h-4 bg-border/30" />

        {/* 复制 */}
        <button
          type="button"
          data-testid="highlight-popover-copy"
          aria-label="复制"
          onClick={handleCopy}
          className="flex items-center gap-gm-0.5 text-gm-xs font-medium
                     text-inverse/70 hover:text-inverse
                     transition-colors
                     focus-visible:ring-2 focus-visible:ring-brand/50
                     focus-visible:outline-none active:scale-[0.98]
                     whitespace-nowrap"
        >
          <RiFileCopyLine className="w-gm-icon-sm h-gm-icon-sm" />
          <span>{copied ? "已复制" : "复制"}</span>
        </button>

        {/* 分隔线 */}
        <span className="w-px h-4 bg-border/30" />

        {/* 记笔记 */}
        <button
          type="button"
          data-testid="highlight-popover-note"
          aria-label="记笔记"
          onClick={() => {
            onAddNote(selectedText, color);
            onClose();
          }}
          className="flex items-center gap-gm-0.5 text-gm-xs font-medium
                     text-inverse/70 hover:text-inverse
                     transition-colors
                     focus-visible:ring-2 focus-visible:ring-brand/50
                     focus-visible:outline-none active:scale-[0.98]
                     whitespace-nowrap"
        >
          <RiStickyNoteLine className="w-gm-icon-sm h-gm-icon-sm" />
          <span>记笔记</span>
        </button>
      </div>

      {/* 三角箭头指向点击的 mark 元素 */}
      <div
        className="absolute left-1/2 -translate-x-1/2
                   w-0 h-0
                   border-l-4 border-r-4 border-t-4
                   border-l-transparent border-r-transparent border-t-deep"
        style={{ bottom: "-4px" }}
      />
    </div>
  );
}

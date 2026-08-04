"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RiStickyNoteLine } from "@remixicon/react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/db/notesDb";

/** 高亮颜色 → 圆点 Tailwind 类映射 */
const COLOR_DOT_CLASSES: Record<HighlightColor, string> = {
  yellow: "bg-yellow-400 ring-yellow-500",
  green: "bg-green-400 ring-green-500",
  blue: "bg-blue-400 ring-blue-500",
  pink: "bg-pink-400 ring-pink-500",
};

/** SelectionToolbar — 正文划词浮动工具栏，支持多色划线和记笔记。 */
export interface SelectionToolbarProps {
  /** 监听的容器 ref，仅响应此容器内的文本选中 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 快速划线回调 — 点击颜色圆点时立即触发，不打开笔记面板 */
  onHighlight: (selectedText: string, color: HighlightColor) => void;
  /** 记笔记回调 — 传递选中文本和当前激活颜色 */
  onAddNote: (selectedText: string, color: HighlightColor) => void;
  /** 当前激活的高亮颜色 */
  activeColor: HighlightColor;
  /** 切换激活颜色回调 */
  onColorChange: (color: HighlightColor) => void;
}

/** 工具栏高度估算值（px），用于位置计算 */
const TOOLBAR_HEIGHT = 36;
/** 工具栏与选区的间距（px） */
const TOOLBAR_GAP = 8;
/** 选中文本最小长度（字符），过短不显示工具栏 */
const MIN_SELECTION_LENGTH = 2;

/**
 * 划词浮动工具栏。
 *
 * B146 重构：从单一"记笔记"按钮升级为 4 色调色板 + 记笔记按钮。
 * - 点击颜色圆点 → 即时划线（不弹出笔记面板）
 * - 点击"记笔记" → 打开笔记创建面板（颜色预设为当前激活色）
 * - 点击外部 / Esc / 选区消失 → 自动隐藏
 */
export default function SelectionToolbar({
  containerRef,
  onHighlight,
  onAddNote,
  activeColor,
  onColorChange,
}: SelectionToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const selectedTextRef = useRef("");

  /** 计算工具栏锚点：选区上方居中 */
  const calcPosition = useCallback((rect: DOMRect) => {
    const x = Math.max(8, rect.left + rect.width / 2);
    const aboveY = rect.top - TOOLBAR_GAP;
    const belowY = rect.bottom + TOOLBAR_GAP;
    const y = aboveY >= TOOLBAR_HEIGHT + 8 ? aboveY : belowY;
    return { x, y };
  }, []);

  /** mouseup 处理器：检测选区内文本选中 */
  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-selection-toolbar]")) return;

      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setVisible(false);
          return;
        }

        const text = sel.toString().trim();
        if (text.length < MIN_SELECTION_LENGTH) {
          setVisible(false);
          return;
        }

        const container = containerRef.current;
        if (!container) return;

        const range = sel.getRangeAt(0);
        if (
          !container.contains(range.startContainer) ||
          !container.contains(range.endContainer)
        ) {
          setVisible(false);
          return;
        }

        const rect = range.getBoundingClientRect();
        const pos = calcPosition(rect);
        selectedTextRef.current = text;
        setPosition(pos);
        setVisible(true);
      });
    },
    [containerRef, calcPosition],
  );

  /** 点击工具栏外部 → 隐藏 */
  useEffect(() => {
    if (!visible) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-selection-toolbar]")) {
        setVisible(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisible(false);
    };

    const id = setTimeout(() => {
      document.addEventListener("mousedown", onMouseDown);
      document.addEventListener("keydown", onKeyDown);
    }, 0);

    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [visible]);

  // 全局 mouseup 监听
  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  if (!visible) return null;

  return (
    <div
      data-selection-toolbar
      className="fixed z-50"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div
        className="flex items-center gap-gm-1 px-gm-2 py-gm-1
                   bg-deep text-inverse rounded-gm-md shadow-gm-md
                   select-none"
      >
        {/* 颜色调色板 */}
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            data-testid={`highlight-color-${color}`}
            aria-label={`${color} 划线`}
            onClick={() => {
              onColorChange(color);
              onHighlight(selectedTextRef.current, color);
              setVisible(false);
              window.getSelection()?.removeAllRanges();
            }}
            className={`w-4 h-4 rounded-full ${COLOR_DOT_CLASSES[color]}
                       transition-all
                       hover:scale-110
                       focus-visible:ring-2 focus-visible:ring-offset-1
                       focus-visible:ring-offset-deep focus-visible:outline-none
                       ${activeColor === color ? "ring-2 ring-offset-1 ring-offset-deep" : ""}`}
          />
        ))}

        {/* 分隔线 */}
        <span className="w-px h-4 bg-border/30 mx-gm-0.5" />

        {/* 记笔记按钮 */}
        <button
          type="button"
          data-testid="selection-toolbar-btn"
          onClick={() => {
            onAddNote(selectedTextRef.current, activeColor);
            setVisible(false);
            window.getSelection()?.removeAllRanges();
          }}
          className="flex items-center gap-gm-0.5 text-gm-xs font-medium
                     text-inverse/80 hover:text-inverse
                     transition-all
                     focus-visible:ring-2 focus-visible:ring-brand/50
                     focus-visible:outline-none active:scale-[0.98]
                     whitespace-nowrap"
        >
          <RiStickyNoteLine className="w-gm-icon-sm h-gm-icon-sm" />
          <span>记笔记</span>
        </button>
      </div>

      {/* 小三角箭头指向选区 */}
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

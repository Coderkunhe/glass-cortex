"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RiStickyNoteLine } from "@remixicon/react";

/** SelectionToolbar — 正文划词浮动工具栏，选中文本后显示"记笔记"按钮。 */
export interface SelectionToolbarProps {
  /** 监听的容器 ref，仅响应此容器内的文本选中 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 用户点击"记笔记"时的回调，传入选中的文本 */
  onAddNote: (selectedText: string) => void;
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
 * 监听 document mouseup 事件，检测容器内的文本选中，
 * 在选区上方居中显示"记笔记"按钮。
 * 点击外部 / Esc / 选区消失 → 自动隐藏。
 */
export default function SelectionToolbar({
  containerRef,
  onAddNote,
}: SelectionToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const selectedTextRef = useRef("");

  /** 计算工具栏锚点：选区上方居中 */
  const calcPosition = useCallback((rect: DOMRect) => {
    const x = Math.max(8, rect.left + rect.width / 2);
    // 优先放在选区上方，空间不足则放下方
    const aboveY = rect.top - TOOLBAR_GAP;
    const belowY = rect.bottom + TOOLBAR_GAP;
    const y = aboveY >= TOOLBAR_HEIGHT + 8 ? aboveY : belowY;
    return { x, y };
  }, []);

  /** mouseup 处理器：检测选区内文本选中 */
  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      // 略过工具栏自身点击
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-selection-toolbar]")) return;

      // 延迟一帧让浏览器完成选区更新
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

        // 检查选区是否在容器内
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

    // 延迟绑定避免 mouseup 立即触发 mousedown 关闭
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
      <button
        type="button"
        data-testid="selection-toolbar-btn"
        onClick={() => {
          onAddNote(selectedTextRef.current);
          setVisible(false);
          window.getSelection()?.removeAllRanges();
        }}
        className="flex items-center gap-gm-1 px-gm-2_5 py-gm-1
                   bg-deep text-inverse text-gm-xs font-medium
                   rounded-gm-md shadow-gm-md
                   hover:bg-deep/90 transition-all
                   focus-visible:ring-2 focus-visible:ring-brand/50
                   focus-visible:outline-none active:scale-[0.98]
                   whitespace-nowrap select-none"
      >
        <RiStickyNoteLine className="w-gm-icon-sm h-gm-icon-sm" />
        <span>记笔记</span>
      </button>
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

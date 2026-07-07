/**
 * IntentPill — 意图分类标签组件。
 *
 * 在用户消息旁渲染彩色意图分类 pill，显示类别、置信度和推理说明。
 * 可选 clickable 模式（作为 button 渲染）以触发深度抽屉。
 * 颜色映射 INTENT_COLORS 与 OnionPanel 共享。
 *
 * Phase 66 B23: rationale 从 title 属性升级为 click-triggered popover —
 * info 图标（RiInformationLine）点击/聚焦 → @floating-ui popover 展示推理说明。
 *
 * @module components/chat/IntentPill
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useFloating,
  shift,
  flip,
  offset,
} from "@floating-ui/react";
import { RiInformationLine } from "@remixicon/react";
import type { IntentCategory } from "@/lib/api/types";
import { INTENT_COLORS, DEFAULT_INTENT_COLORS } from "@/lib/content/constants";

export interface IntentPillProps {
  /** 意图类别 */
  category: IntentCategory | string;
  /** 置信度 0-1 */
  confidence: number;
  /** 可选的推理说明（hover 时显示） */
  rationale?: string;
  /** 可选: 任务复杂度（来自路由决策 — "simple" | "complex"） */
  complexity?: string;
  /** 可选: 大号样式 */
  large?: boolean;
  /** 可选: 点击时触发（如打开深度抽屉） */
  onClick?: () => void;
}

/**
 * 意图标签 pill 组件。
 *
 * 在用户消息旁渲染彩色意图分类标签，复用方向匹配 INTENT_COLORS。
 * Phase 66 B23: rationale 从 title 属性升级为 click-triggered popover。
 */
/** 复杂度显示标签映射 */
const COMPLEXITY_LABELS: Record<string, string> = {
  simple: "简单",
  complex: "复杂",
};

export default function IntentPill({ category, confidence, rationale, complexity, large, onClick }: IntentPillProps) {
  const colors = INTENT_COLORS[category] || DEFAULT_INTENT_COLORS;
  const Tag = onClick ? "button" : "span";

  // Phase 66 B23 — rationale popover state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Phase 66 B102 — 即时 tooltip 替代原生 title (C7)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  const { refs: fRefs, floatingStyles } = useFloating({
    placement: "top",
    middleware: [
      offset(6),
      shift({ padding: 8 }),
      flip({ padding: 8 }),
    ],
  });

  // 点击外部关闭 popover
  const handleDocClick = useCallback((e: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
      setPopoverOpen(false);
    }
  }, []);
  useEffect(() => {
    if (!popoverOpen) return;
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [popoverOpen, handleDocClick]);

  // Esc 关闭 popover
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [popoverOpen]);

  return (
    <>
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center rounded-full font-semibold transition-all
        ${colors.bg} ${colors.text} ${colors.border}
        ${large
          ? "gap-gm-1.5 px-gm-3 py-gm-0.5 text-gm-sm border"
          : "gap-gm-1 px-gm-2 py-px text-gm-xs border"
        }
        ${onClick ? "cursor-pointer hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none" : ""}
      `}
    >
      <span
        className="truncate max-w-[72px]"
        onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setTooltip((prev) => (prev ? { x: e.clientX, y: e.clientY } : null))}
        onMouseLeave={() => setTooltip(null)}
      >
        {category}
      </span>
      <span className="opacity-75">·</span>
      <span className="tabular-nums">{(confidence * 100).toFixed(0)}%</span>
      {/* Phase 66 B43 — complexity badge from routing decision */}
      {complexity && (
        <>
          <span className="opacity-75">·</span>
          <span className="rounded-full bg-surface-lowered px-gm-1.5 py-px text-gm-2xs font-medium text-text-secondary">
            {COMPLEXITY_LABELS[complexity] ?? complexity}
          </span>
        </>
      )}
      {/* Phase 66 B23 — rationale info icon + popover */}
      {rationale && (
        <>
          <button
            type="button"
            ref={(node) => { fRefs.setReference(node); }}
            onClick={(e) => {
              e.stopPropagation(); // 不触发父 button/span 的 onClick
              setPopoverOpen((v) => !v);
            }}
            className="inline-flex items-center justify-center
                       rounded-full p-px
                       text-current opacity-50 hover:opacity-100
                       focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                       transition-opacity cursor-pointer"
            aria-label={`推理说明: ${rationale}`}
            aria-expanded={popoverOpen}
          >
            <RiInformationLine className="w-3.5 h-3.5" />
          </button>
          {popoverOpen && (
            <div
              ref={(node) => {
                popoverRef.current = node;
                fRefs.setFloating(node);
              }}
              className="max-w-[260px] w-max py-gm-2 px-gm-3 bg-surface-elevated border border-border rounded-gm-sm shadow-gm-md text-gm-xs leading-relaxed text-text whitespace-normal"
              role="tooltip"
              style={{ ...floatingStyles, zIndex: "var(--gm-z-overlay)" }}
            >
              <span className="text-text-muted text-gm-2xs font-normal">
                为什么判定为「{category}」：
              </span>
              <br />
              <span>{rationale}</span>
              {/* popover arrow — replaces ::after pseudo-element */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-border" />
            </div>
          )}
        </>
      )}
    </Tag>
    {/* Phase 66 B102 — 即时 tooltip 替代原生 title (C7) */}
    {tooltip && (
      <div
        className="fixed z-50 rounded-gm-sm border border-border-strong
                   bg-surface-elevated px-gm-2.5 py-gm-1.5
                   shadow-gm-md pointer-events-none"
        style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
      >
        <p className="text-gm-xs text-text whitespace-nowrap">{category}</p>
      </div>
    )}
    </>
  );
}

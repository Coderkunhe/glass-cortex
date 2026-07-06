"use client";

/**
 * ContextualLens — 上下文感知微型教学入口组件。
 *
 * 在聊天页的语义触发点（token 计量、错误处理、上下文溢出等）嵌入
 * 可展开的教学卡片，让用户在不离开聊天页的情况下获得即时洞察。
 *
 * 纯展示组件——内容通过 children 注入，不耦合任何具体知识点。
 * 展开/收起模式与 ChatMessage 现有 toggle 按钮保持一致。
 */

import { useState, type ReactNode } from "react";
import { RiArrowUpSLine, RiQuestionLine } from "@remixicon/react";

export interface ContextualLensProps {
  /** 折叠态触发按钮的文案 */
  triggerLabel: string;
  /** 触发按钮图标，默认问号图标 */
  triggerIcon?: ReactNode;
  /** 展开后显示的标题 */
  title: string;
  /** 展开后显示的内容 */
  children: ReactNode;
  /** 是否默认展开 */
  defaultOpen?: boolean;
}

export default function ContextualLens({
  triggerLabel,
  triggerIcon,
  title,
  children,
  defaultOpen = false,
}: ContextualLensProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls="contextual-lens-content"
        className="flex items-center gap-gm-1 text-gm-sm text-text-muted
                   hover:text-brand transition-colors cursor-pointer active:scale-[0.97]
                   focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
      >
        {triggerIcon !== undefined ? triggerIcon : <RiQuestionLine className="text-gm-icon" />}
        <span>{triggerLabel}</span>
      </button>
    );
  }

  return (
    <>
      {/* Trigger button — 保持可见，active 态（与消息旅程/对话历史/洋葱面板行为一致） */}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-expanded={true}
        aria-controls="contextual-lens-content"
        className="flex items-center gap-gm-1 text-gm-sm text-brand font-medium transition-colors cursor-pointer active:scale-[0.97]
                   focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
      >
        {triggerIcon !== undefined ? triggerIcon : <RiQuestionLine className="text-gm-icon" />}
        <span>{triggerLabel}</span>
      </button>
      {/* 展开卡片 — w-full 在 flex-wrap 容器中强制独立行 */}
      <div
        id="contextual-lens-content"
        className="rounded-gm-md border border-border bg-surface-elevated p-gm-4 space-y-gm-3 w-full"
        data-testid="contextual-lens-content"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-gm-sm font-semibold text-text
                       hover:text-brand transition-colors cursor-pointer active:scale-[0.97]
                       focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
          >
            {title}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-gm-1 text-gm-sm text-text-muted
                       hover:text-text-secondary transition-colors cursor-pointer active:scale-[0.97]
                       focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
            aria-label="收起"
          >
            <RiArrowUpSLine className="text-gm-icon" />
            <span>收起</span>
          </button>
        </div>

        {/* 内容区 */}
        <div>{children}</div>
      </div>
    </>
  );
}

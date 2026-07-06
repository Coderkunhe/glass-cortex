"use client";

import type { ReactNode } from "react";

/** Props for KVRow key-value display row. */
export interface KVRowProps {
  /** Left-side label text. */
  label: string;
  /** Right-side value text (monospace, auto-break). */
  value: string | ReactNode;
  /** Highlight value in danger/red (e.g. parse error). */
  error?: boolean;
  /** Appended to the outermost wrapper `<div>`. */
  className?: string;
  /** Data attribute for test querying. */
  "data-testid"?: string;
}

/**
 * KVRow — 统一的 Key-Value 行组件。
 *
 * 提取自 ProcessDrawer 和 ModelInferencePanel 两个逐字重复的本地实现。
 * 左标签右值，flex 布局，标签 muted 色，值等宽字体右对齐。
 */
export function KVRow({
  label,
  value,
  error = false,
  className = "",
  "data-testid": dataTestId,
}: KVRowProps) {
  return (
    <div
      className={`flex items-center justify-between gap-gm-3 py-gm-1_5 ${className}`.trim()}
      data-testid={dataTestId}
    >
      <span className="text-gm-xs font-medium shrink-0 tracking-wide text-text-muted">
        {label}
      </span>
      <span
        className={`text-gm-xs text-right font-mono break-all max-w-[55%] leading-normal ${
          error ? "text-danger font-semibold" : "text-text-secondary"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

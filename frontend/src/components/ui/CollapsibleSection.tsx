"use client";

import { useState, useCallback, type ReactNode } from "react";
import { RiArrowDownSLine } from "@remixicon/react";

// ── Types ──────────────────────────────────────────────────────────────

export interface CollapsibleSectionProps {
  /** Section header text. Can be a ReactNode for inline badges/indicators. */
  title: ReactNode;
  /** Optional icon shown before the title (Remix Icon element or emoji string). */
  icon?: ReactNode;
  /** Collapsible content body. Hidden when collapsed. */
  children: ReactNode;

  // ── State management ──

  /** Controlled open state. Omit for uncontrolled (internal state). */
  open?: boolean;
  /** Called when the user clicks the toggle button. Receives the next open state. */
  onToggle?: (nextOpen: boolean) => void;
  /** Initial open state in uncontrolled mode. Default: false. */
  defaultOpen?: boolean;

  // ── Visual variant ──

  /**
   * Visual style preset:
   * - `ghost` (default): no container border, lightweight header hover
   * - `bordered`: container with border, separator between header and content
   * - `card`: container with border + shadow + background, header has bottom border
   */
  variant?: "ghost" | "bordered" | "card";

  // ── Extras ──

  /** Content rendered in the header row, right-aligned, outside the toggle hit area. */
  rightAccessory?: ReactNode;
  /** Enable CSS max-height + opacity transition for the content area. */
  animated?: boolean;

  // ── Styling overrides ──

  /** Appended to the outermost wrapper element. */
  className?: string;
  /** Appended to the toggle button element. Use for color overrides (e.g. AnswerCard L2/L3). */
  headerClassName?: string;
  /** Appended to the content wrapper `<div>`. */
  contentClassName?: string;

  /** Data attribute for test querying. */
  "data-testid"?: string;
}

// ── Variant style maps ─────────────────────────────────────────────────

const CONTAINER: Record<string, string> = {
  ghost: "",
  bordered: "rounded-gm-sm border border-border bg-surface-elevated overflow-hidden",
  card: "rounded-gm-lg border border-border bg-surface-elevated shadow-gm-sm overflow-hidden",
};

const HEADER: Record<string, string> = {
  ghost:
    "flex items-center gap-gm-1_5 cursor-pointer px-gm-2 py-gm-1_5 " +
    "rounded-gm-xs hover:bg-bg-subtle w-full text-left",
  bordered:
    "flex items-center gap-gm-1_5 cursor-pointer px-gm-3 py-gm-2 " +
    "w-full text-left hover:bg-bg-subtle transition-all",
  card:
    "flex items-center gap-gm-2 cursor-pointer px-gm-4 py-gm-3 " +
    "w-full text-left bg-bg-subtle border-b border-border hover:opacity-80 transition-all",
};

const HEADER_TEXT: Record<string, string> = {
  ghost: "text-gm-xs font-semibold uppercase tracking-wider text-text-muted flex-1",
  bordered: "text-gm-sm text-text-secondary flex-1",
  card: "text-gm-sm font-semibold tracking-wide text-text flex-1",
};

const CONTENT: Record<string, string> = {
  ghost: "px-gm-2 pt-gm-2 pb-gm-1",
  bordered: "border-t border-border px-gm-3 py-gm-2",
  card: "px-gm-4 py-gm-3",
};

// ── Component ──────────────────────────────────────────────────────────

/**
 * CollapsibleSection — 统一的折叠/展开区块组件。
 *
 * 提取自 8 个独立实现的 collapse/expand 模式，统一为一个共享组件。
 * 支持三种视觉变体（ghost/bordered/card）、受控/非受控双模式、
 * 右侧附加操作（复制按钮等）、CSS 动画过渡。
 *
 * A11: toggle button 设置 aria-expanded，折叠箭头设置 aria-hidden。
 */
export function CollapsibleSection({
  title,
  icon,
  children,
  open: controlledOpen,
  onToggle,
  defaultOpen = false,
  variant = "ghost",
  rightAccessory,
  animated = false,
  className = "",
  headerClassName = "",
  contentClassName = "",
  "data-testid": dataTestId,
}: CollapsibleSectionProps) {
  const isControlled = controlledOpen !== undefined;

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const toggle = useCallback(() => {
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onToggle?.(next);
  }, [isOpen, isControlled, onToggle]);

  const containerCls = CONTAINER[variant];
  const headerCls = HEADER[variant];
  const headerTextCls = HEADER_TEXT[variant];
  const contentCls = CONTENT[variant];

  return (
    <div
      className={`${containerCls} ${className}`.trim()}
      data-testid={dataTestId}
    >
      {/* Header row: toggle button (left) + rightAccessory (right) */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className={`${headerCls} focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98] ${headerClassName}`.trim()}
        >
          {/* Arrow indicator — rotates 90° when open */}
          <span
            aria-hidden="true"
            className="shrink-0 text-gm-icon transition-transform duration-200"
            style={{
              transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
            }}
          >
            <RiArrowDownSLine />
          </span>

          {icon && <span className="shrink-0">{icon}</span>}

          <span className={headerTextCls}>{title}</span>
        </button>

        {rightAccessory && (
          <div className="shrink-0 pr-gm-2">{rightAccessory}</div>
        )}
      </div>

      {/* Content — always in DOM (tests query by text), hidden when collapsed */}
      <div
        className={`${contentCls} ${contentClassName}`.trim()}
        hidden={!isOpen && !animated}
        style={
          !isOpen && animated
            ? {
                maxHeight: "0px",
                opacity: 0,
                overflow: "hidden",
                transition: "max-height var(--gm-duration-slow) ease-in-out, opacity var(--gm-duration-slow) ease-in-out",
              }
            : isOpen && animated
              ? {
                  overflow: "hidden",
                  transition: "max-height var(--gm-duration-slow) ease-in-out, opacity var(--gm-duration-slow) ease-in-out",
                }
              : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}

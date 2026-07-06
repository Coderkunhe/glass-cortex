"use client";

import { RiRefreshLine } from "@remixicon/react";

// ── Types ──────────────────────────────────────────────────────────────

export interface RefreshButtonProps {
  /** Called when the button is clicked. */
  onClick: () => void;

  /**
   * Visual style preset:
   * - `"ghost"`: minimal icon-only, no border — for header bars (JourneyHistoryBrowser)
   * - `"bordered"` (default): border + surface background — for lab panels
   */
  variant?: "ghost" | "bordered";

  /** When true, shows animate-spin on the icon and disables the button. */
  loading?: boolean;

  /**
   * Accessible name for the button.
   * Default: `"刷新数据"`.
   */
  "aria-label"?: string;

  // ── Styling overrides ──

  /** Appended to the outermost button element. Use for `ml-auto`, etc. */
  className?: string;
  /** Data attribute for test querying. */
  "data-testid"?: string;
}

// ── Variant style maps ─────────────────────────────────────────────────

const BUTTON_STYLE: Record<string, string> = {
  ghost:
    "shrink-0 p-gm-1 rounded-gm-xs text-text-muted " +
    "hover:text-text hover:bg-bg-subtle transition-colors " +
    "disabled:opacity-50",
  bordered:
    "shrink-0 rounded-gm-sm border border-border bg-surface " +
    "px-gm-2 py-gm-0.5 text-gm-xs text-text-muted " +
    "hover:text-text transition-colors",
};

// ── Component ──────────────────────────────────────────────────────────

/**
 * RefreshButton — 刷新按钮
 *
 * Extracted from 12 inline implementations across the codebase.
 * Two visual variants cover all existing refresh patterns:
 * ghost (minimal, always visible) and bordered (lab panel standard).
 */
export function RefreshButton({
  onClick,
  variant = "bordered",
  loading = false,
  "aria-label": ariaLabel = "刷新数据",
  className = "",
  "data-testid": dataTestId,
}: RefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label={ariaLabel}
      className={`${BUTTON_STYLE[variant]} ${className}`.trim()}
      data-testid={dataTestId}
    >
      <RiRefreshLine
        className={`w-4 h-4 ${loading ? "animate-spin" : ""}`.trim()}
      />
    </button>
  );
}

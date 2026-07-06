"use client";

/**
 * DataState — unified fetch-state presentation wrapper.
 *
 * Eliminates the copy-pasted loading/error/empty triplet that 16 components
 * previously duplicated inline.  Each consumer passes its fetch state and
 * receives consistent, accessible, and Chinese-localized placeholder UI.
 *
 * Delegates error rendering to `ErrorDisplay` (variant="card").
 *
 * Three inactive states:
 * - **loading** — centered spinner + customizable message
 * - **error**   — `<ErrorDisplay variant="card">` with retry
 * - **empty**   — centered icon + message (shown when state="idle" or
 *                when `isEmpty` is explicitly true)
 *
 * The **active** state (`state === "success"` and `!isEmpty`) renders
 * `children` directly — no extra wrapper div.
 */

import { RiLoader4Line } from "@remixicon/react";
import ErrorDisplay from "@/components/ui/ErrorDisplay";
import type { FetchState } from "@/lib/api/types";

// ── Props ──

export interface DataStateProps {
  /** Current fetch state. */
  state: FetchState;
  /** Error value for error state.  Passed through to `ErrorDisplay` (accepts `unknown`). */
  error?: unknown;
  /** Retry callback for error state.  Passed through to `ErrorDisplay`. */
  onRetry?: () => void;
  /** Text shown below the loading spinner.  Default: "加载中…" */
  loadingMessage?: string;
  /** Tailwind color class for the loading spinner icon.
   *  Default: "text-text-muted" */
  loadingIconClassName?: string;
  /** Remixicon component rendered in the empty/idle state.
   *  Defaults to a generic `RiLoader4Line` (muted, no spin). */
  emptyIcon?: React.ComponentType<{ className?: string }>;
  /** Message shown in the empty/idle state.  Default: "暂无数据" */
  emptyMessage?: string;
  /** When `true`, the empty state renders even if `state === "success"`.
   *  Use this for panels where zero-length data sets should display the
   *  empty placeholder rather than the success branch. */
  isEmpty?: boolean;
  /** Rendered when `state === "success"` AND `!isEmpty`. */
  children: React.ReactNode;
}

// ── Default empty icon ──

/** Fallback icon when no `emptyIcon` is provided. */
function DefaultEmptyIcon({ className }: { className?: string }) {
  return <RiLoader4Line className={className} />;
}

// ── Component ──

export default function DataState({
  state,
  error,
  onRetry,
  loadingMessage = "加载中…",
  loadingIconClassName = "text-text-muted",
  emptyIcon: EmptyIcon = DefaultEmptyIcon,
  emptyMessage = "暂无数据",
  isEmpty = false,
  children,
}: DataStateProps) {
  const showEmpty = state === "idle" || isEmpty;

  // ── Loading ──
  if (state === "loading") {
    return (
      <div
        role="status"
        aria-label={loadingMessage}
        className="flex flex-col items-center justify-center gap-gm-2 py-gm-8"
      >
        <RiLoader4Line
          className={`w-6 h-6 animate-spin ${loadingIconClassName}`}
        />
        <p className="text-gm-sm text-text-muted">{loadingMessage}</p>
      </div>
    );
  }

  // ── Error ──
  if (state === "error") {
    return <ErrorDisplay variant="card" error={error} onRetry={onRetry} />;
  }

  // ── Empty / Idle ──
  if (showEmpty) {
    return (
      <div className="flex flex-col items-center justify-center gap-gm-2 py-gm-8 text-text-muted/60">
        <EmptyIcon className="w-8 h-8" />
        <p className="text-gm-xs">{emptyMessage}</p>
      </div>
    );
  }

  // ── Success (data present) ──
  return <>{children}</>;
}
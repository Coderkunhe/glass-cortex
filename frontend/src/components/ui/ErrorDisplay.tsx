"use client";

/**
 * ErrorDisplay — unified error presentation component.
 *
 * Replaces ~20 scattered `{error}` renders with a consistent, user-friendly
 * error UI. Internally uses `categorizeError` to convert raw errors into
 * Chinese user messages, hiding English technical strings from users.
 *
 * Three variants:
 * - `card` (default): Centered card with icon, heading, message, and retry.
 *   Matches the HealthDashboard/LogViewer pattern.
 * - `inline`: Horizontal banner suitable for forms and modals.
 *   Matches the ProfileModal pattern.
 * - `fullscreen`: Fixed overlay covering the viewport.
 *   Matches the app/error.tsx pattern.
 */

import { RiErrorWarningLine, RiRefreshLine } from "@remixicon/react";
import { categorizeError } from "@/lib/errorCategories";
import type { CategorizedError, ErrorCategory } from "@/lib/errorCategories";

// ── Props ──

export interface ErrorDisplayProps {
  /** The error to display. Accepts any error shape (Error, ApiClientError,
   *  string, pre-categorized CategorizedError, or null/undefined).
   *  Internally normalized via `categorizeError()`. */
  error: unknown;
  /** If provided, a retry button/link is rendered and calls this on click. */
  onRetry?: () => void;
  /** Visual variant. Default: "card". */
  variant?: "card" | "inline" | "fullscreen";
  /** Override the default category-based heading. */
  heading?: string;
}

// ── Default headings ──

const DEFAULT_HEADINGS: Record<ErrorCategory, string> = {
  network: "网络连接失败",
  server: "服务异常",
  llm: "AI 响应异常",
  render: "渲染失败",
  client: "请求错误",
  unknown: "出错了",
};

// ── Helpers ──

/** Normalize any error input into a CategorizedError. */
function resolveError(
  err: unknown,
): CategorizedError | null {
  if (err == null) return null;
  // Already categorized — use as-is
  if (
    typeof err === "object" &&
    "category" in err &&
    "userMessage" in err
  ) {
    return err as CategorizedError;
  }
  return categorizeError(err);
}

// ── Component ──

export default function ErrorDisplay({
  error,
  onRetry,
  variant = "card",
  heading,
}: ErrorDisplayProps) {
  const cat = resolveError(error);
  if (!cat) return null;

  const displayHeading = heading ?? DEFAULT_HEADINGS[cat.category];

  // 仅在生产环境隐藏 technicalDetail，避免英文技术串泄漏给终端用户。
  // typeof guard 防止 jsdom 等无 `process` 全局的环境抛出 ReferenceError。
  const isProduction =
    typeof process !== "undefined" &&
    process.env.NODE_ENV === "production";

  switch (variant) {
    case "inline":
      return (
        <div
          role="alert"
          className="flex items-center gap-gm-2 rounded-gm-sm bg-danger/10
                     border border-danger/20 px-gm-3 py-gm-2 text-gm-sm"
        >
          <RiErrorWarningLine className="w-4 h-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <span className="font-medium text-text">{displayHeading}</span>
            <span className="text-text-secondary ml-gm-1">
              {cat.userMessage}
            </span>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-auto text-brand hover:underline text-gm-sm
                         shrink-0 transition-all
                         focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                         active:scale-[0.98] rounded-gm-xs"
            >
              重试
            </button>
          )}
        </div>
      );

    case "fullscreen":
      return (
        <div
          role="alert"
          className="fixed inset-0 flex items-center justify-center
                     bg-bg p-gm-4"
          style={{ zIndex: "var(--gm-z-nav)" }}
        >
          <div
            className="flex flex-col items-center gap-gm-4 rounded-gm-sm
                       border border-danger/30 bg-danger/5 p-gm-8 max-w-sm
                       w-full text-center"
          >
            <RiErrorWarningLine className="w-12 h-12 text-danger/80" />
            <div>
              <p className="text-gm-lg font-semibold text-text">
                {displayHeading}
              </p>
              <p className="text-gm-sm text-text-muted mt-gm-1">
                {cat.userMessage}
              </p>
              {cat.suggestion && (
                <p className="text-gm-xs text-text-muted mt-gm-2">
                  {cat.suggestion}
                </p>
              )}
            </div>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-gm-sm bg-surface-elevated border
                           border-border px-gm-4 py-gm-2 text-gm-sm text-text
                           hover:bg-surface-alt transition-all
                           focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                           active:scale-[0.98]"
              >
                <RiRefreshLine className="w-4 h-4 inline mr-gm-1_5" />
                重试
              </button>
            )}
          </div>
        </div>
      );

    case "card":
    default:
      return (
        <div
          role="alert"
          className="flex flex-col items-center gap-gm-3 rounded-gm-sm
                     border border-danger/30 bg-danger/5 p-gm-6 max-w-md
                     w-full text-center"
        >
          <RiErrorWarningLine className="w-8 h-8 text-danger" />
          <div>
            <p className="text-gm-sm font-semibold text-text">
              {displayHeading}
            </p>
            <p className="text-gm-xs text-text-muted mt-gm-1">
              {cat.userMessage}
            </p>
            {!isProduction && cat.technicalDetail && (
              <p className="text-gm-xs text-text-muted/60 mt-gm-0_5 break-all">
                {cat.technicalDetail}
              </p>
            )}
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-gm-sm bg-surface-elevated border
                         border-border px-gm-3 py-gm-1 text-gm-sm text-text
                         hover:bg-surface-alt transition-all
                         focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                         active:scale-[0.98]"
            >
              <RiRefreshLine className="w-4 h-4 inline mr-gm-1" />
              重试
            </button>
          )}
        </div>
      );
  }
}

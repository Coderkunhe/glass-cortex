/**
 * Error categorization utility.
 *
 * Provides `categorizeError` — a single function that classifies any error
 * value (raw Error, ApiClientError, string, or unknown) into a
 * `CategorizedError` with a user-friendly Chinese message, actionable
 * suggestion, and optional technical detail for debugging.
 *
 * Why: The frontend has ~20 error rendering points, each exposing raw
 * `err.message` (English technical strings) directly to users. A unified
 * categorization layer is the prerequisite for replacing all of them with a
 * consistent, user-friendly ErrorDisplay component.
 */

import { ApiClientError } from "@/lib/api/client";

// ── Public types ──

/** 错误分类键 — network/server/llm/render/unknown，供 ErrorDisplay 按类别选择 UI。 */
export type ErrorCategory = "network" | "server" | "llm" | "render" | "client" | "unknown";

export interface CategorizedError {
  /** Machine-readable category for conditional rendering. */
  category: ErrorCategory;
  /** Always Chinese, always user-friendly. Safe to display directly. */
  userMessage: string;
  /** Original error message preserved for debugging (optional). */
  technicalDetail?: string;
  /** Actionable next step for the user (optional). */
  suggestion?: string;
  /** The raw input passed to `categorizeError`. */
  originalError: unknown;
}

// ── Pattern tables ──

const NETWORK_MESSAGE_PATTERNS = [
  /fetch failed/i,
  /failed to fetch/i,
  /networkerror/i,
  /econnrefused/i,
  /enotfound/i,
];

const RENDER_MESSAGE_PATTERNS = [
  /mermaid/i,
  /render(?:ing)? error/i,
  /diagram/i,
];

const LLM_ERROR_CODES = [
  /llm_unavailable/i,
  /planner_unavailable/i,
  /model_error/i,
  /llm_error/i,
];

const NETWORK_NAMES = new Set(["AbortError", "TimeoutError"]);

// ── User-facing message tables ──

const USER_MESSAGES: Record<ErrorCategory, string> = {
  network: "网络连接失败，请检查网络后重试",
  server: "服务暂时不可用，请稍后重试",
  llm: "AI 响应失败，请稍后重试",
  render: "内容渲染失败",
  client: "请求有误",
  unknown: "出了点问题，请重试",
};

const SUGGESTIONS: Record<ErrorCategory, string> = {
  network: "请确认网络连接正常，或稍后再试",
  server: "运维团队已收到异常通知，请稍后再试",
  llm: "AI 模型暂时不可用，请稍后重试",
  render: "请刷新页面重试",
  client: "请检查输入内容后重试",
  unknown: "请刷新页面或联系技术支持",
};

// ── Helpers ──

/** Extract a string message from any error shape. */
function extractMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Check if `err` is an ApiClientError (structural duck-type fallback). */
function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

/** Return (userMessage, suggestion) for a given 4xx HTTP status. */
function clientMessagesForStatus(status: number): {
  userMessage: string;
  suggestion: string;
} {
  switch (status) {
    case 422:
      return {
        userMessage: "请求参数有误",
        suggestion: "请检查输入内容后重试",
      };
    case 404:
      return {
        userMessage: "请求的资源不存在",
        suggestion: "请刷新页面后重试",
      };
    case 429:
      return {
        userMessage: "请求过于频繁",
        suggestion: "请稍后重试",
      };
    default:
      return {
        userMessage: USER_MESSAGES.client,
        suggestion: SUGGESTIONS.client,
      };
  }
}

// ── Public API ──

/**
 * Classify any error value into a user-friendly `CategorizedError`.
 *
 * Detection order (first match wins):
 * 1. Null/undefined → unknown
 * 2. ApiClientError → checks `status >= 500` (server) or
 *    `apiError.error_code` match (llm)
 * 3. Error.name in {AbortError, TimeoutError} → network
 * 4. Error.message pattern match → network / render
 * 5. Fallback → unknown
 */
export function categorizeError(err: unknown): CategorizedError {
  // ── Null / undefined ──
  if (err == null) {
    return {
      category: "unknown",
      userMessage: USER_MESSAGES.unknown,
      suggestion: SUGGESTIONS.unknown,
      originalError: err,
    };
  }

  // ── ApiClientError ──
  // LLM errors take priority over server errors — a 500 with
  // error_code="llm_unavailable" is an LLM problem, not a server crash.
  if (isApiClientError(err)) {
    const errorCode = err.apiError.error_code ?? "";

    if (LLM_ERROR_CODES.some((p) => p.test(errorCode))) {
      return {
        category: "llm",
        userMessage: USER_MESSAGES.llm,
        technicalDetail: err.apiError.detail || err.message,
        suggestion: SUGGESTIONS.llm,
        originalError: err,
      };
    }

    if (err.status >= 500) {
      return {
        category: "server",
        userMessage: USER_MESSAGES.server,
        technicalDetail: err.apiError.detail || err.message,
        suggestion: SUGGESTIONS.server,
        originalError: err,
      };
    }

    // 4xx client errors — the request itself is invalid
    if (err.status >= 400 && err.status < 500) {
      const { userMessage, suggestion } = clientMessagesForStatus(err.status);
      return {
        category: "client",
        userMessage,
        technicalDetail: err.apiError.detail || err.message,
        suggestion,
        originalError: err,
      };
    }
  }

  // ── Extract message ──
  const message = extractMessage(err);

  // ── Name-based detection (AbortError, TimeoutError) ──
  const errorName =
    err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  if (NETWORK_NAMES.has(errorName)) {
    return {
      category: "network",
      userMessage: USER_MESSAGES.network,
      technicalDetail: message,
      suggestion: SUGGESTIONS.network,
      originalError: err,
    };
  }

  // ── Message pattern matching ──
  if (NETWORK_MESSAGE_PATTERNS.some((p) => p.test(message))) {
    return {
      category: "network",
      userMessage: USER_MESSAGES.network,
      technicalDetail: message,
      suggestion: SUGGESTIONS.network,
      originalError: err,
    };
  }

  if (RENDER_MESSAGE_PATTERNS.some((p) => p.test(message))) {
    return {
      category: "render",
      userMessage: USER_MESSAGES.render,
      technicalDetail: message,
      suggestion: SUGGESTIONS.render,
      originalError: err,
    };
  }

  // ── Fallback ──
  return {
    category: "unknown",
    userMessage: USER_MESSAGES.unknown,
    technicalDetail: message || undefined,
    suggestion: SUGGESTIONS.unknown,
    originalError: err,
  };
}

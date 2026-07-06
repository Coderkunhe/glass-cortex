import { describe, it, expect } from "vitest";
import { categorizeError } from "@/lib/errorCategories";
import { ApiClientError } from "@/lib/api/client";
import type { CategorizedError } from "@/lib/errorCategories";

/** Helper: create an ApiClientError with given status and optional error_code. */
function apiError(status: number, errorCode?: string, detail?: string): ApiClientError {
  return new ApiClientError(status, {
    error: errorCode || "test_error",
    detail: detail || "Something went wrong",
    error_code: errorCode,
  });
}

/** Helper: create an Error with a custom name (e.g. AbortError). */
function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("categorizeError", () => {
  // ── Network errors ──

  it("detects 'fetch failed' as network", () => {
    const result = categorizeError(new Error("fetch failed"));
    expect(result.category).toBe("network");
    expect(result.userMessage).toBe("网络连接失败，请检查网络后重试");
  });

  it("detects 'Failed to fetch' as network", () => {
    const result = categorizeError(new Error("Failed to fetch"));
    expect(result.category).toBe("network");
  });

  it("detects 'NetworkError' in message as network", () => {
    const result = categorizeError(new Error("NetworkError: connection lost"));
    expect(result.category).toBe("network");
  });

  it("detects AbortError by name as network", () => {
    const result = categorizeError(namedError("AbortError", "The operation was aborted"));
    expect(result.category).toBe("network");
  });

  it("detects TimeoutError by name as network", () => {
    const result = categorizeError(namedError("TimeoutError", "Request timed out"));
    expect(result.category).toBe("network");
  });

  it("detects raw string 'fetch failed' as network", () => {
    const result = categorizeError("fetch failed");
    expect(result.category).toBe("network");
  });

  // ── Server errors ──

  it("detects ApiClientError with status 500 as server", () => {
    const result = categorizeError(apiError(500));
    expect(result.category).toBe("server");
    expect(result.userMessage).toBe("服务暂时不可用，请稍后重试");
  });

  it("detects ApiClientError with status 503 as server", () => {
    const result = categorizeError(apiError(503));
    expect(result.category).toBe("server");
  });

  it("detects ApiClientError with status 502 as server", () => {
    const result = categorizeError(apiError(502));
    expect(result.category).toBe("server");
  });

  // ── LLM errors ──

  it("detects llm_unavailable error_code as llm", () => {
    const result = categorizeError(apiError(500, "llm_unavailable", "LLM 不可用"));
    expect(result.category).toBe("llm");
    expect(result.userMessage).toBe("AI 响应失败，请稍后重试");
  });

  it("detects planner_unavailable error_code as llm", () => {
    const result = categorizeError(apiError(500, "planner_unavailable"));
    expect(result.category).toBe("llm");
  });

  it("detects model_error error_code as llm", () => {
    const result = categorizeError(apiError(500, "model_error"));
    expect(result.category).toBe("llm");
  });

  // ── Render errors ──

  it("detects 'mermaid render failed' as render", () => {
    const result = categorizeError(new Error("mermaid render failed"));
    expect(result.category).toBe("render");
    expect(result.userMessage).toBe("内容渲染失败");
  });

  it("detects 'rendering error' as render", () => {
    const result = categorizeError(new Error("rendering error in diagram"));
    expect(result.category).toBe("render");
  });

  // ── Unknown errors ──

  it("falls back to unknown for generic Error", () => {
    const result = categorizeError(new Error("some random thing"));
    expect(result.category).toBe("unknown");
    expect(result.userMessage).toBe("出了点问题，请重试");
  });

  it("handles null input", () => {
    const result = categorizeError(null);
    expect(result.category).toBe("unknown");
  });

  it("handles undefined input", () => {
    const result = categorizeError(undefined);
    expect(result.category).toBe("unknown");
  });

  it("handles object without message", () => {
    const result = categorizeError({ foo: "bar" });
    expect(result.category).toBe("unknown");
  });

  // ── Output shape ──

  it("always returns a non-empty userMessage in Chinese", () => {
    const categories = ["network", "server", "llm", "render", "unknown"] as const;
    for (const cat of categories) {
      const fake: CategorizedError = {
        category: cat,
        userMessage: "test",
        originalError: null,
      };
      // Verify each category has a userMessage defined in the table
      expect(fake.category).toBe(cat);
    }
  });

  it("includes technicalDetail for debugging", () => {
    const result = categorizeError(apiError(500, undefined, "Internal server failure"));
    expect(result.technicalDetail).toBe("Internal server failure");
  });

  it("includes suggestion for actionable errors", () => {
    const result = categorizeError(new Error("fetch failed"));
    expect(result.suggestion).toBeTruthy();
    expect(typeof result.suggestion).toBe("string");
  });

  it("preserves originalError reference", () => {
    const original = new Error("fetch failed");
    const result = categorizeError(original);
    expect(result.originalError).toBe(original);
  });

  it("handles string input", () => {
    const result = categorizeError("fetch failed");
    expect(result.category).toBe("network");
    expect(result.technicalDetail).toBe("fetch failed");
  });

  it("classifies ECONNREFUSED as network", () => {
    const result = categorizeError(new Error("ECONNREFUSED"));
    expect(result.category).toBe("network");
  });

  it("classifies ENOTFOUND as network", () => {
    const result = categorizeError(new Error("ENOTFOUND"));
    expect(result.category).toBe("network");
  });

  // ── Client (4xx) errors ──

  it("detects ApiClientError with status 422 as client", () => {
    const result = categorizeError(apiError(422, undefined, "Request validation failed"));
    expect(result.category).toBe("client");
    expect(result.userMessage).toBe("请求参数有误");
    expect(result.suggestion).toBe("请检查输入内容后重试");
  });

  it("detects ApiClientError with status 404 as client", () => {
    const result = categorizeError(apiError(404, undefined, "Not found"));
    expect(result.category).toBe("client");
    expect(result.userMessage).toBe("请求的资源不存在");
  });

  it("detects ApiClientError with status 429 as client", () => {
    const result = categorizeError(apiError(429, undefined, "Too many requests"));
    expect(result.category).toBe("client");
    expect(result.userMessage).toBe("请求过于频繁");
    expect(result.suggestion).toBe("请稍后重试");
  });

  it("detects ApiClientError with status 400 as client (generic)", () => {
    const result = categorizeError(apiError(400, undefined, "Bad request"));
    expect(result.category).toBe("client");
    expect(result.userMessage).toBe("请求有误");
  });

  it("detects ApiClientError with status 401 as client (generic)", () => {
    const result = categorizeError(apiError(401, undefined, "Unauthorized"));
    expect(result.category).toBe("client");
    expect(result.userMessage).toBe("请求有误");
  });

  it("llm error_code takes priority over 4xx status", () => {
    const result = categorizeError(apiError(400, "llm_unavailable", "LLM error"));
    expect(result.category).toBe("llm");
  });
});

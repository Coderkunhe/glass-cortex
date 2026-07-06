import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ErrorDisplay from "@/components/ui/ErrorDisplay";
import { ApiClientError } from "@/lib/api/client";
import type { CategorizedError } from "@/lib/errorCategories";

afterEach(cleanup);

/** Helper: create an ApiClientError with given status and optional error_code. */
function apiError(
  status: number,
  errorCode?: string,
  detail?: string,
): ApiClientError {
  return new ApiClientError(status, {
    error: errorCode || "test_error",
    detail: detail || "Something went wrong",
    error_code: errorCode,
  });
}

describe("ErrorDisplay", () => {
  // ── Null / empty ──

  it("renders nothing when error is null", () => {
    const { container } = render(<ErrorDisplay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when error is undefined", () => {
    const { container } = render(<ErrorDisplay error={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  // ── Card variant (default) ──

  it("renders card variant with user-friendly message for raw Error", () => {
    render(<ErrorDisplay error={new Error("fetch failed")} />);
    // Should show the Chinese user message, not the raw error
    expect(
      screen.getByText("网络连接失败，请检查网络后重试"),
    ).toBeInTheDocument();
    // The technical detail may appear as secondary muted text — that's fine.
    // What matters: the primary visible message IS the Chinese userMessage.
    const detailEl = screen.queryByText("fetch failed");
    if (detailEl) {
      // If present, it must be muted/secondary, not the primary danger text
      expect(detailEl.className).toContain("text-text-muted");
    }
  });

  it("shows heading override instead of default category heading", () => {
    render(
      <ErrorDisplay
        error={new Error("fetch failed")}
        heading="自定义错误标题"
      />,
    );
    expect(screen.getByText("自定义错误标题")).toBeInTheDocument();
  });

  it("renders retry button when onRetry is provided", () => {
    render(
      <ErrorDisplay error={new Error("fetch failed")} onRetry={vi.fn()} />,
    );
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorDisplay error={new Error("fetch failed")} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("重试"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render retry button when onRetry is omitted", () => {
    render(<ErrorDisplay error={new Error("fetch failed")} />);
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
  });

  // ── Inline variant ──

  it("renders inline variant with horizontal layout", () => {
    render(
      <ErrorDisplay
        error={new Error("fetch failed")}
        variant="inline"
        onRetry={vi.fn()}
      />,
    );
    // Inline variant uses flex + items-center, not flex-col
    const container = screen.getByText("重试").closest("div");
    // The alert wrapper should have flex-row classes
    expect(container?.className).toContain("flex");
    expect(container?.className).toContain("items-center");
  });

  it("renders retry link in inline variant", () => {
    const onRetry = vi.fn();
    render(
      <ErrorDisplay
        error={new Error("fetch failed")}
        variant="inline"
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByText("重试"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // ── Fullscreen variant ──

  it("renders fullscreen variant with fixed positioning", () => {
    render(
      <ErrorDisplay
        error={new Error("fetch failed")}
        variant="fullscreen"
      />,
    );
    // Find the outermost container (role="alert" is on the fixed div)
    const container = screen.getByRole("alert");
    expect(container.className).toContain("fixed");
    expect(container.className).toContain("inset-0");
  });

  // ── Pre-categorized error ──

  it("respects pre-categorized error userMessage", () => {
    const categorized: CategorizedError = {
      category: "network",
      userMessage: "自定义用户消息",
      originalError: new Error("original"),
    };
    render(<ErrorDisplay error={categorized} />);
    expect(screen.getByText("自定义用户消息")).toBeInTheDocument();
  });

  // ── ApiClientError ──

  it("shows server error message for ApiClientError with status 503", () => {
    render(<ErrorDisplay error={apiError(503, undefined, "Backend crash")} />);
    expect(
      screen.getByText("服务暂时不可用，请稍后重试"),
    ).toBeInTheDocument();
  });

  // ── String input ──

  it("handles raw string error input", () => {
    render(<ErrorDisplay error="fetch failed" />);
    expect(
      screen.getByText("网络连接失败，请检查网络后重试"),
    ).toBeInTheDocument();
  });

  // ── technicalDetail ──

  it("renders technicalDetail as secondary muted text when present", () => {
    const categorized: CategorizedError = {
      category: "server",
      userMessage: "服务暂时不可用",
      technicalDetail: "Internal server error at /api/chat",
      originalError: null,
    };
    render(<ErrorDisplay error={categorized} />);
    expect(
      screen.getByText("Internal server error at /api/chat"),
    ).toBeInTheDocument();
  });

  // ── heading fallback ──

  it("shows category-based default heading when no heading prop", () => {
    render(<ErrorDisplay error={new Error("fetch failed")} />);
    // Default heading for "network" category
    expect(screen.getByText("网络连接失败")).toBeInTheDocument();
  });
});

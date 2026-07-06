import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CompressionLogPanel from "@/components/observability/CompressionLogPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

/** 构造 GET /metrics/compression 成功响应 */
function mockCompressionResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        session_compression_count: 3,
        session_tokens_saved: 1280,
        session_prompt_tokens: 450,
        session_completion_tokens: 120,
        historical_compression_count: 7,
        ...overrides,
      }),
  };
}

/** 构造 API 错误响应 */
function mockCompressionError() {
  return {
    ok: false,
    status: 500,
    json: () =>
      Promise.resolve({
        error: "internal",
        detail: "服务内部错误",
      }),
  };
}

function renderPanel() {
  return render(<CompressionLogPanel />);
}

describe("CompressionLogPanel", () => {
  it("shows loading spinner initially", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText("加载压缩统计…")).toBeInTheDocument();
  });

  it("renders 5 stat cards on successful fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockCompressionResponse());
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("当前会话压缩次数")).toBeInTheDocument();
    });

    expect(screen.getByText("Token 节省量")).toBeInTheDocument();
    expect(screen.getByText("压缩 Prompt 消耗")).toBeInTheDocument();
    expect(screen.getByText("压缩 Completion 消耗")).toBeInTheDocument();
    expect(screen.getByText("历史压缩次数")).toBeInTheDocument();
  });

  it("displays correct stat values from API response", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCompressionResponse({
        session_compression_count: 5,
        session_tokens_saved: 9999,
        session_prompt_tokens: 2000,
        session_completion_tokens: 500,
        historical_compression_count: 12,
      }),
    );
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    expect(screen.getByText("9,999")).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockCompressionError());
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("retry button triggers re-fetch after error", async () => {
    mockFetch.mockResolvedValueOnce(mockCompressionError());
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockCompressionResponse());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("Token 节省量")).toBeInTheDocument();
    });
  });

  it("shows refresh button", async () => {
    mockFetch.mockResolvedValueOnce(mockCompressionResponse());
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("当前会话压缩次数")).toBeInTheDocument();
    });

    const refreshBtn = screen.getByRole("button", { name: "刷新压缩统计" });
    expect(refreshBtn).toBeInTheDocument();
  });

  it("shows event log placeholder", async () => {
    mockFetch.mockResolvedValueOnce(mockCompressionResponse());
    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByText("详细压缩事件日志将在后续批次交付"),
      ).toBeInTheDocument();
    });
  });

  it("renders all-zero stats gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCompressionResponse({
        session_compression_count: 0,
        session_tokens_saved: 0,
        session_prompt_tokens: 0,
        session_completion_tokens: 0,
        historical_compression_count: 0,
      }),
    );
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("当前会话压缩次数")).toBeInTheDocument();
    });

    // All zeros should render as "0"
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(5);
  });
});

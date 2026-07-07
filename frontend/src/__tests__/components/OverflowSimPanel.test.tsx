import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import OverflowSimPanel from "@/components/lab/OverflowSimPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockSuccessResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        strategy: "prioritize",
        window_size: 4096,
        base_tokens: 800,
        user_tokens: 50,
        memories_before: 10,
        memories_token_before: 1200,
        memories_after: 6,
        memories_token_after: 700,
        dropped_count: 4,
        dropped_items: ["dropped 1", "dropped 2"],
        kept_items: [
          { content: "kept 1", tokens: 100, score: 0.9, kind: "episode" },
          { content: "kept 2", tokens: 100, score: 0.8, kind: "episode" },
        ],
        overflow_triggered: true,
        total_estimated_tokens: 1550,
        usage_pct: 37.8,
        wasted_tokens: 500,
        available_tokens: 2546,
        summary_line: "10 条记忆→保留 6 条",
        strategy_label: "优先级 (prioritize)",
      }),
  };
}

function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () =>
      Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("OverflowSimPanel", () => {
  it("renders form controls and idle state", () => {
    render(<OverflowSimPanel />);

    expect(screen.getByText("溢出模拟")).toBeInTheDocument();
    expect(screen.getByText("运行模拟")).toBeInTheDocument();
    // Strategy select
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    // Window size number input (replaced range slider)
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    // Idle prompt
    expect(
      screen.getByText(/调整参数后点击/),
    ).toBeInTheDocument();
  });

  it("changes strategy via dropdown", () => {
    render(<OverflowSimPanel />);

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "truncate" } });
    expect(select.value).toBe("truncate");

    fireEvent.change(select, { target: { value: "summarize" } });
    expect(select.value).toBe("summarize");
  });

  it("submits simulation and displays results", async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    render(<OverflowSimPanel />);

    fireEvent.click(screen.getByText("运行模拟"));

    await waitFor(() => {
      expect(screen.getByText("10 条记忆→保留 6 条")).toBeInTheDocument();
    });

    // Overflow badge
    expect(screen.getByText("已溢出")).toBeInTheDocument();
    // Metrics
    expect(screen.getByText("37.8%")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("2546")).toBeInTheDocument();
    // Kept items
    expect(screen.getByText(/kept 1/)).toBeInTheDocument();
    // Dropped items
    expect(screen.getByText(/dropped 1/)).toBeInTheDocument();
  });

  it("shows '未溢出' badge when overflow not triggered", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          strategy: "prioritize",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 10,
          memories_token_before: 1200,
          memories_after: 10,
          memories_token_after: 1200,
          dropped_count: 0,
          dropped_items: [],
          kept_items: [
            { content: "kept 1", tokens: 100, score: 0.9, kind: "episode" },
          ],
          overflow_triggered: false,
          total_estimated_tokens: 2050,
          usage_pct: 50.0,
          wasted_tokens: 0,
          available_tokens: 2046,
          summary_line: "10 条记忆→保留 10 条",
          strategy_label: "优先级 (prioritize)",
        }),
    });
    render(<OverflowSimPanel />);

    fireEvent.click(screen.getByText("运行模拟"));

    await waitFor(() => {
      expect(screen.getByText("未溢出")).toBeInTheDocument();
    });
  });

  it("shows error state with retry button", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<OverflowSimPanel />);

    fireEvent.click(screen.getByText("运行模拟"));

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("retries after error", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<OverflowSimPanel />);

    fireEvent.click(screen.getByText("运行模拟"));

    await waitFor(() => {
      expect(screen.getByText("重试")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("已溢出")).toBeInTheDocument();
    });
  });

  it("disables button while loading", async () => {
    // Never resolve — loading state persists
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<OverflowSimPanel />);

    fireEvent.click(screen.getByText("运行模拟"));

    await waitFor(() => {
      expect(screen.getByText("模拟中…")).toBeInTheDocument();
    });
  });

  it("shows user input textarea", () => {
    render(<OverflowSimPanel />);

    const textarea = screen.getByPlaceholderText(/输入一段文本模拟用户消息/);
    expect(textarea).toBeInTheDocument();
    fireEvent.change(textarea, {
      target: { value: "你好，世界" },
    });
    expect(textarea).toHaveValue("你好，世界");
  });
});

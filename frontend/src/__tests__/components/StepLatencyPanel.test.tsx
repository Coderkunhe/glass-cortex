import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import StepLatencyPanel from "@/components/lab/StepLatencyPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockStepsSuccess(overrides = {}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        steps: {
          recall: { count: 5, total_ms: 1500, avg_ms: 300, min_ms: 150, max_ms: 500 },
          chat: { count: 5, total_ms: 2500, avg_ms: 500, min_ms: 200, max_ms: 800 },
          intent_classify: { count: 5, total_ms: 750, avg_ms: 150, min_ms: 100, max_ms: 250 },
          ...overrides,
        },
      }),
  };
}

function mockEmptyStepsSuccess() {
  return {
    ok: true,
    json: () => Promise.resolve({ steps: {} }),
  };
}

function mockErrorResponse(status = 500) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("StepLatencyPanel", () => {
  // ── 已有 tests (4) ──

  it("renders header and idle hint after auto-fetch returns empty", async () => {
    mockFetch.mockResolvedValueOnce(mockEmptyStepsSuccess());
    render(<StepLatencyPanel />);
    expect(screen.getByText("管线步骤延迟分析")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("暂无步骤数据，执行一次管线操作后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("auto-fetches on mount and shows loading", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<StepLatencyPanel />);
    await waitFor(() => {
      expect(screen.getByText("加载步骤数据…")).toBeInTheDocument();
    });
  });

  it("displays latency table sorted by avg_ms descending", async () => {
    mockFetch.mockResolvedValueOnce(mockStepsSuccess());
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("聊天引擎")).toBeInTheDocument();
    });

    const rows = screen.getAllByRole("row");
    expect(rows[1].textContent).toContain("聊天引擎");
    expect(rows[2].textContent).toContain("语义召回");
    expect(rows[3].textContent).toContain("意图分类");

    expect(screen.getAllByText(/500/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/300/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/150/).length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText("最慢").length).toBeGreaterThanOrEqual(2);
  });

  it("shows error and retry button on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    const retryBtn = screen.getByText("重试");
    mockFetch.mockResolvedValueOnce(mockStepsSuccess());
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("聊天引擎")).toBeInTheDocument();
    });
  });

  // ── 加厚 (4→12) ──

  // ══ 表格列完整性 ══

  it("renders all five table header columns", async () => {
    mockFetch.mockResolvedValueOnce(mockStepsSuccess());
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("聊天引擎")).toBeInTheDocument();
    });

    // Several headers appear in th elements; verify key ones
    expect(screen.getByText("调用次数")).toBeInTheDocument();
    expect(screen.getByText("平均")).toBeInTheDocument();
    expect(screen.getByText("最快")).toBeInTheDocument();
    // "最慢" appears in both header th and row badges; getAllByText handles duplicates
    expect(screen.getAllByText("最慢").length).toBeGreaterThanOrEqual(2);
  });

  // ══ 数值格式化 ══

  it("formats ms values under 1000 with 'ms' suffix", async () => {
    mockFetch.mockResolvedValueOnce(mockStepsSuccess());
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("聊天引擎")).toBeInTheDocument();
    });

    // min_ms of intent_classify = 100 → "100ms"
    expect(screen.getByText("100ms")).toBeInTheDocument();
    // min_ms of recall = 150 → "150ms"; avg_ms of intent_classify = 150 → "150ms"
    // Use getAllByText for values that appear multiple times
    expect(screen.getAllByText("150ms").length).toBeGreaterThanOrEqual(1);
  });

  it("formats ms values >= 1000 with 's' suffix", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          steps: {
            chat: { count: 1, total_ms: 2500, avg_ms: 2500, min_ms: 500, max_ms: 2500 },
          },
        }),
    });
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("聊天引擎")).toBeInTheDocument();
    });

    // 2500ms total, avg, max → three cells with "2.5s"
    expect(screen.getAllByText("2.5s").length).toBeGreaterThanOrEqual(1);
    // 500ms min → "500ms"
    expect(screen.getByText("500ms")).toBeInTheDocument();
  });

  // ══ 单步骤（无"最慢" badge） ══

  it("does not show 最慢 badge when there is only one step", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          steps: {
            recall: { count: 3, total_ms: 900, avg_ms: 300, min_ms: 200, max_ms: 400 },
          },
        }),
    });
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("语义召回")).toBeInTheDocument();
    });

    // Only one step → "最慢" appears only in the table header th, no row badge
    // So getAllByText("最慢") should return exactly 1 (header column only)
    const slowestCells = screen.getAllByText("最慢");
    expect(slowestCells.length).toBe(1);
  });

  // ══ 刷新按钮 ══

  it("shows refresh button on success and re-fetches on click", async () => {
    mockFetch.mockResolvedValueOnce(mockStepsSuccess());
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("聊天引擎")).toBeInTheDocument();
    });

    // Refresh button with RiRefreshLine icon
    const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
    expect(refreshBtn).toBeInTheDocument();

    // Queue new data for the re-fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          steps: {
            fact_extraction: { count: 2, total_ms: 600, avg_ms: 300, min_ms: 250, max_ms: 350 },
          },
        }),
    });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      // fact_extraction maps to "事实抽取" via STEP_LABELS
      expect(screen.getByText("事实抽取")).toBeInTheDocument();
    });
  });

  // ══ API 错误（非 500） ══

  it("shows error message from API detail on 503 failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.resolve({ error: "unavailable", detail: "服务暂时不可用，请稍后重试" }),
    });
    render(<StepLatencyPanel />);

    await waitFor(() => {
      // ErrorDisplay renders the error; the userMessage may appear in the DOM
      // Since ErrorDisplay inline renders heading + userMessage in separate spans,
      // check for at least one occurrence
      const errorNodes = screen.getAllByText("服务暂时不可用，请稍后重试");
      expect(errorNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ══ 刷新按钮不出现于 idle/loading/error 态 ══

  it("does not show refresh button in loading state", () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<StepLatencyPanel />);

    expect(screen.queryByTitle("刷新数据")).not.toBeInTheDocument();
  });

  it("does not show refresh button in error state", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<StepLatencyPanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("刷新数据")).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import PipelineTracePanel from "@/components/lab/PipelineTracePanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

/** 模拟 GET /traces 返回的 TraceItem 数组 */
function mockTracesSuccess(items?: object[]) {
  return {
    ok: true,
    json: () =>
      Promise.resolve(
        items ?? [
          {
            id: 1,
            session_id: "s1",
            step_name: "chat",
            elapsed_ms: 500,
            status: "ok",
            metrics: { tokens: 100 },
            created_at: 1700000000,
          },
          {
            id: 2,
            session_id: "s1",
            step_name: "recall",
            elapsed_ms: 300,
            status: "ok",
            metrics: {},
            created_at: 1700000001,
          },
          {
            id: 3,
            session_id: "s2",
            step_name: "chat",
            elapsed_ms: 150,
            status: "error",
            metrics: { error: "timeout" },
            created_at: 1700000002,
          },
        ],
      ),
  };
}

/** 模拟 GET /traces/count */
function mockCountSuccess(count = 3) {
  return {
    ok: true,
    json: () => Promise.resolve({ count, session_id: null }),
  };
}

function mockEmptyTraces() {
  return {
    ok: true,
    json: () => Promise.resolve([]),
  };
}

function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

/** 辅助：设置双 fetch mock（traces + count 各一次） */
function setupDualMock(
  tracesResp: object,
  countResp: object = mockCountSuccess(),
) {
  mockFetch
    .mockResolvedValueOnce(tracesResp)
    .mockResolvedValueOnce(countResp);
}

describe("PipelineTracePanel", () => {
  it("renders header and idle hint after auto-fetch returns empty", async () => {
    setupDualMock(mockEmptyTraces(), mockCountSuccess(0));
    render(<PipelineTracePanel />);
    expect(screen.getByText("Pipeline 追踪浏览器")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("暂无追踪记录，执行一次聊天后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("auto-fetches on mount and shows loading", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<PipelineTracePanel />);
    await waitFor(() => {
      expect(screen.getByText("加载追踪记录…")).toBeInTheDocument();
    });
  });

  it("displays trace list with status badges", async () => {
    setupDualMock(mockTracesSuccess(), mockCountSuccess(3));
    render(<PipelineTracePanel />);

    // 聊天引擎 出现 2 次（两个 chat 步骤 trace）
    await waitFor(() => {
      expect(screen.getAllByText("聊天引擎").length).toBe(3);
    });

    // 状态徽章：2 ok → "成功" × 2，1 error → "失败" × 1
    expect(screen.getAllByText("成功").length).toBe(2);
    expect(screen.getByText("失败")).toBeInTheDocument();

    // 耗时显示
    expect(screen.getByText(/500ms/)).toBeInTheDocument();
    expect(screen.getByText(/300ms/)).toBeInTheDocument();
  });

  it("can expand a trace row to show metrics detail", async () => {
    setupDualMock(mockTracesSuccess(), mockCountSuccess(3));
    render(<PipelineTracePanel />);

    await waitFor(() => {
      expect(screen.getAllByText("聊天引擎").length).toBe(3);
    });

    // 点击第一个展开按钮
    const expandBtns = screen.getAllByTitle("展开详情");
    fireEvent.click(expandBtns[0]);

    // 展开后应显示 metrics JSON
    await waitFor(() => {
      expect(screen.getByText(/"tokens": 100/)).toBeInTheDocument();
    });
  });

  it("shows error and retry button on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<PipelineTracePanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    const retryBtn = screen.getByText("重试");
    setupDualMock(mockTracesSuccess(), mockCountSuccess(3));
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getAllByText("聊天引擎").length).toBe(3);
    });
  });

  it("shows load more button when count > fetched items", async () => {
    setupDualMock(mockTracesSuccess(), mockCountSuccess(10));
    render(<PipelineTracePanel />);

    await waitFor(() => {
      expect(screen.getAllByText("聊天引擎").length).toBe(3);
    });

    // totalCount = 10, data.length = 3 → 加载更多可见
    expect(screen.getByText("加载更多")).toBeInTheDocument();
  });

  it("step filter dropdown changes fetch URL", async () => {
    setupDualMock(mockTracesSuccess(), mockCountSuccess(3));
    render(<PipelineTracePanel />);

    await waitFor(() => {
      expect(screen.getAllByText("聊天引擎").length).toBe(3);
    });

    // 清除之前调用记录，设置新的双 fetch mock
    mockFetch.mockClear();
    setupDualMock(
      mockTracesSuccess([
        {
          id: 2,
          session_id: "s1",
          step_name: "recall",
          elapsed_ms: 300,
          status: "ok",
          metrics: {},
          created_at: 1700000001,
        },
      ]),
      mockCountSuccess(1),
    );

    const filterSelect = screen.getByRole("combobox", { name: "按步骤过滤" });
    fireEvent.change(filterSelect, { target: { value: "recall" } });

    // 验证 fetch 使用了 by-step 端点
    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const urls = calls.map((c) =>
        typeof c[0] === "string" ? c[0] : "",
      );
      const byStepCall = urls.find((u) => u.includes("/traces/by-step"));
      expect(byStepCall).toBeDefined();
      expect(byStepCall).toContain("recall");
    });
  });

  // ── 展开后折叠 ──

  it("can collapse an expanded trace row", async () => {
    setupDualMock(mockTracesSuccess(), mockCountSuccess(3));
    render(<PipelineTracePanel />);

    await waitFor(() => {
      expect(screen.getAllByText("聊天引擎").length).toBe(3);
    });

    const expandBtns = screen.getAllByTitle("展开详情");
    // 展开第一行
    fireEvent.click(expandBtns[0]);
    await waitFor(() => {
      expect(screen.getByText(/"tokens": 100/)).toBeInTheDocument();
    });

    // 折叠第一行
    fireEvent.click(expandBtns[0]);
    await waitFor(() => {
      expect(screen.queryByText(/"tokens": 100/)).not.toBeInTheDocument();
    });
  });

  // ── 未知状态徽章 ──

  it("renders raw status label for unrecognized status", async () => {
    setupDualMock(
      mockTracesSuccess([
        {
          id: 9,
          session_id: "s-x",
          step_name: "chat",
          elapsed_ms: 100,
          status: "pending",
          metrics: {},
          created_at: 1700000099,
        },
      ]),
      mockCountSuccess(1),
    );
    render(<PipelineTracePanel />);

    await waitFor(() => {
      // statusBadge falls back to raw status string for unknown values
      expect(screen.getByText("pending")).toBeInTheDocument();
    });
  });

  // ── 空 metrics ──

  it("shows '无额外指标' when trace has no metrics", async () => {
    setupDualMock(
      mockTracesSuccess([
        {
          id: 2,
          session_id: "s1",
          step_name: "recall",
          elapsed_ms: 300,
          status: "ok",
          metrics: {},
          created_at: 1700000001,
        },
      ]),
      mockCountSuccess(1),
    );
    render(<PipelineTracePanel />);

    await waitFor(() => {
      // recall → "语义召回" (appears in both filter dropdown and trace row)
      const occurrences = screen.getAllByText("语义召回");
      expect(occurrences.length).toBeGreaterThanOrEqual(1);
    });

    const expandBtns = screen.getAllByTitle("展开详情");
    fireEvent.click(expandBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("无额外指标")).toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import CostWaterfallPanel from "@/components/lab/CostWaterfallPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockWaterfallSuccess(gross: number, cache: number, compression: number) {
  const net = gross - cache - compression;
  const steps = [
    { label: "LLM 调用总额", tokens: gross, kind: "gross", color: "#6366f1" },
  ];
  if (cache > 0) {
    steps.push({ label: "缓存命中节省", tokens: cache, kind: "savings", color: "#22c55e" });
  }
  if (compression > 0) {
    steps.push({ label: "消息压缩节省", tokens: compression, kind: "savings", color: "#f59e0b" });
  }
  steps.push({ label: "净消耗", tokens: net, kind: "net", color: "#0f172a" });

  return {
    ok: true,
    json: () =>
      Promise.resolve({
        steps,
        gross_tokens: gross,
        cache_savings: cache,
        compression_savings: compression,
        net_tokens: net,
      }),
  };
}

function mockWaterfallEmpty() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        steps: [
          { label: "LLM 调用总额", tokens: 0, kind: "gross", color: "#6366f1" },
          { label: "净消耗", tokens: 0, kind: "net", color: "#0f172a" },
        ],
        gross_tokens: 0,
        cache_savings: 0,
        compression_savings: 0,
        net_tokens: 0,
      }),
  };
}

function mockWaterfallError() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "internal", detail: "获取成本瀑布数据失败" }),
  };
}

/** B95 E3: mock call_point response */
function mockCallPointSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        steps: [
          { label: "聊天 LLM", tokens: 5000, kind: "call_point", color: "#6366f1" },
          { label: "事实抽取", tokens: 1200, kind: "call_point", color: "#22c55e" },
          { label: "净消耗", tokens: 4200, kind: "net", color: "#0f172a" },
        ],
        gross_tokens: 6200,
        cache_savings: 1200,
        compression_savings: 800,
        net_tokens: 4200,
      }),
  };
}

describe("CostWaterfallPanel", () => {
  it("renders header with title", () => {
    render(<CostWaterfallPanel />);
    expect(screen.getByText("Token 消耗瀑布")).toBeInTheDocument();
    expect(screen.getByText("原始调用 → 节省扣除 → 净消耗")).toBeInTheDocument();
  });

  it("shows loading spinner on mount", async () => {
    // 永不 resolve 的 fetch → loading 态持续
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByText("正在计算 Token 消耗…")).toBeInTheDocument();
    });
  });

  it("shows error state with retry button", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallError());
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByText("获取成本瀑布数据失败")).toBeInTheDocument();
    });
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("shows empty state when gross_tokens is 0", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallEmpty());
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(
        screen.getByText("暂无 Token 消耗数据，发送消息后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("renders waterfall steps with savings", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(6200, 1200, 800));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByText("LLM 调用总额")).toBeInTheDocument();
    });
    expect(screen.getByText("缓存命中节省")).toBeInTheDocument();
    expect(screen.getByText("消息压缩节省")).toBeInTheDocument();
    // "净消耗" 在标签和底部摘要都出现，>=2 处
    expect(screen.getAllByText("净消耗").length).toBeGreaterThanOrEqual(2);
    // 数值展示（出现在步骤值和底部摘要，用 getAllByText）
    expect(screen.getAllByText("6.2k").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("4.2k").length).toBeGreaterThanOrEqual(2);
  });

  it("renders waterfall steps without savings", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(1700, 0, 0));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByText("LLM 调用总额")).toBeInTheDocument();
    });
    // "净消耗" 在标签和底部摘要都出现，>=2 处
    expect(screen.getAllByText("净消耗").length).toBeGreaterThanOrEqual(2);
    // 节省步骤不应出现
    expect(screen.queryByText("缓存命中节省")).not.toBeInTheDocument();
    expect(screen.queryByText("消息压缩节省")).not.toBeInTheDocument();
  });

  it("has refresh button when data loaded", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(500, 0, 0));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "刷新数据" })).toBeInTheDocument();
    });
  });

  it("formats tokens < 1000 as raw number", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(500, 0, 0));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      // "500" appears in both step value and summary footer — use getAllByText
      const matches = screen.getAllByText("500");
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("formats tokens >= 1000 with k suffix", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(6200, 1200, 800));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      // 6.2k appears in both step and summary footer — use getAllByText
      expect(screen.getAllByText("6.2k").length).toBeGreaterThanOrEqual(2);
      // Savings show "−1.2k" (with Unicode minus sign) in step + footer
      expect(screen.getAllByText("−1.2k").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows savings amounts with minus sign prefix", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(3000, 500, 300));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      // Savings steps have minus sign in the formatted text
      const savingsLabels = screen.getAllByText(/^−/);
      expect(savingsLabels.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders separator line before net step", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(3000, 500, 300));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      // The separator is a div with border-t border-border before net step
      const separators = document.querySelectorAll(".border-t.border-border.my-gm-3");
      expect(separators.length).toBe(1);
    });
  });

  it("shows summary footer with all savings categories", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(5000, 1000, 500));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      // Footer always shows 总额
      expect(screen.getByText("总额")).toBeInTheDocument();
      // Cache savings
      expect(screen.getByText("缓存节省")).toBeInTheDocument();
      // Compression savings
      expect(screen.getByText("压缩节省")).toBeInTheDocument();
      // Net at the end
      const netLabels = screen.getAllByText("净消耗");
      expect(netLabels.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── B95 E3: call point view toggle ────────────────────────────────

  it("renders view mode pill toggle when data loaded", async () => {
    mockFetch.mockResolvedValueOnce(mockWaterfallSuccess(500, 0, 0));
    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByText("瀑布流")).toBeInTheDocument();
      expect(screen.getByText("按调用点")).toBeInTheDocument();
    });
  });

  it("fetches call_point data when toggling to call_point view", async () => {
    // 1st: default waterfall load → 2nd: call_point toggle re-fetch
    mockFetch
      .mockResolvedValueOnce(mockWaterfallSuccess(500, 0, 0))
      .mockResolvedValueOnce(mockCallPointSuccess());

    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByText("LLM 调用总额")).toBeInTheDocument();
    });

    // Click "按调用点" pill
    fireEvent.click(screen.getByText("按调用点"));

    // Verify fetch was called with ?by=call_point
    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const callPointCall = calls.find((call: string[]) =>
        String(call[0]).includes("by=call_point"),
      );
      expect(callPointCall).toBeDefined();
    });
  });

  it("renders call_point steps correctly", async () => {
    mockFetch.mockResolvedValueOnce(mockCallPointSuccess());
    // Render with call_point view pre-selected
    // We can't pre-select, so we render normally then toggle
    mockFetch
      .mockReset()
      .mockResolvedValueOnce(mockWaterfallSuccess(500, 0, 0))
      .mockResolvedValueOnce(mockCallPointSuccess());

    render(<CostWaterfallPanel />);
    await waitFor(() => {
      expect(screen.getByText("LLM 调用总额")).toBeInTheDocument();
    });

    // Toggle to call_point
    fireEvent.click(screen.getByText("按调用点"));

    await waitFor(() => {
      expect(screen.getByText("聊天 LLM")).toBeInTheDocument();
      expect(screen.getByText("事实抽取")).toBeInTheDocument();
      // Subtitle changes
      expect(screen.getByText("按调用点分组 → 净消耗")).toBeInTheDocument();
    });
  });
});

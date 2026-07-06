import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import OverflowSandboxPanel from "@/components/lab/OverflowSandboxPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

/** 三种策略对比成功响应 — 预设"日常对话"6 条在 4096 窗口下大多保留，少量丢弃。 */
function mockSuccessResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        truncate: {
          strategy: "truncate",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 6,
          memories_token_before: 1200,
          memories_after: 4,
          memories_token_after: 800,
          dropped_count: 2,
          dropped_items: ["上周看的电影特效", "邻居家的狗每天早上"],
          kept_items: [
            { content: "- [强度: 0.95] 用户想买台新电脑，预算 8000 左右", tokens: 95, score: 0.95, kind: "episode" },
            { content: "- [强度: 0.80] 这周末打算和女朋友去爬山", tokens: 80, score: 0.80, kind: "episode" },
            { content: "- [置信度: 0.85] 用户是后端开发，工作 5 年了", tokens: 85, score: 0.85, kind: "fact" },
            { content: "- [强度: 0.30] 昨天吃了顿火锅，觉得味道一般", tokens: 30, score: 0.30, kind: "episode" },
          ],
          overflow_triggered: true,
          total_estimated_tokens: 1650,
          usage_pct: 40.3,
          wasted_tokens: 400,
          available_tokens: 2846,
          summary_line: "6 条记忆→保留 4 条",
          strategy_label: "截断 (truncate)",
        },
        prioritize: {
          strategy: "prioritize",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 6,
          memories_token_before: 1200,
          memories_after: 3,
          memories_token_after: 600,
          dropped_count: 3,
          dropped_items: ["昨天吃了顿火锅", "上周看的电影特效", "邻居家的狗每天早上"],
          kept_items: [
            { content: "- [强度: 0.95] 用户想买台新电脑，预算 8000 左右", tokens: 95, score: 0.95, kind: "episode" },
            { content: "- [强度: 0.85] 用户是后端开发，工作 5 年了", tokens: 85, score: 0.85, kind: "fact" },
            { content: "- [强度: 0.80] 这周末打算和女朋友去爬山", tokens: 80, score: 0.80, kind: "episode" },
          ],
          overflow_triggered: true,
          total_estimated_tokens: 1450,
          usage_pct: 35.4,
          wasted_tokens: 550,
          available_tokens: 2846,
          summary_line: "6 条→保留 3 条高分",
          strategy_label: "优先级 (prioritize)",
        },
        summarize: {
          strategy: "summarize",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 6,
          memories_token_before: 1200,
          memories_after: 4,
          memories_token_after: 650,
          dropped_count: 3,
          dropped_items: ["昨天吃了顿火锅", "上周看的电影特效", "邻居家的狗每天早上"],
          kept_items: [
            { content: "- [强度: 0.95] 用户想买台新电脑，预算 8000 左右", tokens: 95, score: 0.95, kind: "episode" },
            { content: "- [强度: 0.85] 用户是后端开发，工作 5 年了", tokens: 85, score: 0.85, kind: "fact" },
            { content: "- [强度: 0.80] 这周末打算和女朋友去爬山", tokens: 80, score: 0.80, kind: "episode" },
            { content: "[已压缩] 还有 3 条相关记忆：昨天吃了顿火锅、上周看的电影特效、邻居家的狗每天早上", tokens: 120, score: 0.0, kind: "summary" },
          ],
          overflow_triggered: true,
          total_estimated_tokens: 1500,
          usage_pct: 36.6,
          wasted_tokens: 350,
          available_tokens: 2846,
          summary_line: "6 条→4 组摘要",
          strategy_label: "摘要 (summarize)",
        },
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

describe("OverflowSandboxPanel", () => {
  it("renders header and preset selector", () => {
    render(<OverflowSandboxPanel />);

    expect(screen.getByText("溢出策略沙箱")).toBeInTheDocument();
    expect(screen.getByText("日常对话")).toBeInTheDocument();
    expect(screen.getByText("事实密集")).toBeInTheDocument();
    expect(screen.getByText("长尾低分")).toBeInTheDocument();
    expect(screen.getByText("混合内容")).toBeInTheDocument();
  });

  it("shows preset description for default preset", () => {
    render(<OverflowSandboxPanel />);

    expect(
      screen.getByText("相关度参差不齐的日常聊天记忆"),
    ).toBeInTheDocument();
  });

  it("shows memory items for the selected preset", () => {
    render(<OverflowSandboxPanel />);

    // 日常对话有 6 条
    expect(screen.getByText("记忆数据（6 条）")).toBeInTheDocument();
    expect(screen.getByText("用户想买台新电脑，预算 8000 左右")).toBeInTheDocument();
  });

  it("switches preset on button click", () => {
    render(<OverflowSandboxPanel />);

    // Click 事实密集 preset
    fireEvent.click(screen.getByText("事实密集"));

    expect(screen.getByText("记忆数据（8 条）")).toBeInTheDocument();
    expect(
      screen.getByText("全部高置信度的事实陈述，窗口无法全容纳"),
    ).toBeInTheDocument();
    // Should see a fact from the 事实密集 preset
    expect(screen.getByText("用户居住在上海市浦东新区")).toBeInTheDocument();
  });

  it("switching preset resets results", () => {
    render(<OverflowSandboxPanel />);

    // 先在默认预设下跑一次
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    fireEvent.click(screen.getByText("运行对比"));

    // 切到另一个预设 → 结果应清空
    fireEvent.click(screen.getByText("长尾低分"));

    // Idle 提示应该重新出现
    expect(
      screen.getByText("选择预设数据后点击「运行对比」查看三种策略的差异"),
    ).toBeInTheDocument();
  });

  it("runs comparison and shows results matrix with per-item status", async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    render(<OverflowSandboxPanel />);

    fireEvent.click(screen.getByText("运行对比"));

    // Wait for results
    await waitFor(() => {
      expect(screen.getByText("逐条对比")).toBeInTheDocument();
    });

    // Strategy column headers (appear in both table head and summary cards)
    expect(screen.getAllByText("FIFO 截断").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("相关度优先").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("压缩摘要").length).toBeGreaterThanOrEqual(1);

    // Summary cards section
    expect(screen.getByText("策略指标对比")).toBeInTheDocument();

    // Key metrics from the mock data
    expect(screen.getByText("40.3%")).toBeInTheDocument();
    expect(screen.getByText("35.4%")).toBeInTheDocument();
    expect(screen.getByText("36.6%")).toBeInTheDocument();

    // Teaching note
    expect(screen.getByText(/💡 关键观察/)).toBeInTheDocument();
  });

  it("shows overflow/not-overflow badges per strategy", async () => {
    // Use a response where one strategy doesn't overflow
    const data = await mockSuccessResponse().json();
    data.prioritize.overflow_triggered = false;
    data.prioritize.memories_after = 6;
    data.prioritize.dropped_count = 0;
    data.prioritize.dropped_items = [];

    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(data) });
    render(<OverflowSandboxPanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      // FIFO 截断 overflowed
      const overflowBadges = screen.getAllByText("溢出");
      expect(overflowBadges.length).toBeGreaterThanOrEqual(1);

      // 相关度优先 not overflowed
      expect(screen.getByText("未溢出")).toBeInTheDocument();
    });
  });

  it("shows error state with retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<OverflowSandboxPanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("retries after error", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<OverflowSandboxPanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      expect(screen.getByText("重试")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("逐条对比")).toBeInTheDocument();
    });
  });

  it("shows loading state", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<OverflowSandboxPanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      expect(screen.getByText("对比中…")).toBeInTheDocument();
    });
  });

  it("updates window size via slider", () => {
    render(<OverflowSandboxPanel />);

    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "2048" } });

    expect(screen.getByText(/2048 tokens/)).toBeInTheDocument();
  });

  it("allows user input via textarea", () => {
    render(<OverflowSandboxPanel />);

    const textarea = screen.getByPlaceholderText(
      "输入一段文本模拟用户消息…",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "今天天气不错" } });
    expect(textarea).toHaveValue("今天天气不错");
  });
});

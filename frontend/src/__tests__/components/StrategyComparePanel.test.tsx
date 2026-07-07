import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import StrategyComparePanel from "@/components/lab/StrategyComparePanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

/** 策略人格 mock（getStrategyPersonas 返回） */
function mockPersonasResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        personas: [
          {
            id: "truncate",
            name: "守门员",
            subtitle: "严格截断",
            icon: "shield",
            description: "像守门员一样守卫上下文边界",
            color: "#4f9ed4",
          },
          {
            id: "prioritize",
            name: "策展人",
            subtitle: "优先级排序",
            icon: "sort",
            description: "像策展人一样挑选最重要的记忆",
            color: "#4caf50",
          },
          {
            id: "summarize",
            name: "口述史官",
            subtitle: "摘要压缩",
            icon: "quill",
            description: "像口述史官一样提炼核心叙事",
            color: "#ff9800",
          },
        ],
      }),
  };
}

/** 三种策略对比结果 mock — prioritize 浪费最少 (best) */
function mockCompareSuccessResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        truncate: {
          strategy: "truncate",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 12,
          memories_token_before: 1500,
          memories_after: 5,
          memories_token_after: 600,
          dropped_count: 7,
          dropped_items: ["旧记忆 1", "旧记忆 2"],
          kept_items: [
            { content: "最近记忆 1", tokens: 120, score: 0.9, kind: "episode" },
            { content: "最近记忆 2", tokens: 120, score: 0.85, kind: "episode" },
          ],
          overflow_triggered: true,
          total_estimated_tokens: 1450,
          usage_pct: 35.4,
          wasted_tokens: 800,
          available_tokens: 2646,
          summary_line: "12 条→保留 5 条，丢弃 7 条旧记忆",
          strategy_label: "截断 (truncate)",
        },
        prioritize: {
          strategy: "prioritize",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 12,
          memories_token_before: 1500,
          memories_after: 8,
          memories_token_after: 1000,
          dropped_count: 4,
          dropped_items: ["低分记忆 1"],
          kept_items: [
            { content: "高分记忆 1", tokens: 125, score: 0.95, kind: "episode" },
            { content: "高分记忆 2", tokens: 125, score: 0.9, kind: "episode" },
          ],
          overflow_triggered: false,
          total_estimated_tokens: 1850,
          usage_pct: 45.2,
          wasted_tokens: 200,
          available_tokens: 2246,
          summary_line: "12 条→保留 8 条高分记忆",
          strategy_label: "优先级 (prioritize)",
        },
        summarize: {
          strategy: "summarize",
          window_size: 4096,
          base_tokens: 800,
          user_tokens: 50,
          memories_before: 12,
          memories_token_before: 1500,
          memories_after: 3,
          memories_token_after: 400,
          dropped_count: 9,
          dropped_items: ["长文本记忆 1", "长文本记忆 2"],
          kept_items: [
            { content: "摘要 1", tokens: 130, score: 0.85, kind: "episode" },
          ],
          overflow_triggered: true,
          total_estimated_tokens: 1250,
          usage_pct: 30.5,
          wasted_tokens: 1000,
          available_tokens: 2846,
          summary_line: "12 条→3 组摘要，丢弃 9 条长文本",
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

describe("StrategyComparePanel", () => {
  it("renders header and form controls with idle state", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    render(<StrategyComparePanel />);

    // Header
    expect(screen.getByText("策略对比")).toBeInTheDocument();
    expect(
      screen.getByText("同一输入 → 三种策略并排对比"),
    ).toBeInTheDocument();

    // Run button
    expect(screen.getByText("运行对比")).toBeInTheDocument();

    // Window size number input (replaced range slider)
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();

    // Textarea
    expect(
      screen.getByPlaceholderText("输入一段文本模拟用户消息…"),
    ).toBeInTheDocument();

    // Idle prompt
    await waitFor(() => {
      expect(
        screen.getByText("调整参数后点击「运行对比」查看三种策略效果"),
      ).toBeInTheDocument();
    });
  });

  it("submits comparison and displays three strategy columns", async () => {
    // First call: getStrategyPersonas on mount
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    // Second call: compareStrategies on button click
    mockFetch.mockResolvedValueOnce(mockCompareSuccessResponse());

    render(<StrategyComparePanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      // Each strategy's summary_line appears
      expect(screen.getByText("12 条→保留 5 条，丢弃 7 条旧记忆")).toBeInTheDocument();
      expect(screen.getByText("12 条→保留 8 条高分记忆")).toBeInTheDocument();
      expect(screen.getByText("12 条→3 组摘要，丢弃 9 条长文本")).toBeInTheDocument();
    });

    // Metrics displayed — usage %
    expect(screen.getByText("35.4%")).toBeInTheDocument();
    expect(screen.getByText("45.2%")).toBeInTheDocument();
    expect(screen.getByText("30.5%")).toBeInTheDocument();

    // wasted tokens
    expect(screen.getByText("800")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();

    // memories before→after
    expect(screen.getAllByText("12 → 5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("12 → 8").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("12 → 3").length).toBeGreaterThanOrEqual(1);
  });

  it("highlights best strategy with 推荐 badge", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    mockFetch.mockResolvedValueOnce(mockCompareSuccessResponse());

    render(<StrategyComparePanel />);

    fireEvent.click(screen.getByText("运行对比"));

    // prioritize has wasted_tokens=200 (min), so it should be recommended
    await waitFor(() => {
      expect(screen.getByText("推荐")).toBeInTheDocument();
    });
  });

  it("displays persona data (name, subtitle, description) after mount", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());

    render(<StrategyComparePanel />);

    // Persona data should be fetched on mount and available
    // But personas only show after compareStrategies success (they're rendered inside success state)
    // So we first need to trigger the comparison to see personas
    mockFetch.mockResolvedValueOnce(mockCompareSuccessResponse());

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      // Persona names
      expect(screen.getByText("守门员")).toBeInTheDocument();
      expect(screen.getByText("策展人")).toBeInTheDocument();
      expect(screen.getByText("口述史官")).toBeInTheDocument();

      // Persona subtitles
      expect(screen.getByText("严格截断")).toBeInTheDocument();
      expect(screen.getByText("优先级排序")).toBeInTheDocument();
      expect(screen.getByText("摘要压缩")).toBeInTheDocument();

      // Persona descriptions
      expect(
        screen.getByText("像守门员一样守卫上下文边界"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("像策展人一样挑选最重要的记忆"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("像口述史官一样提炼核心叙事"),
      ).toBeInTheDocument();
    });
  });

  it("shows overflow triggered/not-triggered icons per strategy", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    mockFetch.mockResolvedValueOnce(mockCompareSuccessResponse());

    render(<StrategyComparePanel />);

    fireEvent.click(screen.getByText("运行对比"));

    // Wait for success render
    await waitFor(() => {
      expect(screen.getByText("推荐")).toBeInTheDocument();
    });

    // prioritize has overflow_triggered: false → RiCheckLine should appear (success icon)
    // truncate and summarize have overflow_triggered: true → RiCloseLine should appear (danger icon)
    // These are Remixicon SVGs with class names; we verify by checking the
    // text content layout which shows the overflow row label
    const overflowLabels = screen.getAllByText("溢出");
    expect(overflowLabels.length).toBe(3); // one per strategy column
  });

  it("shows error state with retry button on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    // Second call fails
    mockFetch.mockResolvedValueOnce(mockErrorResponse());

    render(<StrategyComparePanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("retries after error and succeeds", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    // First compareStrategies fails
    mockFetch.mockResolvedValueOnce(mockErrorResponse());

    render(<StrategyComparePanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      expect(screen.getByText("重试")).toBeInTheDocument();
    });

    // Retry: need personas again (useEffect won't re-fire) + compareStrategies
    // The retry button calls fetchCompare directly
    mockFetch.mockResolvedValueOnce(mockCompareSuccessResponse());

    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("推荐")).toBeInTheDocument();
    });
  });

  it("disables button and shows loading while comparing", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    // Never resolve — loading persists
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));

    render(<StrategyComparePanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      expect(screen.getByText("对比中…")).toBeInTheDocument();
    });

    // Verify the button text changed (loading state)
    expect(screen.queryByText("运行对比")).not.toBeInTheDocument();
  });

  it("updates window size via number input", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    render(<StrategyComparePanel />);

    // Let persona fetch settle so no async state update races with fireEvent
    await waitFor(() => {
      expect(
        screen.getByText("调整参数后点击「运行对比」查看三种策略效果"),
      ).toBeInTheDocument();
    });

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2048" } });

    expect(input.value).toBe("2048");
  });

  it("updates window size via preset button", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    render(<StrategyComparePanel />);

    await waitFor(() => {
      expect(
        screen.getByText("调整参数后点击「运行对比」查看三种策略效果"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("2K"));

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("2048");
  });

  it("allows user input via textarea", async () => {
    mockFetch.mockResolvedValueOnce(mockPersonasResponse());
    render(<StrategyComparePanel />);

    // Let persona fetch settle so no async state update races with fireEvent
    await waitFor(() => {
      expect(
        screen.getByText("调整参数后点击「运行对比」查看三种策略效果"),
      ).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(
      "输入一段文本模拟用户消息…",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, {
      target: { value: "这是一段测试用户输入" },
    });

    expect(textarea).toHaveValue("这是一段测试用户输入");
  });

  it("handles persona fetch failure gracefully and still compares", async () => {
    // Persona fetch fails silently
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    // But compareStrategies still works
    mockFetch.mockResolvedValueOnce(mockCompareSuccessResponse());

    render(<StrategyComparePanel />);

    fireEvent.click(screen.getByText("运行对比"));

    await waitFor(() => {
      // Should still render strategy columns even without persona data
      expect(screen.getByText("12 条→保留 8 条高分记忆")).toBeInTheDocument();
    });
  });
});

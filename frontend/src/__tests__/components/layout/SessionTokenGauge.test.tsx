/**
 * SessionTokenGauge 测试 — 覆盖 aggregateBreakdowns 纯函数 + 组件渲染（含空态、
 * 颜色阈值边界、预算超限封顶、avg/turn、金额格式）。
 *
 * 组件读 useSessionStats().stats.sessionTokens，故 vi.mock 该 hook 注入受控 stats。
 * @module __tests__/components/layout/SessionTokenGauge.test
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useSessionStats } from "@/components/chat/ChatParamsContext";
import SessionTokenGauge, {
  aggregateBreakdowns,
} from "@/components/layout/SessionTokenGauge";
import type { TokenBreakdown } from "@/components/chat/TokenCostBadge";

vi.mock("@/components/chat/ChatParamsContext", () => ({
  useSessionStats: vi.fn(),
  useChatParams: vi.fn(),
}));

afterEach(cleanup);

/** 最小有效 breakdown：chat 有数据 + 定价 */
function minimalBreakdown(
  overrides: Partial<TokenBreakdown> = {},
): TokenBreakdown {
  return {
    chat: { prompt_tokens: 200, completion_tokens: 50 },
    pricing: { input_per_1m: 1.0, output_per_1m: 2.0 },
    ...overrides,
  };
}

/** 注入受控 sessionTokens 到 mocked useSessionStats */
function mockSession(
  input: number,
  output: number,
  turns: number,
  cost: number,
) {
  vi.mocked(useSessionStats).mockReturnValue({
    stats: {
      messageCount: turns,
      memoryCount: 0,
      sessionTokens: { input, output, turns, cost, hasPricing: cost > 0 },
      sessionStart: 0,
    },
    setMemoryCount: vi.fn(),
    setSessionTokens: vi.fn(),
    incrementMessageCount: vi.fn(),
  } as ReturnType<typeof useSessionStats>);
}

// ── aggregateBreakdowns 纯函数 ──────────────────────────────────────

describe("aggregateBreakdowns", () => {
  it("returns zeros for empty input", () => {
    const r = aggregateBreakdowns([]);
    expect(r).toEqual({
      totalInput: 0,
      totalOutput: 0,
      totalTokens: 0,
      cost: 0,
      hasPricing: false,
      turns: 0,
    });
  });

  it("aggregates a single breakdown with chat only", () => {
    const r = aggregateBreakdowns([minimalBreakdown()]);
    expect(r.totalInput).toBe(200);
    expect(r.totalOutput).toBe(50);
    expect(r.totalTokens).toBe(250);
    expect(r.turns).toBe(1);
    // 200*1 + 50*2 = 300 → /1M = 0.0003
    expect(r.cost).toBeCloseTo(0.0003, 7);
    expect(r.hasPricing).toBe(true);
  });

  it("accumulates across multiple turns", () => {
    const r = aggregateBreakdowns([minimalBreakdown(), minimalBreakdown()]);
    expect(r.totalInput).toBe(400);
    expect(r.totalOutput).toBe(100);
    expect(r.totalTokens).toBe(500);
    expect(r.turns).toBe(2);
  });

  it("sums intent + fact_extraction call points", () => {
    const r = aggregateBreakdowns([
      minimalBreakdown({
        intent: { prompt_tokens: 30, completion_tokens: 10 },
        fact_extraction: { prompt_tokens: 80, completion_tokens: 20 },
      }),
    ]);
    expect(r.totalInput).toBe(200 + 30 + 80);
    expect(r.totalOutput).toBe(50 + 10 + 20);
  });

  it("handles missing call points (only chat present)", () => {
    const r = aggregateBreakdowns([
      minimalBreakdown({ intent: undefined, fact_extraction: undefined }),
    ]);
    expect(r.totalInput).toBe(200);
    expect(r.totalOutput).toBe(50);
  });

  it("cost is 0 and hasPricing false when pricing absent", () => {
    const r = aggregateBreakdowns([
      minimalBreakdown({ pricing: undefined }),
    ]);
    expect(r.cost).toBe(0);
    expect(r.hasPricing).toBe(false);
  });

  it("uses latest breakdown pricing", () => {
    const r = aggregateBreakdowns([
      minimalBreakdown({ pricing: { input_per_1m: 1.0, output_per_1m: 2.0 } }),
      minimalBreakdown({
        chat: { prompt_tokens: 1000, completion_tokens: 0 },
        pricing: { input_per_1m: 5.0, output_per_1m: 10.0 },
      }),
    ]);
    // totalInput = 200 + 1000 = 1200, totalOutput = 50
    // 用最新定价 5/10: (1200*5 + 50*10)/1M = 0.0065
    expect(r.cost).toBeCloseTo(0.0065, 7);
    expect(r.hasPricing).toBe(true);
  });

  it("does not count zero-token turns", () => {
    const r = aggregateBreakdowns([
      minimalBreakdown(),
      { chat: { prompt_tokens: 0, completion_tokens: 0 }, pricing: minimalBreakdown().pricing },
    ]);
    expect(r.turns).toBe(1);
  });
});

// ── 组件渲染 ─────────────────────────────────────────────────────────

describe("SessionTokenGauge rendering", () => {
  it("renders empty state when total is 0", () => {
    mockSession(0, 0, 0, 0);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge").getAttribute("data-variant")).toBe("empty");
    expect(screen.getByTestId("session-token-gauge-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("session-token-gauge-ring")).not.toBeInTheDocument();
  });

  it("renders ring + success variant for small total", () => {
    mockSession(200, 50, 1, 0.0003);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge").getAttribute("data-variant")).toBe("success");
    expect(screen.getByTestId("session-token-gauge-ring")).toBeInTheDocument();
    expect(screen.getByTestId("session-token-gauge-total").textContent).toBe("250");
  });

  it("shows warning variant at 60% boundary", () => {
    // 60000 / 100000 = 0.6 → not <0.6 → warning
    mockSession(40000, 20000, 2, 0.08);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge").getAttribute("data-variant")).toBe("warning");
    expect(screen.getByTestId("session-token-gauge-total").textContent).toBe("60k");
  });

  it("shows success variant just below 60%", () => {
    // 59000 → 0.59 → success
    mockSession(40000, 19000, 1, 0.05);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge").getAttribute("data-variant")).toBe("success");
  });

  it("shows danger variant at 85% boundary", () => {
    // 85000 → 0.85 → not <0.85 → danger
    mockSession(60000, 25000, 3, 0.11);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge").getAttribute("data-variant")).toBe("danger");
    expect(screen.getByTestId("session-token-gauge-total").textContent).toBe("85k");
  });

  it("shows warning just below 85%", () => {
    // 84000 → 0.84 → warning
    mockSession(60000, 24000, 3, 0.1);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge").getAttribute("data-variant")).toBe("warning");
  });

  it("caps pct at 100% when over budget", () => {
    // 150000 → pct 1.0 → 100% → danger
    mockSession(100000, 50000, 5, 0.2);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge").getAttribute("data-variant")).toBe("danger");
    expect(screen.getByTestId("session-token-gauge-total").textContent).toBe("150k");
    // pct 文本含 100%
    const gauge = screen.getByTestId("session-token-gauge");
    expect(gauge.textContent).toContain("100%");
  });

  it("shows formatted cost via formatCost", () => {
    mockSession(200, 50, 1, 0.0003);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge-cost").textContent).toContain("≈¥0.0003");
  });

  it("shows avg per turn = total / turns", () => {
    // total 500, turns 2 → avg 250
    mockSession(400, 100, 2, 0.0006);
    render(<SessionTokenGauge />);
    expect(screen.getByTestId("session-token-gauge-avg").textContent).toContain("250");
    expect(screen.getByTestId("session-token-gauge-turns").textContent).toBe("2");
  });

  it("shows input and output values", () => {
    mockSession(200, 50, 1, 0.0003);
    render(<SessionTokenGauge />);
    const io = screen.getByTestId("session-token-gauge-io");
    expect(io.textContent).toContain("200");
    expect(io.textContent).toContain("输入");
    // output 在另一格
    const cells = screen.getAllByText(/50/);
    expect(cells.length).toBeGreaterThan(0);
  });
});

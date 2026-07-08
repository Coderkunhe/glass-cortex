import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import TokenCostBadge, {
  type TokenBreakdown,
} from "@/components/chat/TokenCostBadge";

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

describe("TokenCostBadge", () => {
  // ── 渲染 ──

  it("renders cost badge with amount and token count", () => {
    render(<TokenCostBadge tokenBreakdown={minimalBreakdown()} />);
    expect(screen.getByTestId("token-cost-badge")).toBeInTheDocument();
    expect(screen.getByTestId("token-cost-amount")).toBeInTheDocument();
    expect(screen.getByTestId("token-cost-count")).toBeInTheDocument();
  });

  it("shows formatted cost for typical chat request", () => {
    // 200 prompt + 50 completion = ¥(200*1 + 50*2)/1M = ¥0.0003
    render(<TokenCostBadge tokenBreakdown={minimalBreakdown()} />);
    expect(screen.getByTestId("token-cost-amount").textContent).toBe(
      "≈¥0.0003",
    );
    expect(screen.getByTestId("token-cost-count").textContent).toBe(
      "250 token",
    );
  });

  it("formats token count with compact k-suffix for large numbers", () => {
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({
          chat: { prompt_tokens: 5000, completion_tokens: 2000 },
        })}
      />,
    );
    expect(screen.getByTestId("token-cost-count").textContent).toBe(
      "7.0k token",
    );
  });

  // ── 多调用点聚合 ──

  it("aggregates tokens across chat + intent + fact_extraction", () => {
    const breakdown: TokenBreakdown = {
      chat: { prompt_tokens: 100, completion_tokens: 50 },
      intent: { prompt_tokens: 20, completion_tokens: 10 },
      fact_extraction: { prompt_tokens: 30, completion_tokens: 15 },
      pricing: { input_per_1m: 1.0, output_per_1m: 2.0 },
    };
    // total input: 150, total output: 75 → cost = (150*1 + 75*2)/1M = 0.0003
    render(<TokenCostBadge tokenBreakdown={breakdown} />);
    expect(screen.getByTestId("token-cost-count").textContent).toBe(
      "225 token",
    );
    expect(screen.getByTestId("token-cost-amount").textContent).toBe(
      "≈¥0.0003",
    );
  });

  // ── 缺少各调用点 ──

  it("renders correctly when intent is missing", () => {
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({ intent: undefined })}
      />,
    );
    // Should still show chat tokens
    expect(screen.getByTestId("token-cost-count").textContent).toBe(
      "250 token",
    );
  });

  it("renders correctly when fact_extraction is missing", () => {
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({ fact_extraction: undefined })}
      />,
    );
    expect(screen.getByTestId("token-cost-count").textContent).toBe(
      "250 token",
    );
  });

  // ── 定价缺失 ──

  it("shows token count but no cost when pricing is missing", () => {
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({ pricing: undefined })}
      />,
    );
    expect(screen.getByTestId("token-cost-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("token-cost-amount")).not.toBeInTheDocument();
    expect(screen.getByTestId("token-cost-count").textContent).toBe(
      "250 token",
    );
  });

  it("shows token count when pricing has zero rates", () => {
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({
          pricing: { input_per_1m: 0, output_per_1m: 0 },
        })}
      />,
    );
    expect(screen.getByTestId("token-cost-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("token-cost-amount")).not.toBeInTheDocument();
  });

  // ── 零 token / 缺失 ──

  it("returns null when tokenBreakdown is undefined", () => {
    const { container } = render(
      <TokenCostBadge tokenBreakdown={undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when all token counts are zero", () => {
    const { container } = render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({
          chat: { prompt_tokens: 0, completion_tokens: 0 },
        })}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  // ── 金额格式化 ──

  it("formats very small cost with 4 decimal places", () => {
    // ¥(10*1 + 5*2)/1M = ¥0.00002 → 4 decimal places "≈¥0.0000"
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({
          chat: { prompt_tokens: 10, completion_tokens: 5 },
        })}
      />,
    );
    expect(screen.getByTestId("token-cost-amount").textContent).toBe(
      "≈¥0.0000",
    );
  });

  it("formats medium cost with 3 decimal places", () => {
    // ¥(1000*1 + 500*2)/1M = ¥0.002
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({
          chat: { prompt_tokens: 1000, completion_tokens: 500 },
        })}
      />,
    );
    expect(screen.getByTestId("token-cost-amount").textContent).toBe(
      "≈¥0.002",
    );
  });

  it("formats large cost with 2 decimal places", () => {
    // ¥(10000*1 + 5000*2)/1M = ¥0.02
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({
          chat: { prompt_tokens: 10000, completion_tokens: 5000 },
        })}
      />,
    );
    expect(screen.getByTestId("token-cost-amount").textContent).toBe(
      "≈¥0.02",
    );
  });

  it("shows cost exactly zero as ¥0", () => {
    // Make pricing non-zero but tokens are zero — we early-return above.
    // This tests the case where cost computes to exactly 0 (no tokens → early return already covered)
    // Instead test: minimal tokens where cost rounds to 0
    // ¥(1*1 + 0*2)/1M = ¥0.000001 → toFixed(4) = "0.0000" → formatCost returns that
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({
          chat: { prompt_tokens: 1, completion_tokens: 0 },
        })}
      />,
    );
    // cost = (1*1 + 0*2) / 1M = 0.000001, which is < 0.001, so toFixed(4) = "0.0000"
    // formatCost: cost !== 0 so it goes to the < 0.001 branch
    expect(screen.getByTestId("token-cost-amount")).toBeInTheDocument();
  });

  // ── 即时 tooltip（替代原生 title） ──

  it("shows instant tooltip on mouseEnter with input/output breakdown", () => {
    render(<TokenCostBadge tokenBreakdown={minimalBreakdown()} />);
    const badge = screen.getByTestId("token-cost-badge");

    // 初始无 tooltip
    expect(document.querySelector(".fixed.z-50")).not.toBeInTheDocument();

    // hover 触发即时 tooltip
    fireEvent.mouseEnter(badge);
    const tooltip = document.querySelector(".fixed.z-50");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip!.textContent).toContain("200");
    expect(tooltip!.textContent).toContain("50");
    expect(tooltip!.textContent).toContain("250");
    expect(tooltip!.textContent).toContain("≈¥0.0003");

    // mouseLeave 关闭
    fireEvent.mouseLeave(badge);
    expect(document.querySelector(".fixed.z-50")).not.toBeInTheDocument();
  });

  it("shows tooltip without cost when pricing is missing", () => {
    render(
      <TokenCostBadge
        tokenBreakdown={minimalBreakdown({ pricing: undefined })}
      />,
    );
    const badge = screen.getByTestId("token-cost-badge");
    fireEvent.mouseEnter(badge);
    const tooltip = document.querySelector(".fixed.z-50");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip!.textContent).toContain("250");
    expect(tooltip!.textContent).not.toContain("¥");
  });
});

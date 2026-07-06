import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextBar from "@/components/chat/ContextBar";
import type { ContextMeta } from "@/lib/api/types";

function buildMeta(overrides: Partial<ContextMeta> = {}): ContextMeta {
  return {
    window_size: 4096,
    base_tokens: 200,
    memories_before: 30,
    memories_token_before: 1200,
    memories_after: 25,
    memories_token_after: 1100,
    overflow_applied: false,
    strategy: "prioritize",
    dropped_count: 0,
    dropped_items: [],
    user_message_tokens: 300,
    total_estimated_tokens: 1700,
    usage_pct: 41.5,
    ...overrides,
  } as ContextMeta;
}

describe("ContextBar", () => {
  // ── 基本渲染 ──
  it("renders usage summary with token counts", () => {
    render(<ContextBar meta={buildMeta()} />);

    // "1,700" is in a dedicated <span> so exact match works
    expect(screen.getByText("1,700")).toBeInTheDocument();
    // JSX concatenates adjacent expressions: "4,096 tokens (42%)" is one text node
    expect(screen.getByText(/4,096 tokens \(42%\)/)).toBeInTheDocument();
  });

  it("renders all four segment labels in legend", () => {
    render(<ContextBar meta={buildMeta()} />);

    // getByText would match both legend AND tooltip (opacity-0 but in DOM)
    expect(screen.getAllByText(/system/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/recall/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/消息/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/空闲/).length).toBeGreaterThanOrEqual(1);
  });

  // ── 用量百分比计算 ──
  it("calculates usage percentage correctly", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 1000,
          total_estimated_tokens: 750,
        })}
      />,
    );

    expect(screen.getByText("750")).toBeInTheDocument();
    expect(screen.getByText(/1,000 tokens \(75%\)/)).toBeInTheDocument();
  });

  // ── 空闲空间计算 ──
  it("computes free space as window minus total", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 4096,
          total_estimated_tokens: 3000,
          base_tokens: 200,
          memories_token_before: 1200,
          user_message_tokens: 1600,
        })}
      />,
    );

    // free = 4096 - 3000 = 1096, shown in legend + tooltip
    const freeMatches = screen.getAllByText(/1,096/);
    expect(freeMatches.length).toBeGreaterThanOrEqual(1);
  });

  // ── 空闲段为零时隐藏 ──
  it("hides free segment when window is fully used", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 4096,
          total_estimated_tokens: 4096,
          base_tokens: 200,
          memories_token_before: 3500,
          user_message_tokens: 396,
        })}
      />,
    );

    // free=0, so the 空闲 legend item should not render
    const freeElements = screen.queryAllByText(/空闲/);
    // "空闲" only appears in bar segment tooltips (title attr), not in visible legend
    expect(freeElements.length).toBe(0);
  });

  // ── zero window_size 除零保护 ──
  it("handles zero window_size without division error", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 0,
          total_estimated_tokens: 0,
          base_tokens: 0,
          memories_token_before: 0,
          user_message_tokens: 0,
        })}
      />,
    );

    // usagePct should be 0, the component should render without crash
    expect(screen.getByText(/tokens \(0%\)/)).toBeInTheDocument();
  });

  // ── number formatting ──
  it("formats large numbers with locale commas", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 32768,
          total_estimated_tokens: 15432,
        })}
      />,
    );

    expect(screen.getByText("15,432")).toBeInTheDocument();
    expect(screen.getByText(/32,768/)).toBeInTheDocument();
  });

  // ── 压缩节省徽章 ──
  it("shows compression savings badge when memories are compressed", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 8192,
          memories_token_before: 3000,
          memories_token_after: 1800,
          total_estimated_tokens: 4000,
          user_message_tokens: 400,
          base_tokens: 200,
        })}
      />,
    );

    // 压缩节省 = 3000 - 1800 = 1200
    expect(screen.getByText(/📦 节省/)).toBeInTheDocument();
    expect(screen.getAllByText(/1,200/).length).toBeGreaterThanOrEqual(1);
  });

  // ── 溢出徽章 ──
  it("shows overflow warning badge when overflow_applied", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 4096,
          overflow_applied: true,
          dropped_count: 5,
          dropped_items: [],
          memories_token_before: 2000,
          memories_token_after: 1500,
          total_estimated_tokens: 3800,
          user_message_tokens: 500,
          base_tokens: 200,
        })}
      />,
    );

    expect(screen.getByText(/⚠️ 溢出/)).toBeInTheDocument();
    // "5 条" matches both badge AND cut-line tooltip; getAllByText avoids ambiguity
    expect(screen.getAllByText(/5 条/).length).toBeGreaterThanOrEqual(1);
  });

  // ── 溢出切断线 ──
  it("renders dashed cut line when overflow cuts recall segment", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 4096,
          overflow_applied: true,
          dropped_count: 3,
          dropped_items: [],
          memories_token_before: 2500,
          memories_token_after: 1200,
          total_estimated_tokens: 3800,
          user_message_tokens: 600,
          base_tokens: 200,
        })}
      />,
    );

    // Dashed cut line is a span with border-r border-dashed
    const cutLine = document.querySelector(".border-dashed");
    expect(cutLine).toBeTruthy();
    // Tooltip is nested inside the cut line span (keyboard-accessible)
    const cutTip = cutLine!.querySelector('[role="tooltip"]');
    expect(cutTip).toBeTruthy();
    expect(cutTip!.textContent).toContain("丢弃 3 条");
  });

  // ── tools 段 ──
  it("renders tools segment when tools_tokens > 0", () => {
    const meta = buildMeta({
      window_size: 8192,
      total_estimated_tokens: 5000,
      user_message_tokens: 400,
      base_tokens: 200,
      memories_token_after: 1500,
    });
    // Inject tools_tokens via type cast (ContextBar reads it as Record<string, unknown>)
    const metaWithTools = { ...meta, tools_tokens: 800 } as unknown as ContextMeta;

    render(<ContextBar meta={metaWithTools} />);

    expect(screen.getAllByText(/tools/).length).toBeGreaterThanOrEqual(1);
    // "800" appears in the legend text "tools 800" (split across nodes)
    const toolsLegend = screen.getAllByText(/tools/)[0].parentElement!;
    expect(toolsLegend.textContent).toMatch(/800/);
  });

  // ── 压缩前/后 tooltip ──
  it("shows compressed segment title with before/after/saved info", () => {
    render(
      <ContextBar
        meta={buildMeta({
          window_size: 8192,
          memories_token_before: 4000,
          memories_token_after: 2500,
          total_estimated_tokens: 5000,
          user_message_tokens: 400,
          base_tokens: 200,
        })}
      />,
    );

    // 压缩后 recall 段 tooltip 包含"压缩前"和"节省"信息
    const tooltips = document.querySelectorAll('[role="tooltip"]');
    const recallTip = Array.from(tooltips).find(
      (t) => t.textContent?.includes("压缩前"),
    );
    expect(recallTip).toBeTruthy();
    expect(recallTip!.textContent).toContain("4,000");
    expect(recallTip!.textContent).toContain("1,500");
  });
});

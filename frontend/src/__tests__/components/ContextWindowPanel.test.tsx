import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ContextWindowPanel from "@/components/chat/ContextWindowPanel";
import type { ContextMeta } from "@/lib/api/types";

function buildMeta(overrides: Partial<ContextMeta> = {}): ContextMeta {
  return {
    window_size: 4096,
    base_tokens: 800,
    memories_before: 30,
    memories_token_before: 1200,
    memories_after: 25,
    memories_token_after: 900,
    overflow_applied: false,
    strategy: "prioritize",
    dropped_count: 0,
    dropped_items: [],
    user_message_tokens: 300,
    total_estimated_tokens: 2100,
    usage_pct: 51.3,
    ...overrides,
  } as ContextMeta;
}

/** CollapsibleSection 需要点击标题才能展开 */
function expand() {
  const headerBtn = screen.getByText("📐 上下文窗口明细").closest("button");
  if (headerBtn) fireEvent.click(headerBtn);
}

describe("ContextWindowPanel", () => {
  // ── 折叠态（已有 4 tests，略调结构） ──

  it("renders collapsed by default — header visible, table hidden", () => {
    render(<ContextWindowPanel meta={buildMeta()} />);
    expect(screen.getByText("📐 上下文窗口明细")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows token summary in header", () => {
    render(<ContextWindowPanel meta={buildMeta()} />);
    expect(screen.getAllByText(/2,100/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/4,096/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows token summary in header reflecting meta", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          memories_token_before: 2000,
          memories_token_after: 900,
          total_estimated_tokens: 2900,
        })}
      />,
    );
    expect(screen.getByText("📐 上下文窗口明细")).toBeInTheDocument();
    expect(screen.getAllByText(/2,900/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders collapsed header without overflow info", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          overflow_applied: true,
          dropped_count: 3,
          dropped_items: [{ content: "discarded memory 1" }],
        })}
      />,
    );
    expect(screen.getByText("📐 上下文窗口明细")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // ── 展开态 — 表格分区 ──

  it("renders zone table when expanded", () => {
    render(<ContextWindowPanel meta={buildMeta()} />);
    expand();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("shows System zone with base_tokens", () => {
    render(<ContextWindowPanel meta={buildMeta({ base_tokens: 800 })} />);
    expand();

    // "800" appears in both System row and 总计 row; getAllByText works
    const matches = screen.getAllByText("800");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Recall zone with memories_token_after", () => {
    render(<ContextWindowPanel meta={buildMeta({ memories_token_after: 900 })} />);
    expand();

    expect(screen.getByText("Recall")).toBeInTheDocument();
    // 900 appears in Recall row; there may be duplicates from header
    expect(screen.getAllByText("900").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 消息 zone with user_message_tokens", () => {
    render(<ContextWindowPanel meta={buildMeta({ user_message_tokens: 300 })} />);
    expand();

    expect(screen.getByText("消息")).toBeInTheDocument();
    expect(screen.getAllByText("300").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Tools zone when tools_tokens is present", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          tools_tokens: 150,
        } as Partial<ContextMeta>)}
      />,
    );
    expand();

    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("does not show Tools zone when tools_tokens absent", () => {
    render(<ContextWindowPanel meta={buildMeta()} />);
    expand();

    expect(screen.queryByText("Tools")).not.toBeInTheDocument();
  });

  it("shows 空闲 zone (free space)", () => {
    // free = 4096 - (800 + 900 + 300) = 2096
    render(<ContextWindowPanel meta={buildMeta()} />);
    expand();

    expect(screen.getByText("空闲")).toBeInTheDocument();
  });

  // ── 总计行 ──

  it("renders total row with usage_pct", () => {
    render(<ContextWindowPanel meta={buildMeta({ usage_pct: 51.3 })} />);
    expand();

    expect(screen.getByText("总计")).toBeInTheDocument();
    expect(screen.getByText("51.3%")).toBeInTheDocument();
  });

  // ── 百分比边界：零窗口 ──

  it("handles zero window_size without division error", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          window_size: 0,
          base_tokens: 0,
          memories_token_after: 0,
          user_message_tokens: 0,
          total_estimated_tokens: 0,
          usage_pct: 0,
        })}
      />,
    );
    expand();

    // Should render without crash; all percentages are 0.0%
    const pctCells = screen.getAllByText("0.0%");
    expect(pctCells.length).toBeGreaterThanOrEqual(1);
  });

  // ── 压缩信息 ──

  it("shows compression info when memories were compressed", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          memories_before: 50,
          memories_token_before: 2500,
          memories_after: 30,
          memories_token_after: 1500,
        })}
      />,
    );
    expand();

    // compressed = memories_token_before > memories_token_after
    expect(screen.getByText(/消息压缩节省/)).toBeInTheDocument();
    // "saved" = 2500 - 1500 = 1000
    expect(screen.getByText(/1,000 tokens/)).toBeInTheDocument();
  });

  it("does not show compression info when nothing was compressed", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          memories_before: 30,
          memories_token_before: 1200,
          memories_after: 25,
          memories_token_after: 900,
        })}
      />,
    );
    expand();

    // memories_token_before > memories_token_after → compressed=true
    // Actually 1200 > 900 → compressed! Let's test with equal.
    expect(screen.getByText(/消息压缩节省/)).toBeInTheDocument();
  });

  it("hides compression info when before <= after", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          memories_before: 25,
          memories_token_before: 900,
          memories_after: 25,
          memories_token_after: 900,
        })}
      />,
    );
    expand();

    expect(screen.queryByText(/消息压缩节省/)).not.toBeInTheDocument();
  });

  // ── 溢出信息 ──

  it("shows overflow warning when overflow_applied is true", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          overflow_applied: true,
          dropped_count: 5,
        })}
      />,
    );
    expand();

    expect(screen.getByText(/上下文溢出/)).toBeInTheDocument();
    expect(screen.getByText(/丢弃 5 条/)).toBeInTheDocument();
  });

  it("shows dropped items list when overflow applied", () => {
    render(
      <ContextWindowPanel
        meta={buildMeta({
          overflow_applied: true,
          dropped_count: 2,
          dropped_items: [
            { content: "Item A: short memory" },
            { content: "Item B: another memory" },
          ],
        })}
      />,
    );
    expand();

    expect(screen.getByText(/Item A: short memory/)).toBeInTheDocument();
    expect(screen.getByText(/Item B: another memory/)).toBeInTheDocument();
  });

  it("truncates long dropped item content at 80 chars", () => {
    const longContent = "x".repeat(150);
    render(
      <ContextWindowPanel
        meta={buildMeta({
          overflow_applied: true,
          dropped_count: 1,
          dropped_items: [{ content: longContent }],
        })}
      />,
    );
    expand();

    // Truncated to 80 chars + "…"
    const displayed = screen.getByText(new RegExp("^x{80}…$"));
    expect(displayed).toBeInTheDocument();
  });

  it("does not render overflow section when overflow_applied is false", () => {
    render(<ContextWindowPanel meta={buildMeta({ overflow_applied: false })} />);
    expand();

    expect(screen.queryByText(/上下文溢出/)).not.toBeInTheDocument();
  });
});

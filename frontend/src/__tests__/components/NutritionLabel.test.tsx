import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NutritionLabel from "@/components/chat/NutritionLabel";
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

describe("NutritionLabel", () => {
  it("renders FDA-style header", () => {
    render(<NutritionLabel meta={buildMeta()} />);
    expect(screen.getByText("上下文成分")).toBeInTheDocument();
  });

  it("shows window size as serving size", () => {
    render(<NutritionLabel meta={buildMeta({ window_size: 8192 })} />);
    expect(screen.getByText(/8,192/)).toBeInTheDocument();
  });

  it("shows four zone rows", () => {
    render(<NutritionLabel meta={buildMeta()} />);
    expect(screen.getByText(/System/)).toBeInTheDocument();
    expect(screen.getByText(/Recall/)).toBeInTheDocument();
    expect(screen.getByText(/消息/)).toBeInTheDocument();
    expect(screen.getByText(/空闲/)).toBeInTheDocument();
  });

  it("shows usage percentage with color coding", () => {
    render(<NutritionLabel meta={buildMeta({ usage_pct: 75.5 })} />);
    expect(screen.getByText("窗口使用率")).toBeInTheDocument();
    expect(screen.getByText("75.5%")).toBeInTheDocument();
  });

  it("shows compression savings in footnote when compressed", () => {
    render(
      <NutritionLabel
        meta={buildMeta({
          memories_token_before: 1500,
          memories_token_after: 900,
        })}
      />,
    );
    expect(screen.getByText(/压缩节省/)).toBeInTheDocument();
  });

  it("shows strategy label in footnote", () => {
    render(<NutritionLabel meta={buildMeta({ strategy: "truncate" })} />);
    expect(screen.getByText(/FIFO 截断/)).toBeInTheDocument();
  });

  it("shows overflow status when overflow_applied", () => {
    render(
      <NutritionLabel meta={buildMeta({ overflow_applied: true, dropped_count: 3 })} />,
    );
    expect(screen.getByText(/已触发溢出/)).toBeInTheDocument();
  });

  // ── 边界值：0% 和 100% ──

  it("handles 0% usage gracefully", () => {
    render(
      <NutritionLabel
        meta={buildMeta({
          base_tokens: 0,
          memories_token_after: 0,
          user_message_tokens: 0,
          usage_pct: 0,
        })}
      />,
    );
    expect(screen.getByText("上下文成分")).toBeInTheDocument();
    expect(screen.getByText("0.0%")).toBeInTheDocument();
  });

  it("handles 100% usage with danger color", () => {
    render(
      <NutritionLabel
        meta={buildMeta({
          base_tokens: 2048,
          memories_token_after: 1024,
          user_message_tokens: 1024,
          usage_pct: 100,
        })}
      />,
    );
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  // ── 未知策略 ──

  it("falls back to raw strategy string when unmapped", () => {
    render(
      <NutritionLabel meta={buildMeta({ strategy: "custom_algo" })} />,
    );
    expect(screen.getByText(/custom_algo/)).toBeInTheDocument();
  });

  // ── 压缩脚注不显示 ──

  it("hides compression footnote when memories_before equals memories_after", () => {
    render(
      <NutritionLabel
        meta={buildMeta({
          memories_token_before: 900,
          memories_token_after: 900,
        })}
      />,
    );
    expect(screen.queryByText(/压缩节省/)).not.toBeInTheDocument();
  });

  // ── 内存 token 原始值展示 ──

  it("displays locale-formatted token values", () => {
    render(
      <NutritionLabel meta={buildMeta({ base_tokens: 1500 })} />,
    );
    // base_tokens 显示为 "1,500"
    expect(screen.getByText("1,500")).toBeInTheDocument();
  });
});

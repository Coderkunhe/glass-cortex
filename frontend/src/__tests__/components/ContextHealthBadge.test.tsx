import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextHealthBadge from "@/components/chat/ContextHealthBadge";
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

describe("ContextHealthBadge", () => {
  it("renders green '充裕' when usage < 50%", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 30 })} />);
    expect(screen.getByText("充裕")).toBeInTheDocument();
  });

  it("renders amber '适中' when usage between 50-80%", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 65 })} />);
    expect(screen.getByText("适中")).toBeInTheDocument();
  });

  it("renders red '紧张' when usage > 80%", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 90 })} />);
    expect(screen.getByText("紧张")).toBeInTheDocument();
  });

  it("has tooltip with health advice", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 30 })} />);
    const badge = screen.getByTitle(/上下文健康/);
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute("title")).toContain("空间充足");
  });

  it("shows warning advice for high usage", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 92 })} />);
    const badge = screen.getByTitle(/上下文健康/);
    expect(badge.getAttribute("title")).toContain("满载");
  });

  // ── 边界值 ──

  it("boundary: exactly 50% shows '适中' not '充裕'", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 50 })} />);
    expect(screen.getByText("适中")).toBeInTheDocument();
    expect(screen.queryByText("充裕")).not.toBeInTheDocument();
  });

  it("boundary: exactly 80% shows '紧张' not '适中'", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 80 })} />);
    expect(screen.getByText("紧张")).toBeInTheDocument();
    expect(screen.queryByText("适中")).not.toBeInTheDocument();
  });

  // ── 颜色 dot 类名 ──

  it("renders correct color dot class for each health level", () => {
    const { rerender } = render(
      <ContextHealthBadge meta={buildMeta({ usage_pct: 30 })} />,
    );
    let dot = document.querySelector(".w-2.h-2.rounded-full");
    expect(dot!.className).toContain("bg-success");

    rerender(<ContextHealthBadge meta={buildMeta({ usage_pct: 60 })} />);
    dot = document.querySelector(".w-2.h-2.rounded-full");
    expect(dot!.className).toContain("bg-warning");

    rerender(<ContextHealthBadge meta={buildMeta({ usage_pct: 90 })} />);
    dot = document.querySelector(".w-2.h-2.rounded-full");
    expect(dot!.className).toContain("bg-danger");
  });

  // ── Tooltip 建议 ──

  it("tooltip advice for mid-range '适中' level", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 65 })} />);
    const badge = screen.getByTitle(/上下文健康/);
    expect(badge.getAttribute("title")).toContain("适中");
    expect(badge.getAttribute("title")).toContain("使用过半");
  });

  // ── 极端值 ──

  it("edge case: 0% usage shows '充裕'", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 0 })} />);
    expect(screen.getByText("充裕")).toBeInTheDocument();
  });

  it("edge case: 100% usage shows '紧张'", () => {
    render(<ContextHealthBadge meta={buildMeta({ usage_pct: 100 })} />);
    expect(screen.getByText("紧张")).toBeInTheDocument();
  });
});

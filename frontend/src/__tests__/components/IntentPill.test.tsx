import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import IntentPill from "@/components/chat/IntentPill";

describe("IntentPill", () => {
  // ── 基础渲染 ──
  it("renders category name", () => {
    render(<IntentPill category="提问" confidence={0.92} />);
    expect(screen.getByText("提问")).toBeInTheDocument();
  });

  it("renders confidence as percentage", () => {
    render(<IntentPill category="提问" confidence={0.92} />);
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("does not set title attribute when no rationale (clean pill)", () => {
    const { container } = render(<IntentPill category="提问" confidence={0.92} />);
    expect((container.firstChild as HTMLElement).title).toBe("提问");
  });

  it("does not set title attribute when rationale is provided (replaced by popover)", () => {
    const { container } = render(<IntentPill category="指令" confidence={0.85} rationale="用户要求执行命令" />);
    // title removed in B23 — rationale now shown via click popover
    expect((container.firstChild as HTMLElement).title).toBe("");
  });

  // ── 各种意图类别 ──
  it("renders all intent categories without error", () => {
    const categories = ["闲聊", "提问", "指令", "探索", "澄清"];
    for (const cat of categories) {
      const { unmount } = render(<IntentPill category={cat} confidence={0.5} />);
      expect(screen.getByText(cat)).toBeInTheDocument();
      unmount();
    }
  });

  // ── 未知类别不崩溃 ──
  it("falls back to default style for unknown category", () => {
    render(<IntentPill category="未知类别" confidence={0.5} />);
    expect(screen.getByText("未知类别")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  // ── large 样式 ──
  it("applies large variant when large prop is true", () => {
    const { container } = render(<IntentPill category="提问" confidence={0.9} large />);
    const span = container.firstChild as HTMLElement;
    // Large variant uses gap-gm-1.5 and text-gm-sm
    expect(span.className).toContain("text-gm-sm");
  });

  // ── onClick prop (Phase 35 Batch 3) ──

  it("renders as button when onClick is provided", () => {
    const onClick = vi.fn();
    render(<IntentPill category="提问" confidence={0.92} onClick={onClick} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain("提问");
    expect(btn.textContent).toContain("92%");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<IntentPill category="提问" confidence={0.92} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders as span when onClick is not provided", () => {
    const { container } = render(<IntentPill category="提问" confidence={0.92} />);
    const span = container.firstChild as HTMLElement;
    expect(span.tagName).toBe("SPAN");
  });

  // ── 边界值 ──
  it("handles 0% confidence", () => {
    render(<IntentPill category="闲聊" confidence={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("handles 100% confidence", () => {
    render(<IntentPill category="闲聊" confidence={1} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  // ── 长类别名截断 ──
  it("truncates long category name", () => {
    render(<IntentPill category="这是一个非常长的意图类别名称" confidence={0.5} />);
    const el = screen.getByText(/这是一个/);
    expect(el).toBeInTheDocument();
    expect(el.className).toContain("truncate");
  });

  // ── Phase 66 B23 — rationale popover ──

  it("renders info icon button when rationale is provided", () => {
    render(<IntentPill category="指令" confidence={0.85} rationale="用户要求执行命令" />);
    const btn = screen.getByRole("button", { name: /推理说明/ });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("does not render info icon when rationale is absent", () => {
    render(<IntentPill category="提问" confidence={0.92} />);
    expect(screen.queryByRole("button", { name: /推理说明/ })).not.toBeInTheDocument();
  });

  it("shows rationale popover on info icon click", () => {
    render(<IntentPill category="指令" confidence={0.85} rationale="用户要求执行命令" />);
    const btn = screen.getByRole("button", { name: /推理说明/ });
    fireEvent.click(btn);
    // popover shows rationale
    expect(screen.getByText("用户要求执行命令")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("closes rationale popover on second click", () => {
    render(<IntentPill category="指令" confidence={0.85} rationale="用户要求执行命令" />);
    const btn = screen.getByRole("button", { name: /推理说明/ });
    fireEvent.click(btn);
    expect(screen.getByText("用户要求执行命令")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText("用户要求执行命令")).not.toBeInTheDocument();
  });

  it("closes rationale popover on outside click", () => {
    render(<IntentPill category="指令" confidence={0.85} rationale="用户要求执行命令" />);
    const btn = screen.getByRole("button", { name: /推理说明/ });
    fireEvent.click(btn);
    expect(screen.getByText("用户要求执行命令")).toBeInTheDocument();
    // click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("用户要求执行命令")).not.toBeInTheDocument();
  });

  it("closes rationale popover on Escape key", () => {
    render(<IntentPill category="指令" confidence={0.85} rationale="用户要求执行命令" />);
    const btn = screen.getByRole("button", { name: /推理说明/ });
    fireEvent.click(btn);
    expect(screen.getByText("用户要求执行命令")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("用户要求执行命令")).not.toBeInTheDocument();
  });

  it("info icon click does not propagate to parent onClick", () => {
    const parentClick = vi.fn();
    render(<IntentPill category="提问" confidence={0.92} rationale="用户提问" onClick={parentClick} />);
    const infoBtn = screen.getByRole("button", { name: /推理说明/ });
    fireEvent.click(infoBtn);
    // parent onClick should NOT be called
    expect(parentClick).not.toHaveBeenCalled();
    // popover should be shown
    expect(screen.getByText("用户提问")).toBeInTheDocument();
  });
});

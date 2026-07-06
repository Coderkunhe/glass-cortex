import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ExplainTooltip from "@/components/ui/ExplainTooltip";

describe("ExplainTooltip", () => {
  it("renders children correctly", () => {
    render(
      <ExplainTooltip termId="context-window">
        上下文窗口
      </ExplainTooltip>,
    );
    expect(screen.getByText("上下文窗口")).toBeInTheDocument();
  });

  it("shows tooltip bubble on hover", () => {
    render(
      <ExplainTooltip termId="context-window">
        上下文窗口
      </ExplainTooltip>,
    );
    const wrap = screen.getByText("上下文窗口").closest(".gm-tooltip-wrap");
    expect(wrap).toBeInTheDocument();

    // The tooltip bubble exists in DOM but is hidden until hover
    const bubble = wrap!.querySelector(".gm-tooltip-bubble");
    expect(bubble).toBeInTheDocument();
    expect(bubble!.textContent).toContain("上下文");
  });

  it("shows correct shortDef from glossary", () => {
    render(
      <ExplainTooltip termId="faiss-index">
        FAISS
      </ExplainTooltip>,
    );
    const wrap = screen.getByText("FAISS").closest(".gm-tooltip-wrap");
    const bubble = wrap!.querySelector(".gm-tooltip-bubble");
    expect(bubble!.textContent).toContain("Meta 开源");
  });

  it("shows category badge in tooltip", () => {
    render(
      <ExplainTooltip termId="memory-recall">
        记忆召回
      </ExplainTooltip>,
    );
    const wrap = screen.getByText("记忆召回").closest(".gm-tooltip-wrap");
    const category = wrap!.querySelector(".gm-tooltip-category");
    expect(category).toBeInTheDocument();
    expect(category!.textContent).toContain("记忆");
    expect(category!.textContent).toContain("记忆召回");
  });

  it("renders children only when termId not found in glossary", () => {
    render(
      <ExplainTooltip termId="nonexistent-term">
        未知术语
      </ExplainTooltip>,
    );
    // Children rendered as plain text — no wrapper span
    expect(screen.getByText("未知术语")).toBeInTheDocument();
    // No tooltip wrapper
    expect(document.querySelector(".gm-tooltip-wrap")).toBeNull();
  });

  it("renders children only when termId is empty string", () => {
    render(
      <ExplainTooltip termId="">
        空术语
      </ExplainTooltip>,
    );
    expect(screen.getByText("空术语")).toBeInTheDocument();
    expect(document.querySelector(".gm-tooltip-wrap")).toBeNull();
  });

  it("has role='tooltip' on the bubble for accessibility", () => {
    render(
      <ExplainTooltip termId="planner">
        规划器
      </ExplainTooltip>,
    );
    const bubble = document.querySelector(".gm-tooltip-bubble");
    expect(bubble).toBeInTheDocument();
    expect(bubble!.getAttribute("role")).toBe("tooltip");
  });

  // ── 术语规范名展示 ──

  it("displays term canonical name in tooltip bubble", () => {
    render(
      <ExplainTooltip termId="intent-recognition">
        意图
      </ExplainTooltip>,
    );
    const wrap = screen.getByText("意图").closest(".gm-tooltip-wrap");
    const bubble = wrap!.querySelector(".gm-tooltip-bubble");
    expect(bubble!.textContent).toContain("意图识别");
  });

  // ── 样式约束 ──

  it("tooltip bubble has max-width style constraint", () => {
    render(
      <ExplainTooltip termId="context-window">
        上下文窗口
      </ExplainTooltip>,
    );
    // max-width is set via component-injected <style> block
    const styleEl = document.querySelector("style");
    expect(styleEl?.textContent).toMatch(/max-width:\s*280px/);
  });

  // ── 复杂 children ──

  it("renders children as complex JSX not just string", () => {
    render(
      <ExplainTooltip termId="context-window">
        <span data-testid="complex-child">
          上下文<strong>窗口</strong>
        </span>
      </ExplainTooltip>,
    );
    const child = screen.getByTestId("complex-child");
    expect(child).toBeInTheDocument();
    expect(child.querySelector("strong")?.textContent).toBe("窗口");
    expect(child.closest(".gm-tooltip-wrap")).toBeInTheDocument();
  });

  // ── Category badge 格式 ──

  it("category badge shows correct format with separator", () => {
    render(
      <ExplainTooltip termId="faiss-index">
        FAISS
      </ExplainTooltip>,
    );
    const wrap = screen.getByText("FAISS").closest(".gm-tooltip-wrap");
    const category = wrap!.querySelector(".gm-tooltip-category");
    expect(category).toBeInTheDocument();
    expect(category!.textContent).toContain("架构");
    expect(category!.textContent).toContain("·");
    expect(category!.textContent).toContain("FAISS 向量索引");
  });
});

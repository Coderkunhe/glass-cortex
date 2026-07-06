import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ContextualLens from "@/components/chat/ContextualLens";
import { RiLightbulbLine } from "@remixicon/react";

afterEach(cleanup);

describe("ContextualLens", () => {
  const defaultProps = {
    triggerLabel: "📏 1,234 token · 怎么算的？",
    title: "Token 三层精度模型",
    children: <p>这是 token 计量的解释内容</p>,
  };

  it("renders trigger button in collapsed state", () => {
    render(<ContextualLens {...defaultProps} />);
    expect(screen.getByText(/怎么算的/)).toBeInTheDocument();
    expect(screen.queryByText("Token 三层精度模型")).not.toBeInTheDocument();
    expect(screen.queryByText("这是 token 计量的解释内容")).not.toBeInTheDocument();
  });

  it("expands on trigger click and shows title + children", () => {
    render(<ContextualLens {...defaultProps} />);
    fireEvent.click(screen.getByText(/怎么算的/));

    expect(screen.getByText("Token 三层精度模型")).toBeInTheDocument();
    expect(screen.getByText("这是 token 计量的解释内容")).toBeInTheDocument();
    expect(screen.getByText("收起")).toBeInTheDocument();
  });

  it("collapses on收起 button click", () => {
    render(<ContextualLens {...defaultProps} />);
    // expand
    fireEvent.click(screen.getByText(/怎么算的/));
    expect(screen.getByText("Token 三层精度模型")).toBeInTheDocument();

    // collapse
    fireEvent.click(screen.getByText("收起"));
    expect(screen.queryByText("Token 三层精度模型")).not.toBeInTheDocument();
    expect(screen.getByText(/怎么算的/)).toBeInTheDocument();
  });

  it("respects defaultOpen=true", () => {
    render(<ContextualLens {...defaultProps} defaultOpen />);
    expect(screen.getByText("Token 三层精度模型")).toBeInTheDocument();
    expect(screen.getByText("这是 token 计量的解释内容")).toBeInTheDocument();
  });

  it("renders custom triggerIcon", () => {
    render(
      <ContextualLens
        {...defaultProps}
        triggerIcon={<RiLightbulbLine data-testid="custom-icon" />}
      />,
    );
    // The custom icon should be rendered inside the trigger button
    const btn = screen.getByRole("button", { name: /怎么算的/ });
    expect(btn.querySelector("[data-testid='custom-icon']")).toBeTruthy();
  });

  it("renders title in expanded content area", () => {
    render(<ContextualLens {...defaultProps} defaultOpen />);
    expect(screen.getByRole("button", { name: "Token 三层精度模型" })).toBeInTheDocument();
  });

  // ── Header click to collapse (Phase 35 Batch 3) ──

  it("collapses when title text is clicked", () => {
    render(<ContextualLens {...defaultProps} defaultOpen />);
    expect(screen.getByText("Token 三层精度模型")).toBeInTheDocument();
    // 点击标题文字收起
    fireEvent.click(screen.getByText("Token 三层精度模型"));
    expect(screen.queryByText("Token 三层精度模型")).not.toBeInTheDocument();
    // 折叠态 trigger button 重新出现
    expect(screen.getByText(/怎么算的/)).toBeInTheDocument();
  });
});

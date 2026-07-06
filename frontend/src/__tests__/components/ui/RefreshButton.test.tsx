import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RefreshButton } from "@/components/ui/RefreshButton";

describe("RefreshButton", () => {
  // ── Basic rendering ──

  it("renders with default aria-label", () => {
    render(<RefreshButton onClick={() => {}} />);
    expect(
      screen.getByRole("button", { name: "刷新数据" })
    ).toBeInTheDocument();
  });

  it("renders the refresh icon", () => {
    render(<RefreshButton onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "刷新数据" });
    expect(button.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with type='button'", () => {
    render(<RefreshButton onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "刷新数据" })).toHaveAttribute(
      "type",
      "button"
    );
  });

  // ── Interaction ──

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  // ── Loading state ──

  it("shows animate-spin on icon when loading", () => {
    render(<RefreshButton onClick={() => {}} loading />);
    const button = screen.getByRole("button", { name: "刷新数据" });
    const svg = button.querySelector("svg");
    expect(svg?.className.baseVal).toContain("animate-spin");
  });

  it("disables button when loading", () => {
    render(<RefreshButton onClick={() => {}} loading />);
    expect(
      screen.getByRole("button", { name: "刷新数据" })
    ).toBeDisabled();
  });

  it("does not disable button when loading is false", () => {
    render(<RefreshButton onClick={() => {}} />);
    expect(
      screen.getByRole("button", { name: "刷新数据" })
    ).not.toBeDisabled();
  });

  // ── Variants ──

  it("ghost variant has no border classes", () => {
    render(<RefreshButton onClick={() => {}} variant="ghost" />);
    const btn = screen.getByRole("button", { name: "刷新数据" });
    expect(btn.className).not.toMatch(/border-border/);
    expect(btn.className).not.toMatch(/bg-surface/);
  });

  it("bordered variant has border and surface classes", () => {
    render(<RefreshButton onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "刷新数据" });
    expect(btn.className).toContain("border-border");
    expect(btn.className).toContain("bg-surface");
  });

  it("bordered variant is the default", () => {
    render(<RefreshButton onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "刷新数据" });
    expect(btn.className).toContain("border-border");
  });

  // ── Styling props ──

  it("applies custom className", () => {
    render(<RefreshButton onClick={() => {}} className="ml-auto" />);
    expect(
      screen.getByRole("button", { name: "刷新数据" }).className
    ).toContain("ml-auto");
  });

  it("applies data-testid", () => {
    render(<RefreshButton onClick={() => {}} data-testid="refresh-btn" />);
    expect(screen.getByTestId("refresh-btn")).toBeInTheDocument();
  });

  // ── Custom aria-label ──

  it("supports custom aria-label", () => {
    render(
      <RefreshButton onClick={() => {}} aria-label="刷新预设" />
    );
    expect(
      screen.getByRole("button", { name: "刷新预设" })
    ).toBeInTheDocument();
  });

  it("does not render text label (icon-only)", () => {
    render(<RefreshButton onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "刷新数据" });
    // Should only have the SVG icon, no text content
    expect(button.textContent).toBe("");
  });
});

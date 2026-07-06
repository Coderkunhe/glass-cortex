import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

describe("CollapsibleSection", () => {
  // ── Basic rendering ──

  it("renders title text", () => {
    render(<CollapsibleSection title="Test Section">content</CollapsibleSection>);
    expect(screen.getByText("Test Section")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(
      <CollapsibleSection title="Section" icon={<span data-testid="icon">🔍</span>}>
        content
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("does not render an icon element when not provided", () => {
    render(<CollapsibleSection title="Section">content</CollapsibleSection>);
    const btn = screen.getByRole("button");
    expect(btn.querySelector("[aria-hidden]")).toBeInTheDocument();
  });

  it("renders rightAccessory when provided", () => {
    render(
      <CollapsibleSection
        title="Section"
        rightAccessory={<button data-testid="copy-btn">Copy</button>}
      >
        content
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("copy-btn")).toBeInTheDocument();
  });

  it("renders with data-testid on outer wrapper", () => {
    render(
      <CollapsibleSection title="Section" data-testid="my-section">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("my-section")).toBeInTheDocument();
  });

  // ── Default collapsed (content always in DOM, hidden attribute when closed) ──

  it("is collapsed by default (content container has hidden attribute)", () => {
    render(
      <CollapsibleSection title="Section">
        <p data-testid="body">hidden</p>
      </CollapsibleSection>,
    );
    const body = screen.getByTestId("body");
    expect(body).toBeInTheDocument();
    const wrapper = body.parentElement;
    expect(wrapper?.hasAttribute("hidden")).toBe(true);
  });

  it("sets aria-expanded=false when collapsed", () => {
    render(<CollapsibleSection title="Section">content</CollapsibleSection>);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders title even when collapsed", () => {
    render(<CollapsibleSection title="Section">content</CollapsibleSection>);
    expect(screen.getByText("Section")).toBeInTheDocument();
  });

  // ── defaultOpen ──

  it("content container has NO hidden attribute when defaultOpen", () => {
    render(
      <CollapsibleSection title="Section" defaultOpen>
        <p data-testid="body">visible</p>
      </CollapsibleSection>,
    );
    const body = screen.getByTestId("body");
    expect(body).toBeInTheDocument();
    expect(body.parentElement?.hasAttribute("hidden")).toBe(false);
  });

  it("sets aria-expanded=true when defaultOpen", () => {
    render(
      <CollapsibleSection title="Section" defaultOpen>
        content
      </CollapsibleSection>,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  // ── Toggle on click ──

  it("toggles from closed to open on header click", () => {
    render(
      <CollapsibleSection title="Section">
        <p data-testid="body">now visible</p>
      </CollapsibleSection>,
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    const body = screen.getByTestId("body");
    expect(body.parentElement?.hasAttribute("hidden")).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles from open to closed on header click", () => {
    render(
      <CollapsibleSection title="Section" defaultOpen>
        <p data-testid="body">visible</p>
      </CollapsibleSection>,
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    const body = screen.getByTestId("body");
    expect(body).toBeInTheDocument();
    expect(body.parentElement?.hasAttribute("hidden")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("rightAccessory click does NOT toggle the section", () => {
    const onClick = vi.fn();
    render(
      <CollapsibleSection
        title="Section"
        rightAccessory={
          <button data-testid="copy-btn" onClick={onClick}>
            Copy
          </button>
        }
      >
        <p data-testid="body">content</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByTestId("copy-btn"));
    expect(onClick).toHaveBeenCalledTimes(1);
    const body = screen.getByTestId("body");
    expect(body.parentElement?.hasAttribute("hidden")).toBe(true);
  });

  // ── Controlled mode ──

  it("respects open prop (controlled mode)", () => {
    render(
      <CollapsibleSection title="Section" open={true}>
        <p data-testid="body">visible</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });

  it("calls onToggle when header is clicked in controlled mode", () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleSection title="Section" open={false} onToggle={onToggle}>
        content
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("does not change internal state in controlled mode (parent controls visibility)", () => {
    const { rerender } = render(
      <CollapsibleSection title="Section" open={false}>
        <p data-testid="body">hidden</p>
      </CollapsibleSection>,
    );
    // Content is in DOM but hidden
    expect(screen.getByTestId("body").parentElement?.hasAttribute("hidden")).toBe(true);

    // Parent changes open to true
    rerender(
      <CollapsibleSection title="Section" open={true}>
        <p data-testid="body">now visible</p>
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("body").parentElement?.hasAttribute("hidden")).toBe(false);
  });

  // ── A11 ──

  it("arrow icon has aria-hidden", () => {
    render(<CollapsibleSection title="Section">content</CollapsibleSection>);
    const btn = screen.getByRole("button");
    const arrow = btn.querySelector("[aria-hidden]");
    expect(arrow).toBeInTheDocument();
  });

  it("toggle button has accessible name from title text", () => {
    render(<CollapsibleSection title="Memory Recall">content</CollapsibleSection>);
    expect(screen.getByRole("button", { name: /Memory Recall/ })).toBeInTheDocument();
  });

  // ── Variants ──

  it("ghost variant has no outer border by default", () => {
    render(
      <CollapsibleSection title="Section" data-testid="section">
        content
      </CollapsibleSection>,
    );
    const el = screen.getByTestId("section");
    expect(el.className).not.toContain("border-border");
  });

  it("bordered variant renders with border", () => {
    render(
      <CollapsibleSection title="Section" variant="bordered" data-testid="section">
        content
      </CollapsibleSection>,
    );
    const el = screen.getByTestId("section");
    expect(el.className).toContain("border-border");
  });

  it("card variant renders with border and shadow", () => {
    render(
      <CollapsibleSection title="Section" variant="card" data-testid="section">
        content
      </CollapsibleSection>,
    );
    const el = screen.getByTestId("section");
    expect(el.className).toContain("border-border");
    expect(el.className).toContain("shadow");
  });

  // ── Animated ──

  it("animated variant uses transition styles on content wrapper", () => {
    render(
      <CollapsibleSection title="Section" variant="card" animated defaultOpen>
        <p>content</p>
      </CollapsibleSection>,
    );
    const el = screen.getByText("content").parentElement;
    expect(el?.style.transition).toContain("max-height");
  });

  // ── className props ──

  it("applies className to outermost wrapper", () => {
    render(
      <CollapsibleSection title="Section" className="my-custom" data-testid="section">
        content
      </CollapsibleSection>,
    );
    expect(screen.getByTestId("section").className).toContain("my-custom");
  });

  it("applies headerClassName to toggle button", () => {
    render(
      <CollapsibleSection title="Section" headerClassName="answer-l2-header">
        content
      </CollapsibleSection>,
    );
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("answer-l2-header");
  });

  it("applies contentClassName to content wrapper", () => {
    render(
      <CollapsibleSection title="Section" defaultOpen contentClassName="prose">
        <p>content</p>
      </CollapsibleSection>,
    );
    const contentEl = screen.getByText("content").parentElement;
    expect(contentEl?.className).toContain("prose");
  });
});

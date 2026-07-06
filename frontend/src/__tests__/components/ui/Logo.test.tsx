import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Logo from "@/components/ui/Logo";

describe("Logo", () => {
  it("renders the brand name", () => {
    render(<Logo />);
    expect(screen.getByText("GlassCortex")).toBeInTheDocument();
  });

  it("renders the brain icon as SVG", () => {
    render(<Logo />);
    const container = screen.getByText("GlassCortex").parentElement;
    expect(container?.querySelector("svg")).toBeInTheDocument();
  });

  it("has select-none class to prevent text selection", () => {
    render(<Logo />);
    const container = screen.getByText("GlassCortex").parentElement;
    expect(container?.className).toContain("select-none");
  });

  it("applies brand color class to icon SVG", () => {
    render(<Logo />);
    const container = screen.getByText("GlassCortex").parentElement;
    const svg = container?.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("text-brand");
  });

  // ── 样式细节 ──

  it("text span has font-semibold and tracking-tight classes", () => {
    render(<Logo />);
    const textSpan = screen.getByText("GlassCortex");
    expect(textSpan.className).toContain("font-semibold");
    expect(textSpan.className).toContain("tracking-tight");
  });

  it("container div has flex layout classes", () => {
    render(<Logo />);
    const container = screen.getByText("GlassCortex").parentElement!;
    expect(container.className).toContain("flex");
    expect(container.className).toContain("items-center");
    expect(container.className).toContain("gap-gm-2");
  });

  it("icon SVG has text-gm-xl size class", () => {
    render(<Logo />);
    const container = screen.getByText("GlassCortex").parentElement!;
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("text-gm-xl");
  });

  it("text span has text-gm-lg and text-text color", () => {
    render(<Logo />);
    const textSpan = screen.getByText("GlassCortex");
    expect(textSpan.className).toContain("text-gm-lg");
    expect(textSpan.className).toContain("text-text");
  });

  it("logo is decorative, not interactive", () => {
    render(<Logo />);
    const textEl = screen.getByText("GlassCortex");
    expect(textEl.closest("button")).toBeNull();
    expect(textEl.closest("a")).toBeNull();
  });

  it("brand name is rendered inside a span element", () => {
    render(<Logo />);
    const textEl = screen.getByText("GlassCortex");
    expect(textEl.tagName).toBe("SPAN");
  });
});

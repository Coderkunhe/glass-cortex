import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Footer from "@/components/layout/Footer";

describe("Footer", () => {
  it("renders a semantic footer element", () => {
    render(<Footer />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("renders brand name and description", () => {
    render(<Footer />);
    expect(screen.getByText("GlassCortex")).toBeInTheDocument();
    expect(screen.getByText("逐层解剖 AI Robot 工作原理")).toBeInTheDocument();
  });

  it("renders source code link with correct security attributes", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("https://github.com/Coderkunhe/glass-cortex");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders both brand and source code icons", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    const svgs = footer.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  // ── 样式与布局 ──

  it("renders dot separator between brand and description", () => {
    render(<Footer />);
    const dot = screen.getByText("·");
    expect(dot).toBeInTheDocument();
    expect(dot.className).toContain("text-border-strong");
  });

  it("renders source code link text inside the link", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: /GitHub/ });
    const span = link.querySelector("span");
    expect(span?.textContent).toBe("GitHub");
  });

  it("footer inner wrapper has flexbox layout classes", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    const inner = footer.firstElementChild!;
    expect(inner.className).toContain("flex");
    expect(inner.className).toContain("justify-between");
    expect(inner.className).toContain("items-center");
  });

  it("footer has backdrop-blur and border-t classes", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    expect(footer.className).toContain("backdrop-blur");
    expect(footer.className).toContain("border-t");
  });

  it("source code link has hover color transition class", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: /GitHub/ });
    expect(link.className).toContain("hover:text-text");
    expect(link.className).toContain("transition-colors");
  });

  it("footer inner wrapper text is styled muted and extra-small", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    const inner = footer.firstElementChild!;
    expect(inner.className).toContain("text-gm-xs");
    expect(inner.className).toContain("text-text-muted");
  });
});

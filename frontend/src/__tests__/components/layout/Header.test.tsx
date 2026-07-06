import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/** Mock next/navigation — usePathname returns active route */
const mockUsePathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

import Header from "@/components/layout/Header";

afterEach(cleanup);

beforeEach(() => {
  mockUsePathname.mockReturnValue("/");
  document.body.innerHTML = "";
});

describe("Header", () => {
  // ── Basic rendering ──

  it("renders brand name via Logo component", () => {
    render(<Header />);
    expect(screen.getByText("GlassCortex")).toBeInTheDocument();
  });

  it("renders all 5 nav links", () => {
    render(<Header />);
    expect(screen.getByRole("link", { name: "聊天" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "问答" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "可观测" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "实验室" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "画像" })).toBeInTheDocument();
  });

  it("renders subtitle text", () => {
    render(<Header />);
    expect(
      screen.getByText(/See How AI Remembers, Thinks, and Plans/),
    ).toBeInTheDocument();
  });

  // ── Active nav styling ──

  it("highlights active nav link with brand styling", () => {
    mockUsePathname.mockReturnValue("/learn");
    render(<Header />);
    const docsLink = screen.getByRole("link", { name: "问答" });
    expect(docsLink.className).toContain("text-brand");
    expect(docsLink.className).toContain("bg-brand-50/50");
  });

  it("renders inactive nav links without brand color", () => {
    mockUsePathname.mockReturnValue("/");
    render(<Header />);
    const docsLink = screen.getByRole("link", { name: "问答" });
    expect(docsLink.className).not.toContain("text-brand");
    expect(docsLink.className).toContain("text-text-muted");
  });

  // ── Project map button ──

  it("shows project map button when onOpenMap is provided", () => {
    const onOpenMap = vi.fn();
    render(<Header onOpenMap={onOpenMap} />);
    expect(
      screen.getByRole("button", { name: "项目地图" }),
    ).toBeInTheDocument();
  });

  it("does not show project map button when onOpenMap is omitted", () => {
    render(<Header />);
    expect(
      screen.queryByRole("button", { name: "项目地图" }),
    ).not.toBeInTheDocument();
  });

  it("calls onOpenMap when project map button is clicked", () => {
    const onOpenMap = vi.fn();
    render(<Header onOpenMap={onOpenMap} />);
    fireEvent.click(screen.getByRole("button", { name: "项目地图" }));
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });

  // ── Scroll-compact behavior ──

  it("adds compact class when main scrolls past threshold", () => {
    const main = document.createElement("main");
    document.body.appendChild(main);

    render(<Header />);

    const header = document.querySelector("header");
    expect(header?.className).not.toContain("gm-header--compact");

    // Simulate scroll past 30px threshold
    Object.defineProperty(main, "scrollTop", { value: 50, writable: true });
    fireEvent.scroll(main);

    expect(header?.className).toContain("gm-header--compact");
  });

  it("removes compact class when main scrolls back to top", () => {
    const main = document.createElement("main");
    document.body.appendChild(main);
    Object.defineProperty(main, "scrollTop", { value: 50, writable: true });

    render(<Header />);

    const header = document.querySelector("header");
    // Initial state depends on scrollTop at render time
    // After render, scroll listener hasn't fired yet unless we trigger it
    fireEvent.scroll(main);
    expect(header?.className).toContain("gm-header--compact");

    // Scroll back to top
    Object.defineProperty(main, "scrollTop", { value: 10, writable: true });
    fireEvent.scroll(main);
    expect(header?.className).not.toContain("gm-header--compact");
  });

  // ── Theme toggle presence ──

  it("renders a theme toggle button", () => {
    render(<Header />);
    // Pre-hydration label "切换主题"
    expect(
      screen.getByRole("button", { name: /切换主题/ }),
    ).toBeInTheDocument();
  });
});

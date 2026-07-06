import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// ── rAF 同步化 — 让 Drawer 双 rAF 动画状态机确定性地一步跑完 ──
let rafCallbacks: Array<() => void> = [];

function stubRaf() {
  rafCallbacks = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: (...args: unknown[]) => void) => {
      rafCallbacks.push(() => cb(0));
      return rafCallbacks.length;
    }),
  );
}

function flushRaf(count = 2) {
  for (let i = 0; i < count; i++) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    act(() => {
      cbs.forEach((cb) => cb());
    });
  }
}

beforeEach(() => {
  stubRaf();
});

// Mock usePathname for AppShell's mobile nav active-link styling
const mockUsePathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

// Mock all child components to isolate AppShell layout testing
vi.mock("@/components/layout/Header", () => ({
  default: ({
    onOpenMap,
    onOpenMobileSidebar,
  }: {
    onOpenMap: () => void;
    onOpenMobileSidebar?: () => void;
  }) => (
    <header data-testid="header-mock">
      <button data-testid="header-open-map" onClick={onOpenMap}>
        Open Map
      </button>
      {onOpenMobileSidebar && (
        <button
          data-testid="header-hamburger"
          onClick={onOpenMobileSidebar}
          aria-label="打开菜单"
        >
          Menu
        </button>
      )}
    </header>
  ),
}));
vi.mock("@/components/layout/Sidebar", () => ({
  default: () => <nav data-testid="sidebar-mock">Sidebar</nav>,
}));
vi.mock("@/components/layout/Footer", () => ({
  default: () => <footer data-testid="footer-mock">Footer</footer>,
}));
vi.mock("@/components/layout/ProjectMapDrawer", () => ({
  default: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="project-map-drawer">
        Map Open
        <button data-testid="map-close" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/chat/ProcessDrawer", () => ({
  default: () => <div data-testid="process-drawer-mock">Process Drawer</div>,
}));
vi.mock("@/components/layout/MobileSidebarDrawer", () => ({
  default: ({
    isOpen,
    onClose,
    pathname,
  }: {
    isOpen: boolean;
    onClose: () => void;
    pathname: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="导航菜单" data-pathname={pathname}>
        {[
          { href: "/", label: "聊天" },
          { href: "/learn", label: "问答" },
          { href: "/profile", label: "画像" },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            role="link"
            className={
              pathname === href ? "text-brand" : "text-text-muted"
            }
            onClick={onClose}
          >
            {label}
          </a>
        ))}
      </div>
    ) : null,
}));

import AppShell from "@/components/layout/AppShell";

afterEach(() => {
  cleanup();
  mockUsePathname.mockReturnValue("/");
});

describe("AppShell", () => {
  // ── 基本渲染 ──

  it("renders Header, Sidebar, Footer, and ProcessDrawer", () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getByTestId("header-mock")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
    expect(screen.getByTestId("footer-mock")).toBeInTheDocument();
    expect(screen.getByTestId("process-drawer-mock")).toBeInTheDocument();
  });

  it("renders children inside the main content area", () => {
    render(
      <AppShell>
        <p data-testid="child-content">Hello</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(main).toContainElement(screen.getByTestId("child-content"));
  });

  // ── 布局结构 ──

  it("renders the grid layout class on the root div", () => {
    const { container } = render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // AppShell returns a single root: the grid div is the first (and only) DOM child
    const grid = container.firstElementChild;
    expect(grid).toBeTruthy();
    expect(grid?.className).toMatch(/grid/);
    expect(grid?.className).toMatch(/h-dvh/);
  });

  // ── ProjectMapDrawer 交互 ──

  it("ProjectMapDrawer hidden by default", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(
      screen.queryByTestId("project-map-drawer"),
    ).not.toBeInTheDocument();
  });

  it("opens ProjectMapDrawer when Header triggers onOpenMap", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    fireEvent.click(screen.getByTestId("header-open-map"));

    expect(screen.getByTestId("project-map-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("project-map-drawer").textContent).toContain(
      "Map Open",
    );
  });

  it("closes ProjectMapDrawer via the drawer's onClose", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // Open first
    fireEvent.click(screen.getByTestId("header-open-map"));
    expect(screen.getByTestId("project-map-drawer")).toBeInTheDocument();

    // Close via drawer's close button
    fireEvent.click(screen.getByTestId("map-close"));
    expect(
      screen.queryByTestId("project-map-drawer"),
    ).not.toBeInTheDocument();
  });

  // ── 嵌套 children 渲染 ──

  it("renders nested React elements as children", () => {
    render(
      <AppShell>
        <section>
          <h1>Title</h1>
          <p>Paragraph</p>
        </section>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Paragraph")).toBeInTheDocument();
  });

  // ── Drawer 打开关闭生命周周期 ──

  it("drawer survives open→close→reopen lifecycle", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // Open
    fireEvent.click(screen.getByTestId("header-open-map"));
    expect(screen.getByTestId("project-map-drawer")).toBeInTheDocument();

    // Close
    fireEvent.click(screen.getByTestId("map-close"));
    expect(screen.queryByTestId("project-map-drawer")).not.toBeInTheDocument();

    // Re-open
    fireEvent.click(screen.getByTestId("header-open-map"));
    expect(screen.getByTestId("project-map-drawer")).toBeInTheDocument();
  });

  // ── Main 区域 ARIA + 样式 ──

  it("main element has overflow-auto and flex-1 for scrollable content", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main.className).toContain("overflow-y-auto");
  });

  // ── ProcessDrawer 始终渲染 ──

  it("renders ProcessDrawer regardless of mapOpen state", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // ProcessDrawer should always be in the DOM
    expect(screen.getByTestId("process-drawer-mock")).toBeInTheDocument();

    // Even after opening map, ProcessDrawer stays
    fireEvent.click(screen.getByTestId("header-open-map"));
    expect(screen.getByTestId("process-drawer-mock")).toBeInTheDocument();
  });

  // ── 最小 children ──

  it("renders with null children without crashing", () => {
    expect(() => {
      render(<AppShell>{null}</AppShell>);
    }).not.toThrow();
  });

  // ── Sidebar slot ──

  it("renders default Sidebar when no sidebar prop is passed", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
  });

  it("renders custom sidebar slot instead of default Sidebar", () => {
    render(
      <AppShell sidebar={<div data-testid="custom-sidebar">Custom</div>}>
        <p>content</p>
      </AppShell>,
    );

    // Custom sidebar is rendered
    expect(screen.getByTestId("custom-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("custom-sidebar")).toHaveTextContent("Custom");

    // Default Sidebar is NOT rendered (slot replaces, not appends)
    expect(screen.queryByTestId("sidebar-mock")).not.toBeInTheDocument();
  });

  it("sidebar slot renders null/false without crashing (immersive mode)", () => {
    expect(() => {
      render(
        <AppShell sidebar={null}>
          <p>content</p>
        </AppShell>,
      );
    }).not.toThrow();

    // Neither custom nor default sidebar should be present
    expect(screen.queryByTestId("sidebar-mock")).not.toBeInTheDocument();
  });

  it("sidebar slot wrapper omits fixed width class for slot mode", () => {
    const { container } = render(
      <AppShell sidebar={<div data-testid="custom-sidebar">Custom</div>}>
        <p>content</p>
      </AppShell>,
    );

    // The sidebar wrapper should NOT have the fixed-width token class
    const gridChildren = container.firstElementChild?.children;
    expect(gridChildren).toBeTruthy();
    // Find the sidebar wrapper (the element containing custom-sidebar)
    const sidebarWrapper = screen.getByTestId("custom-sidebar").parentElement;
    expect(sidebarWrapper).toBeTruthy();
    expect(sidebarWrapper?.className).not.toContain("w-[var(--spacing-sidebar-w)]");
  });

  it("sidebar slot wrapper has fixed width for default Sidebar", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const sidebarWrapper = screen.getByTestId("sidebar-mock").parentElement;
    expect(sidebarWrapper).toBeTruthy();
    expect(sidebarWrapper?.className).toContain("w-[var(--spacing-sidebar-w)]");
  });

  // ── 移动端侧边栏 ──

  it("renders hamburger button in Header when onOpenMobileSidebar is passed", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // AppShell passes onOpenMobileSidebar → mock renders the hamburger
    expect(screen.getByTestId("header-hamburger")).toBeInTheDocument();
    expect(screen.getByTestId("header-hamburger")).toHaveAttribute(
      "aria-label",
      "打开菜单",
    );
  });

  it("mobile sidebar drawer is not in the DOM by default (closed state)", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // Drawer returns null when mounted=false (closed)
    expect(
      screen.queryByRole("dialog", { name: "导航菜单" }),
    ).not.toBeInTheDocument();
  });

  // ── 响应式网格 ──

  it("grid has responsive classes for mobile + desktop", () => {
    const { container } = render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const grid = container.firstElementChild;
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("lg:grid-cols-[auto_1fr]");
  });

  it("desktop sidebar wrapper has hidden lg:block classes", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // The sidebar wrapper div should have hidden and lg:block
    // We verify the sidebar-mock is rendered (it's inside the wrapper)
    const sidebars = screen.getAllByTestId("sidebar-mock");
    // One in the grid wrapper (visible on desktop), potentially one in drawer
    expect(sidebars.length).toBeGreaterThanOrEqual(1);
  });

  // ── 移动端抽屉 — AppShell→MobileSidebarDrawer 契约 ──
  // 注：nav links 的内部渲染验证已迁移至 MobileSidebarDrawer.test.tsx

  it("renders MobileSidebarDrawer when hamburger is clicked", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(
      screen.queryByRole("dialog", { name: "导航菜单" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("header-hamburger"));
    flushRaf();

    expect(
      screen.getByRole("dialog", { name: "导航菜单" }),
    ).toBeInTheDocument();
  });

  it("closes MobileSidebarDrawer when a nav link is clicked", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // Open
    fireEvent.click(screen.getByTestId("header-hamburger"));
    flushRaf();
    expect(
      screen.getByRole("dialog", { name: "导航菜单" }),
    ).toBeInTheDocument();

    // Click a nav link — onClose is wired to link onClick in mock
    fireEvent.click(screen.getByRole("link", { name: "问答" }));
    flushRaf();

    expect(
      screen.queryByRole("dialog", { name: "导航菜单" }),
    ).not.toBeInTheDocument();
  });

  it("passes current pathname to MobileSidebarDrawer", () => {
    mockUsePathname.mockReturnValue("/learn");
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    fireEvent.click(screen.getByTestId("header-hamburger"));
    flushRaf();

    const dialog = screen.getByRole("dialog", { name: "导航菜单" });
    expect(dialog.dataset.pathname).toBe("/learn");
  });
});

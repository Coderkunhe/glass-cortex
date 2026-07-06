import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import MobileSidebarDrawer from "@/components/layout/MobileSidebarDrawer";

afterEach(() => cleanup());

// ── rAF 同步化 — 让 Drawer 双 rAF 动画状态机确定性地一步跑完 ──
let rafCallbacks: Array<() => void> = [];

function stubRaf() {
  rafCallbacks = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: () => void) => {
      rafCallbacks.push(cb);
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

// Mock Sidebar to isolate MobileSidebarDrawer testing
vi.mock("@/components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar-mock">Sidebar</div>,
}));

describe("MobileSidebarDrawer", () => {
  const defaultProps = {
    isOpen: false,
    onClose: vi.fn(),
    pathname: "/",
  };

  function renderMobile(overrides: Partial<typeof defaultProps> = {}) {
    const props = { ...defaultProps, ...overrides };
    return render(<MobileSidebarDrawer {...props} />);
  }

  it("does not render when closed", () => {
    renderMobile();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the drawer when isOpen is true", () => {
    renderMobile({ isOpen: true });
    act(() => flushRaf());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("导航")).toBeInTheDocument();
  });

  it("renders the close button", () => {
    renderMobile({ isOpen: true });
    act(() => flushRaf());

    expect(screen.getByLabelText("关闭菜单")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    renderMobile({ isOpen: true, onClose });
    act(() => flushRaf());

    fireEvent.click(screen.getByLabelText("关闭菜单"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders 3 mobile navigation links", () => {
    renderMobile({ isOpen: true });
    act(() => flushRaf());

    expect(screen.getByText("聊天")).toBeInTheDocument();
    expect(screen.getByText("问答")).toBeInTheDocument();
    expect(screen.getByText("画像")).toBeInTheDocument();
  });

  it("calls onClose when a nav link is clicked", () => {
    const onClose = vi.fn();
    renderMobile({ isOpen: true, onClose, pathname: "/lab" });
    act(() => flushRaf());

    fireEvent.click(screen.getByText("聊天"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies active link styling for current pathname", () => {
    renderMobile({ isOpen: true, pathname: "/learn" });
    act(() => flushRaf());

    const learnLink = screen.getByText("问答").closest("a");
    expect(learnLink).toBeTruthy();
    expect(learnLink!.className).toContain("text-brand");

    const chatLink = screen.getByText("聊天").closest("a");
    expect(chatLink).toBeTruthy();
    expect(chatLink!.className).toContain("text-text-muted");
  });

  it("renders the Sidebar inside the drawer", () => {
    renderMobile({ isOpen: true });
    act(() => flushRaf());

    expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
  });

  it("uses position='left' on the Drawer", () => {
    renderMobile({ isOpen: true });
    act(() => flushRaf());

    const dialog = screen.getByRole("dialog");
    // left-positioned drawer uses "left-0" class
    expect(dialog.className).toContain("left-0");
  });
});

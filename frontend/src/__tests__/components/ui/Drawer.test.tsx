import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import Drawer from "@/components/ui/Drawer";
import { ScrollLockProvider } from "@/components/ui/ScrollLockContext";

afterEach(cleanup);

// ── rAF 同步化 — 让双 rAF 动画状态机确定性地一步跑完 ──
let rafCallbacks: Array<() => void> = [];

function stubRaf() {
  rafCallbacks = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length; // fake handle
    }),
  );
}

function flushRaf(count = 2) {
  for (let i = 0; i < count; i++) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb());
  }
}

beforeEach(() => {
  stubRaf();
});

// ── Helpers ───────────────────────────────────────────────────────────

function renderDrawer(
  overrides: Partial<{
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    maxWidth: number;
    duration: number;
    ariaLabel: string;
  }> = {},
) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    children: <div data-testid="drawer-content">Drawer Content</div>,
    ...overrides,
  };
  return {
    ...render(
      <ScrollLockProvider>
        <Drawer {...props} />
      </ScrollLockProvider>,
    ),
    onClose: props.onClose,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Drawer", () => {
  // ── Closed state ──

  it("returns null when not open and never was mounted", () => {
    const { container } = render(
      <ScrollLockProvider>
        <Drawer isOpen={false} onClose={vi.fn()}>
          <p>content</p>
        </Drawer>
      </ScrollLockProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  // ── Open state — rendering ──

  it("renders the dialog when isOpen becomes true", () => {
    renderDrawer();
    act(() => flushRaf()); // double rAF: mount → phase "open"

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("drawer-content")).toBeInTheDocument();
  });

  it("renders the backdrop overlay", () => {
    const { container } = renderDrawer();
    act(() => flushRaf());

    // backdrop is the first child (fixed inset-0 div)
    const backdrop = container.querySelector(".fixed.inset-0");
    expect(backdrop).toBeTruthy();
  });

  // ── ARIA ──

  it("has aria-modal='true'", () => {
    renderDrawer();
    act(() => flushRaf());

    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-modal",
      "true",
    );
  });

  it("uses default aria-label", () => {
    renderDrawer();
    act(() => flushRaf());

    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "对话框",
    );
  });

  it("uses custom ariaLabel prop", () => {
    renderDrawer({ ariaLabel: "项目地图" });
    act(() => flushRaf());

    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "项目地图",
    );
  });

  // ── Callbacks ──

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    act(() => flushRaf());

    const backdrop = document.querySelector(".fixed.inset-0")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    act(() => flushRaf());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Custom maxWidth ──

  it("applies custom maxWidth prop as inline style", () => {
    renderDrawer({ maxWidth: 600 });
    act(() => flushRaf());

    const dialog = screen.getByRole("dialog");
    expect(dialog.style.maxWidth).toBe("600px");
  });

  it("defaults maxWidth to CSS variable when prop omitted", () => {
    renderDrawer();
    act(() => flushRaf());

    const dialog = screen.getByRole("dialog");
    expect(dialog.style.maxWidth).toBe("var(--gm-drawer-width)");
  });

  // ── Children ──

  it("renders children inside the dialog panel", () => {
    renderDrawer({
      children: (
        <div>
          <h2>Title</h2>
          <p>Body text</p>
        </div>
      ),
    });
    act(() => flushRaf());

    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
  });

  // ── Body scroll lock ──

  it("locks body scroll when drawer opens", () => {
    renderDrawer();
    act(() => flushRaf());

    // body scroll lock sets overflow to "hidden"
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("restores body scroll when unmounted after close", () => {
    const { unmount } = render(
      <ScrollLockProvider>
        <Drawer isOpen={true} onClose={vi.fn()}>
          <p>content</p>
        </Drawer>
      </ScrollLockProvider>,
    );
    act(() => flushRaf());

    // Now opened — lock active
    expect(document.body.style.overflow).toBe("hidden");

    // Unmount — should release lock
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  // ── Multiple render boundary ──

  it("handles multiple Drawer instances without lock corruption", () => {
    // Both drawers share one ScrollLockProvider — reference counting
    // ensures body stays locked until the last drawer unmounts.
    function DualDrawers({
      showA,
      showB,
    }: {
      showA: boolean;
      showB: boolean;
    }) {
      return (
        <ScrollLockProvider>
          {showA && (
            <Drawer isOpen={true} onClose={vi.fn()} ariaLabel="First">
              <p>A</p>
            </Drawer>
          )}
          {showB && (
            <Drawer isOpen={true} onClose={vi.fn()} ariaLabel="Second">
              <p>B</p>
            </Drawer>
          )}
        </ScrollLockProvider>
      );
    }

    const { rerender, unmount } = render(
      <DualDrawers showA={true} showB={false} />,
    );
    act(() => flushRaf());

    // One open — body locked
    expect(document.body.style.overflow).toBe("hidden");

    // Open second
    rerender(<DualDrawers showA={true} showB={true} />);
    act(() => flushRaf());
    expect(document.body.style.overflow).toBe("hidden");

    // Close first — lock should remain (ref count > 0)
    rerender(<DualDrawers showA={false} showB={true} />);
    act(() => flushRaf());
    expect(document.body.style.overflow).toBe("hidden");

    // Close both (unmount entire tree) — lock released
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  // ── Body + html overflow restore ──

  it("restores html element overflow when Drawer closes", () => {
    const prevHtmlOverflow = document.documentElement.style.overflow;

    const { unmount } = renderDrawer();
    act(() => flushRaf());

    expect(document.documentElement.style.overflow).toBe("hidden");

    unmount();
    expect(document.documentElement.style.overflow).toBe(prevHtmlOverflow || "");
  });

  // ── Padding-right compensation (Phase 66 B24) ──
  //
  // 通过 mock window.innerWidth 和 documentElement.clientWidth 模拟
  // 经典滚动条（Windows/Linux，占 15px 布局空间）场景，验证：
  // 1. scrollbarW > 0 时 body 获得 padding-right 补偿
  // 2. overlay scrollbar (macOS) 时不做补偿
  // 3. 关闭时恢复原始 padding-right
  // 4. 多 Drawer 引用计数保护 padding-right

  describe("body scrollbar padding compensation", () => {
    // jsdom 默认值：innerWidth = 1024, clientWidth = 1024
    const JS_DOM_DEFAULT = 1024;
    const SCROLLBAR_W = 15;

    function mockScrollbar() {
      vi.stubGlobal("innerWidth", JS_DOM_DEFAULT);
      Object.defineProperty(document.documentElement, "clientWidth", {
        value: JS_DOM_DEFAULT - SCROLLBAR_W,
        configurable: true,
      });
    }

    afterEach(() => {
      // 还原 globals — vi.stubGlobal 和 Object.defineProperty 都会跨测试泄漏
      vi.unstubAllGlobals();
      Object.defineProperty(document.documentElement, "clientWidth", {
        value: JS_DOM_DEFAULT,
        configurable: true,
      });
      document.body.style.paddingRight = "";
    });

    it("adds body padding-right when scrollbar is visible (>0 px)", () => {
      mockScrollbar();

      renderDrawer();
      act(() => flushRaf());

      expect(document.body.style.paddingRight).toBe(`${SCROLLBAR_W}px`);
    });

    it("does not add padding-right when scrollbar is 0 (overlay/macOS)", () => {
      // afterEach restores everything to default → scrollbarW = 0
      renderDrawer();
      act(() => flushRaf());

      expect(document.body.style.paddingRight).toBe("");
    });

    it("restores original body padding-right when Drawer closes", () => {
      document.body.style.paddingRight = "8px"; // simulate pre-existing
      mockScrollbar();

      const { unmount } = renderDrawer();
      act(() => flushRaf());

      expect(document.body.style.paddingRight).toBe(`${SCROLLBAR_W}px`);

      unmount();
      expect(document.body.style.paddingRight).toBe("8px");
    });

    it("preserves padding-right lock while multiple drawers hold refcount", () => {
      mockScrollbar();

      function DualDrawersPadding({
        showA,
        showB,
      }: {
        showA: boolean;
        showB: boolean;
      }) {
        return (
          <ScrollLockProvider>
            {showA && (
              <Drawer isOpen={true} onClose={vi.fn()} ariaLabel="A">
                <p>A</p>
              </Drawer>
            )}
            {showB && (
              <Drawer isOpen={true} onClose={vi.fn()} ariaLabel="B">
                <p>B</p>
              </Drawer>
            )}
          </ScrollLockProvider>
        );
      }

      const { rerender, unmount } = render(
        <DualDrawersPadding showA={true} showB={false} />,
      );
      act(() => flushRaf());

      expect(document.body.style.paddingRight).toBe(`${SCROLLBAR_W}px`);

      rerender(<DualDrawersPadding showA={true} showB={true} />);
      act(() => flushRaf());

      expect(document.body.style.paddingRight).toBe(`${SCROLLBAR_W}px`);

      rerender(<DualDrawersPadding showA={false} showB={true} />);
      act(() => flushRaf());
      expect(document.body.style.paddingRight).toBe(`${SCROLLBAR_W}px`);

      unmount();
      expect(document.body.style.paddingRight).toBe("");
    });
  });
});

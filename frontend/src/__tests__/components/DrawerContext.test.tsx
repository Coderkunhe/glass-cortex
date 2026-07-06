import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { DrawerProvider, useDrawer } from "@/components/chat/DrawerContext";
import type { ApiTrace } from "@/lib/api/types";

afterEach(cleanup);

/** Minimal ApiTrace stub for testing */
const mockTrace: ApiTrace = {
  caller: "chat",
  model: "deepseek-chat",
  temperature: 0.7,
  max_tokens: 1024,
  elapsed_ms: 500,
  prompt_tokens: 100,
  completion_tokens: 50,
};

/** Test component that consumes DrawerContext and exposes state + actions */
function TestConsumer() {
  const { isOpen, trace, activeTraceId, openDrawer, closeDrawer } =
    useDrawer();
  return (
    <div>
      <span data-testid="isOpen">{String(isOpen)}</span>
      <span data-testid="trace">{trace?.caller ?? "null"}</span>
      <span data-testid="activeTraceId">{activeTraceId ?? "null"}</span>
      <button
        data-testid="open"
        onClick={() => openDrawer(mockTrace, "trace-1")}
      >
        Open
      </button>
      <button data-testid="close" onClick={closeDrawer}>
        Close
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <DrawerProvider>
      <TestConsumer />
    </DrawerProvider>,
  );
}

describe("DrawerContext", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // ── Error boundary ──

  it("throws when useDrawer is used outside DrawerProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    function BadConsumer() {
      useDrawer();
      return null;
    }

    expect(() => render(<BadConsumer />)).toThrow(
      "useDrawer must be used within a <DrawerProvider>",
    );

    consoleError.mockRestore();
  });

  // ── Rendering ──

  it("renders children inside the provider", () => {
    renderProvider();
    expect(screen.getByTestId("isOpen")).toBeInTheDocument();
  });

  // ── Initial state ──

  it("has isOpen=false and null trace/activeTraceId initially", () => {
    renderProvider();
    expect(screen.getByTestId("isOpen").textContent).toBe("false");
    expect(screen.getByTestId("trace").textContent).toBe("null");
    expect(screen.getByTestId("activeTraceId").textContent).toBe("null");
  });

  // ── Open ──

  it("sets isOpen, trace, and activeTraceId on openDrawer", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("open"));

    expect(screen.getByTestId("isOpen").textContent).toBe("true");
    expect(screen.getByTestId("trace").textContent).toBe("chat");
    expect(screen.getByTestId("activeTraceId").textContent).toBe("trace-1");
  });

  it("openDrawer without traceId sets activeTraceId to null", () => {
    function ConsumerNoTraceId() {
      const { activeTraceId, openDrawer } = useDrawer();
      return (
        <div>
          <span data-testid="activeTraceId">{activeTraceId ?? "null"}</span>
          <button
            data-testid="open-no-id"
            onClick={() => openDrawer(mockTrace)}
          >
            Open
          </button>
        </div>
      );
    }

    render(
      <DrawerProvider>
        <ConsumerNoTraceId />
      </DrawerProvider>,
    );

    fireEvent.click(screen.getByTestId("open-no-id"));
    expect(screen.getByTestId("activeTraceId").textContent).toBe("null");
  });

  // ── Close (with timer) ──

  it("sets isOpen=false immediately on close, clears trace after 420ms", () => {
    vi.useFakeTimers();

    renderProvider();

    // Open first
    fireEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("isOpen").textContent).toBe("true");

    // Close — isOpen goes false immediately
    fireEvent.click(screen.getByTestId("close"));
    expect(screen.getByTestId("isOpen").textContent).toBe("false");

    // Trace data still present immediately after close
    expect(screen.getByTestId("trace").textContent).toBe("chat");

    // Advance past the 420ms setTimeout
    act(() => {
      vi.advanceTimersByTime(420);
    });

    // Trace and activeTraceId cleared after timeout
    expect(screen.getByTestId("trace").textContent).toBe("null");
    expect(screen.getByTestId("activeTraceId").textContent).toBe("null");

    vi.useRealTimers();
  });

  // ── 状态机：open-close-open 竞态（B96 修复） ──

  it("stale close timeout does NOT clear trace after re-open (race condition fixed)", () => {
    vi.useFakeTimers();

    renderProvider();

    // Open → close → re-open within 420ms
    fireEvent.click(screen.getByTestId("open"));
    fireEvent.click(screen.getByTestId("close"));
    fireEvent.click(screen.getByTestId("open"));

    // Stale close timeout fires — closeId check prevents clearing the new trace
    act(() => {
      vi.advanceTimersByTime(420);
    });
    // Trace is preserved because openDrawer incremented the closeId counter
    expect(screen.getByTestId("trace").textContent).toBe("chat");

    vi.useRealTimers();
  });

  // ── 不同 traceId 更新 ──

  it("openDrawer with new traceId updates activeTraceId", () => {
    function ConsumerWithId() {
      const { activeTraceId, openDrawer } = useDrawer();
      return (
        <div>
          <span data-testid="id">{activeTraceId ?? "null"}</span>
          <button
            data-testid="open-a"
            onClick={() => openDrawer(mockTrace, "trace-a")}
          >
            A
          </button>
          <button
            data-testid="open-b"
            onClick={() => openDrawer(mockTrace, "trace-b")}
          >
            B
          </button>
        </div>
      );
    }

    render(
      <DrawerProvider>
        <ConsumerWithId />
      </DrawerProvider>,
    );

    fireEvent.click(screen.getByTestId("open-a"));
    expect(screen.getByTestId("id").textContent).toBe("trace-a");

    fireEvent.click(screen.getByTestId("open-b"));
    expect(screen.getByTestId("id").textContent).toBe("trace-b");
  });

  // ── 重复打开 ──

  it("calling openDrawer twice keeps correct state", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("open"));
    fireEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("isOpen").textContent).toBe("true");
    expect(screen.getByTestId("trace").textContent).toBe("chat");
    expect(screen.getByTestId("activeTraceId").textContent).toBe("trace-1");
  });

  // ── 关闭未打开的抽屉 ──

  it("closeDrawer on already-closed drawer does not crash", () => {
    renderProvider();
    // Click close without opening — should not throw
    expect(() => {
      fireEvent.click(screen.getByTestId("close"));
    }).not.toThrow();
    expect(screen.getByTestId("isOpen").textContent).toBe("false");
  });

  // ── 双 Provider 隔离 ──

  it("two separate providers are independent", () => {
    render(
      <>
        <DrawerProvider>
          <TestConsumer />
        </DrawerProvider>
        <DrawerProvider>
          <TestConsumer />
        </DrawerProvider>
      </>,
    );
    // Each provider manages its own state — both default to closed
    const openStates = screen.getAllByTestId("isOpen");
    expect(openStates).toHaveLength(2);
    expect(openStates[0].textContent).toBe("false");
    expect(openStates[1].textContent).toBe("false");
  });

  // ── 420ms 精确定时（对齐 Drawer 退出动画时长）

  it("closeDrawer clears trace exactly after 420ms", () => {
    vi.useFakeTimers();

    renderProvider();
    fireEvent.click(screen.getByTestId("open"));
    fireEvent.click(screen.getByTestId("close"));

    // Before 420ms — trace still present
    act(() => {
      vi.advanceTimersByTime(419);
    });
    expect(screen.getByTestId("trace").textContent).toBe("chat");

    // At exactly 420ms — trace cleared
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("trace").textContent).toBe("null");

    vi.useRealTimers();
  });
});

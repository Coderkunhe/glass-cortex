import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ContentPreloader from "@/components/chat/ContentPreloader";

afterEach(cleanup);

const loadAllChaptersMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({}),
);

vi.mock("@/lib/content/questions", () => ({
  loadAllChaptersParallel: loadAllChaptersMock,
}));

describe("ContentPreloader", () => {
  beforeEach(() => {
    loadAllChaptersMock.mockClear();
  });

  it("renders a hidden span with testid", () => {
    render(<ContentPreloader />);
    const el = screen.getByTestId("content-preloader");
    expect(el).toBeInTheDocument();
    expect(el.tagName).toBe("SPAN");
    expect(el.getAttribute("hidden")).not.toBeNull();
  });

  it("calls loadAllChaptersParallel via requestIdleCallback", () => {
    const ricMock = vi.fn((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    const origRIC = window.requestIdleCallback;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.requestIdleCallback = ricMock as any;

    render(<ContentPreloader />);

    expect(ricMock).toHaveBeenCalledOnce();
    expect(loadAllChaptersMock).toHaveBeenCalledOnce();

    window.requestIdleCallback = origRIC;
  });

  it("falls back to setTimeout when requestIdleCallback is unavailable", () => {
    const origRIC = window.requestIdleCallback;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).requestIdleCallback = undefined;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    render(<ContentPreloader />);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    if (origRIC) {
      window.requestIdleCallback = origRIC;
    }
    setTimeoutSpy.mockRestore();
  });

  it("handles loadAllChaptersParallel rejection silently", () => {
    loadAllChaptersMock.mockRejectedValueOnce(new Error("network error"));

    const ricMock = vi.fn((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    const origRIC = window.requestIdleCallback;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.requestIdleCallback = ricMock as any;

    expect(() => render(<ContentPreloader />)).not.toThrow();

    window.requestIdleCallback = origRIC;
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLearnProgress, computeChapterProgress, computeAllChapterProgress, computeTotalProgress } from "@/hooks/useLearnProgress";
import { LEARN_PROGRESS_KEY } from "@/lib/constants";

/** 创建可注入的 mock localStorage */
function createMockLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn<(key: string) => string | null>(
      (key: string) => store[key] ?? null,
    ),
    setItem: vi.fn<(key: string, value: string) => void>(
      (key: string, value: string) => {
        store[key] = value;
      },
    ),
    removeItem: vi.fn<(key: string) => void>((key: string) => {
      delete store[key];
    }),
    clear: vi.fn<() => void>(() => {
      Object.keys(store).forEach((k) => delete store[k]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn<(index: number) => string | null>(
      (index: number) => Object.keys(store)[index] ?? null,
    ),
  };
}

describe("useLearnProgress", () => {
  let mockStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    vi.stubGlobal("localStorage", mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty progress object by default", () => {
    const { result } = renderHook(() => useLearnProgress());
    expect(result.current.progress).toEqual({});
  });

  it("markViewed adds a new entry with viewedAt timestamp", async () => {
    const { result, rerender } = renderHook(() => useLearnProgress());

    await act(async () => {
      result.current.markViewed("q1.1");
    });
    rerender();

    expect(result.current.progress).toHaveProperty("q1.1");
    expect(result.current.progress["q1.1"].viewedAt).toBeGreaterThan(0);
  });

  it("markViewed is idempotent — does not overwrite existing timestamp", async () => {
    const { result, rerender } = renderHook(() => useLearnProgress());

    // First call sets the timestamp
    await act(async () => {
      result.current.markViewed("q1.1");
    });
    rerender();
    const firstTs = result.current.progress["q1.1"].viewedAt;

    // Second call should not overwrite
    await act(async () => {
      result.current.markViewed("q1.1");
    });
    rerender();
    expect(result.current.progress["q1.1"].viewedAt).toBe(firstTs);
  });

  it("markViewed handles multiple distinct questions", async () => {
    const { result, rerender } = renderHook(() => useLearnProgress());

    await act(async () => {
      result.current.markViewed("q1.1");
    });
    await act(async () => {
      result.current.markViewed("q1.2");
    });
    await act(async () => {
      result.current.markViewed("q2.1");
    });
    rerender();

    expect(Object.keys(result.current.progress)).toHaveLength(3);
    expect(result.current.progress).toHaveProperty("q1.1");
    expect(result.current.progress).toHaveProperty("q1.2");
    expect(result.current.progress).toHaveProperty("q2.1");
  });

  it("persists to localStorage under LEARN_PROGRESS_KEY", async () => {
    const { result, rerender } = renderHook(() => useLearnProgress());

    await act(async () => {
      result.current.markViewed("q1.1");
    });
    rerender();

    const stored = JSON.parse(
      mockStorage.setItem.mock.calls.find(
        (call: string[]) => call[0] === LEARN_PROGRESS_KEY,
      )?.[1] ?? "{}",
    );
    expect(stored).toHaveProperty("q1.1");
  });

  it("reads existing progress from localStorage after hydration", async () => {
    const existing = { "q1.1": { viewedAt: 1700000000000 } };
    mockStorage.getItem.mockReturnValue(JSON.stringify(existing));

    const { result } = renderHook(() => useLearnProgress());
    await waitFor(() => {
      expect(result.current.progress).toEqual(existing);
    });
  });

  it("survives localStorage errors gracefully", async () => {
    mockStorage.getItem.mockImplementationOnce(() => {
      throw new Error("localStorage unavailable");
    });

    const { result } = renderHook(() => useLearnProgress());
    // Should fall back to empty object without throwing
    expect(result.current.progress).toEqual({});
  });
});

describe("computeChapterProgress", () => {
  it("returns all-zero when no questions viewed", () => {
    const result = computeChapterProgress({}, ["q1.1", "q1.2", "q1.3"]);
    expect(result).toEqual({ viewed: 0, total: 3 });
  });

  it("counts viewed questions correctly", () => {
    const progress = {
      "q1.1": { viewedAt: 1000 },
      "q1.3": { viewedAt: 2000 },
    };
    const result = computeChapterProgress(progress, ["q1.1", "q1.2", "q1.3"]);
    expect(result).toEqual({ viewed: 2, total: 3 });
  });

  it("handles empty question list", () => {
    const result = computeChapterProgress({}, []);
    expect(result).toEqual({ viewed: 0, total: 0 });
  });
});

describe("computeAllChapterProgress", () => {
  it("computes per-chapter progress from flat question map", () => {
    const progress = {
      "q1.1": { viewedAt: 1000 },
      "q2.1": { viewedAt: 2000 },
      "q2.2": { viewedAt: 3000 },
    };
    const questionsByChapter = {
      ch1: [{ id: "q1.1" }, { id: "q1.2" }],
      ch2: [{ id: "q2.1" }, { id: "q2.2" }, { id: "q2.3" }],
    };

    const result = computeAllChapterProgress(progress, questionsByChapter);
    expect(result).toEqual({
      ch1: { viewed: 1, total: 2 },
      ch2: { viewed: 2, total: 3 },
    });
  });

  it("handles empty progress", () => {
    const questionsByChapter = {
      ch1: [{ id: "q1.1" }],
    };
    const result = computeAllChapterProgress({}, questionsByChapter);
    expect(result).toEqual({
      ch1: { viewed: 0, total: 1 },
    });
  });
});

describe("computeTotalProgress", () => {
  it("sums viewed and total across all chapters", () => {
    const map = {
      ch1: { viewed: 5, total: 17 },
      ch2: { viewed: 3, total: 27 },
    };
    expect(computeTotalProgress(map)).toEqual({ viewed: 8, total: 44 });
  });

  it("returns zeros for empty map", () => {
    expect(computeTotalProgress({})).toEqual({ viewed: 0, total: 0 });
  });
});

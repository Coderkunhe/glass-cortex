import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

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

describe("useLocalStorage", () => {
  let mockStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    vi.stubGlobal("localStorage", mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns default value when localStorage has no entry", () => {
    const { result } = renderHook(() =>
      useLocalStorage("nonexistent-key", "fallback"),
    );
    expect(result.current[0]).toBe("fallback");
  });

  it("reads existing value from localStorage after hydration", async () => {
    mockStorage.getItem.mockReturnValue('"stored-value"');

    const { result } = renderHook(() =>
      useLocalStorage("test-key", "fallback"),
    );
    // hydration useEffect 同步执行后恢复存储值
    await waitFor(() => expect(result.current[0]).toBe("stored-value"));
  });

  it("persists value to localStorage on change", async () => {
    const { result, rerender } = renderHook(() =>
      useLocalStorage("test-key", "initial"),
    );

    await waitFor(() => expect(result.current[0]).toBe("initial"));

    // Update the value
    await act(async () => {
      result.current[1]("updated-value");
    });
    rerender();

    expect(mockStorage.setItem).toHaveBeenCalledWith(
      "test-key",
      '"updated-value"',
    );
  });

  it("survives localStorage.setItem throwing (quota exceeded)", async () => {
    const error = new Error("QuotaExceededError");
    // setItem throws
    mockStorage.setItem.mockImplementationOnce(() => {
      throw error;
    });

    const { result, rerender } = renderHook(() =>
      useLocalStorage("test-key", "fallback"),
    );
    await waitFor(() => expect(result.current[0]).toBe("fallback"));

    // Update — should not throw even though setItem throws
    await act(async () => {
      result.current[1]("new-value");
    });
    rerender();
    // setItem was called (and threw), but no crash
  });

  it("returns defaultValue when localStorage.getItem throws", async () => {
    mockStorage.getItem.mockImplementationOnce(() => {
      throw new Error("localStorage unavailable");
    });

    const { result } = renderHook(() =>
      useLocalStorage("broken-key", "fallback"),
    );
    expect(result.current[0]).toBe("fallback");
  });

  it("handles complex serializable types", async () => {
    const value: { id: string; tags: string[] } = {
      id: "q1.1",
      tags: ["context", "overflow"],
    };

    const { result, rerender } = renderHook(() =>
      useLocalStorage<{ id: string; tags: string[] }>("complex-key", {
        id: "",
        tags: [],
      }),
    );
    await waitFor(() =>
      expect(result.current[0]).toEqual({ id: "", tags: [] }),
    );

    await act(async () => {
      result.current[1](value);
    });
    rerender();
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      "complex-key",
      JSON.stringify(value),
    );
  });

  it("isolates different keys", async () => {
    mockStorage.getItem = vi.fn(
      (key: string): string | null => {
        if (key === "key-a") return '"value-a"';
        if (key === "key-b") return '"value-b"';
        return null;
      },
    );

    const { result: resultA } = renderHook(() =>
      useLocalStorage("key-a", "default"),
    );
    const { result: resultB } = renderHook(() =>
      useLocalStorage("key-b", "default"),
    );

    await waitFor(() => {
      expect(resultA.current[0]).toBe("value-a");
      expect(resultB.current[0]).toBe("value-b");
    });
  });
});

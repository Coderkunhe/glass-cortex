import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ThemeToggle from "@/components/ui/ThemeToggle";

function createMockLocalStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
}

describe("ThemeToggle", () => {
  let mockLocalStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockLocalStorage = createMockLocalStorage();
    vi.stubGlobal("localStorage", mockLocalStorage);
    document.documentElement.setAttribute("data-theme", "dark");
  });

  // Helper: render + flush hydration setTimeout(0)
  async function renderHydrated() {
    const result = render(<ThemeToggle />);
    // Flush the setTimeout(() => setMounted(true), 0) in useEffect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return result;
  }

  // ── 默认渲染 ──
  it("renders sun icon in dark mode (default)", async () => {
    await renderHydrated();

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    expect(button.getAttribute("aria-label")).toBe("切换到亮色模式");
  });

  // ── 点击切换 ──
  it("toggles to light on click", async () => {
    await renderHydrated();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "切换到暗色模式",
    );
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("gm-theme", "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("toggles back to dark on second click", async () => {
    await renderHydrated();

    const button = screen.getByRole("button");
    fireEvent.click(button); // dark → light
    fireEvent.click(button); // light → dark

    expect(button.getAttribute("aria-label")).toBe("切换到亮色模式");
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("gm-theme", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // ── 读取预存主题 ──
  it("reads stored light theme from localStorage", async () => {
    mockLocalStorage.getItem.mockReturnValue("light");

    await renderHydrated();

    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "切换到暗色模式",
    );
  });

  it("defaults to dark when localStorage is empty", async () => {
    mockLocalStorage.getItem.mockReturnValue(null);

    await renderHydrated();

    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "切换到亮色模式",
    );
  });

  // ── 预挂载占位 ──

  it("renders placeholder with generic aria-label before hydration", () => {
    render(<ThemeToggle />);
    // Before setTimeout(0) fires, mounted=false → placeholder button
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toBe("切换主题");
  });

  it("pre-mount placeholder has empty icon div with h-6 w-6", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    const placeholder = button.querySelector("div");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder!.className).toContain("h-6");
    expect(placeholder!.className).toContain("w-6");
  });

  // ── 月亮图标 ──

  it("renders moon icon when theme is light", async () => {
    mockLocalStorage.getItem.mockReturnValue("light");
    await renderHydrated();
    // light theme → aria-label="切换到暗色模式" → moon icon is shown
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "切换到暗色模式",
    );
  });

  // ── data-theme DOM 属性 ──

  it("sets data-theme attribute on documentElement when toggled", async () => {
    await renderHydrated();
    // Default is dark
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button")); // dark → light
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  // ── 无效 localStorage 值 ──

  it("accepts non-standard stored value as-is without validation", async () => {
    mockLocalStorage.getItem.mockReturnValue("blue");
    await renderHydrated();
    // Component trusts stored value blindly; "blue" !== "dark" → moon icon
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "切换到暗色模式",
    );
  });

  // ── 按钮 CSS 类 ──

  it("button has hover and transition CSS classes", async () => {
    await renderHydrated();
    const button = screen.getByRole("button");
    expect(button.className).toContain("hover:bg-surface-alt");
    expect(button.className).toContain("transition-colors");
  });
});

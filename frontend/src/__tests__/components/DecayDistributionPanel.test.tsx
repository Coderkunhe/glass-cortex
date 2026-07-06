import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import DecayDistributionPanel from "@/components/lab/DecayDistributionPanel";

let mockFetch = vi.fn();

afterEach(cleanup);

beforeEach(() => {
  mockFetch = vi.fn();
  global.fetch = mockFetch;
});

function mockDistributionSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        bins: [
          { bin_label: "0.0-0.1", count: 12, avg_strength: 0.05 },
          { bin_label: "0.1-0.2", count: 18, avg_strength: 0.15 },
          { bin_label: "0.2-0.3", count: 7, avg_strength: 0.25 },
          { bin_label: "0.3-0.4", count: 5, avg_strength: 0.35 },
          { bin_label: "0.4-0.5", count: 3, avg_strength: 0.45 },
        ],
        total_episodes: 45,
        decay_lambda: 0.8,
      }),
  };
}

function mockEmptyDistribution() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        bins: [],
        total_episodes: 0,
        decay_lambda: 1.0,
      }),
  };
}

function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("DecayDistributionPanel", () => {
  it("renders header and empty hint after empty fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockEmptyDistribution());
    render(<DecayDistributionPanel />);
    expect(screen.getByText("衰减分布")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("暂无衰减数据，创建一些记忆后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("shows loading on mount", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      expect(screen.getByText("加载衰减分布…")).toBeInTheDocument();
    });
  });

  it("renders SVG bar chart with correct number of bars", async () => {
    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      // 5 bins → 5 <rect data-bar="true"> elements
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(5);
    });
  });

  it("shows decay lambda annotation", async () => {
    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      expect(screen.getByText(/λ = 0.8000/)).toBeInTheDocument();
    });
  });

  it("shows decay speed label for fast decay (lambda < 0.5)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          bins: [{ bin_label: "0.0-0.1", count: 10, avg_strength: 0.05 }],
          total_episodes: 10,
          decay_lambda: 0.3,
        }),
    });
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      expect(screen.getByText(/快速衰减/)).toBeInTheDocument();
    });
  });

  it("shows decay speed label for moderate decay (0.5 <= lambda <= 1.5)", async () => {
    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      expect(screen.getByText(/衰减适中/)).toBeInTheDocument();
    });
  });

  it("shows decay speed label for slow decay (lambda > 1.5)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          bins: [{ bin_label: "0.0-0.1", count: 5, avg_strength: 0.05 }],
          total_episodes: 5,
          decay_lambda: 2.0,
        }),
    });
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      expect(screen.getByText(/缓慢衰减/)).toBeInTheDocument();
    });
  });

  it("shows statistics summary", async () => {
    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    const { container } = render(<DecayDistributionPanel />);

    await waitFor(() => {
      // 统计摘要 <p> 包含记忆/区间计数
      const paragraphs = container.querySelectorAll("p");
      const summary = Array.from(paragraphs).find(
        (p) => p.textContent?.includes("条记忆"),
      );
      expect(summary).toBeDefined();
      expect(summary?.textContent).toMatch(/45/);
    });
  });

  it("shows error and retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(5);
    });
  });

  // ── 刷新按钮 ──

  it("shows refresh button only in success state", async () => {
    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(5);
    });

    const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
    expect(refreshBtn).toBeInTheDocument();
  });

  // ── 网络异常 ──

  it("handles network error with retry", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(5);
    });
  });

  // ── SVG zoom (ImageViewer) ──

  it("opens lightbox on SVG click", async () => {
    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(5);
    });

    // Click the SVG wrapper
    const svgWrapper = document.querySelector('[aria-label="衰减分布 SVG 可视化"]');
    expect(svgWrapper).toBeInTheDocument();
    fireEvent.click(svgWrapper!);

    // ImageViewer dialog should appear
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("closes lightbox on close button click", async () => {
    mockFetch.mockResolvedValueOnce(mockDistributionSuccess());
    render(<DecayDistributionPanel />);

    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(5);
    });

    // Open lightbox
    const svgWrapper = document.querySelector('[aria-label="衰减分布 SVG 可视化"]');
    fireEvent.click(svgWrapper!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Close via button
    fireEvent.click(screen.getByLabelText("关闭预览"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

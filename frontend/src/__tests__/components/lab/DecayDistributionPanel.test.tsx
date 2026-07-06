import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import DecayDistributionPanel from "@/components/lab/DecayDistributionPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

/** 模拟成功响应——10 bins 标准衰减分布 */
function mockDecaySuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        bins: [
          { bin_label: "0.0-0.1", count: 15, avg_strength: 0.05 },
          { bin_label: "0.1-0.2", count: 22, avg_strength: 0.15 },
          { bin_label: "0.2-0.3", count: 18, avg_strength: 0.25 },
          { bin_label: "0.3-0.4", count: 12, avg_strength: 0.35 },
          { bin_label: "0.4-0.5", count: 8, avg_strength: 0.45 },
          { bin_label: "0.5-0.6", count: 5, avg_strength: 0.55 },
          { bin_label: "0.6-0.7", count: 3, avg_strength: 0.65 },
          { bin_label: "0.7-0.8", count: 2, avg_strength: 0.75 },
          { bin_label: "0.8-0.9", count: 1, avg_strength: 0.85 },
          { bin_label: "0.9-1.0", count: 1, avg_strength: 0.95 },
        ],
        total_episodes: 87,
        decay_lambda: 0.15,
      }),
  };
}

/** 模拟空响应 */
function mockDecayEmpty() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        bins: [],
        total_episodes: 0,
        decay_lambda: 0.0,
      }),
  };
}

/** 模拟错误响应 */
function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () =>
      Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("DecayDistributionPanel", () => {
  it("renders header with title", async () => {
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    render(<DecayDistributionPanel />);
    expect(screen.getByText("衰减分布")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Ebbinghaus 遗忘曲线/)).toBeInTheDocument();
    });
  });

  it("shows loading on mount", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<DecayDistributionPanel />);
    expect(await screen.findByText("加载衰减分布…")).toBeInTheDocument();
  });

  it("renders bar chart with 10 bin rects on success", async () => {
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(10);
    });
  });

  it("shows decay lambda annotation", async () => {
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      const chartSvg = document.querySelector('svg[viewBox="0 0 700 400"]');
      expect(chartSvg).toBeTruthy();
      expect(chartSvg!.textContent).toContain("λ = 0.1500");
    });
  });

  it("shows error and retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    // Retry
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(10);
    });
  });

  it("shows idle message when no episodes", async () => {
    mockFetch.mockResolvedValueOnce(mockDecayEmpty());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      expect(screen.getByText("暂无衰减数据，创建一些记忆后回来查看")).toBeInTheDocument();
    });
  });

  it("renders Y-axis tick labels", async () => {
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      const chartSvg = document.querySelector('svg[viewBox="0 0 700 400"]');
      expect(chartSvg).toBeTruthy();
      // Y-axis ticks text elements (fill-text-muted, textAnchor=end)
      const yTicks = chartSvg!.querySelectorAll('text[text-anchor="end"].fill-text-muted');
      expect(yTicks.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("renders X-axis labels with rotation", async () => {
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      // X-axis labels have transform="rotate(...)" attribute
      const rotated = document.querySelectorAll('svg[viewBox="0 0 700 400"] text[transform]');
      expect(rotated.length).toBe(10);
      const firstTransform = rotated[0].getAttribute("transform");
      expect(firstTransform).toContain("rotate(-45");
    });
  });

  it("renders statistics summary with weighted average", async () => {
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      // Summary paragraph below the chart — text split across JSX expressions
      const summary = document.querySelector("p.text-center.mt-gm-2");
      expect(summary).toBeTruthy();
      expect(summary!.textContent).toContain("共 87 条记忆");
      expect(summary!.textContent).toContain("10 个强度区间");
      expect(summary!.textContent).toContain("平均强度");
    });
  });

  it("renders single bin without crash", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          bins: [{ bin_label: "0.4-0.6", count: 5, avg_strength: 0.5 }],
          total_episodes: 5,
          decay_lambda: 0.08,
        }),
    });
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      const bars = document.querySelectorAll("rect[data-bar]");
      expect(bars.length).toBe(1);
      // Should still show lambda
      const chartSvg = document.querySelector('svg[viewBox="0 0 700 400"]');
      expect(chartSvg!.textContent).toContain("λ = 0.0800");
    });
  });

  it("refreshes data on button click", async () => {
    mockFetch.mockResolvedValueOnce(mockDecaySuccess());
    render(<DecayDistributionPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "刷新数据" })).toBeInTheDocument();
    });
    // Second fetch returns different data
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          bins: [
            { bin_label: "0.8-1.0", count: 20, avg_strength: 0.9 },
          ],
          total_episodes: 20,
          decay_lambda: 0.05,
        }),
    });
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    await waitFor(() => {
      const summary = document.querySelector("p.text-center.mt-gm-2");
      expect(summary).toBeTruthy();
      expect(summary!.textContent).toContain("共 20 条记忆");
    });
  });
});

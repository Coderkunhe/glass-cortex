import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import CacheStatsPanel from "@/components/lab/CacheStatsPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockCacheSuccess(overrides?: {
  embHits?: number;
  embMisses?: number;
  factHits?: number;
  factMisses?: number;
  factSize?: number;
  factNull?: boolean;
}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        embedding: {
          hits: overrides?.embHits ?? 100,
          misses: overrides?.embMisses ?? 20,
          size: 1000,
          total_requests: (overrides?.embHits ?? 100) + (overrides?.embMisses ?? 20),
          hit_rate_pct: 83.3,
        },
        fact: overrides?.factNull
          ? null
          : {
              hits: overrides?.factHits ?? 50,
              misses: overrides?.factMisses ?? 10,
              size: overrides?.factSize ?? 64,
              total_requests:
                (overrides?.factHits ?? 50) + (overrides?.factMisses ?? 10),
              hit_rate_pct: 83.3,
            },
      }),
  };
}

function mockEmptyCache() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        embedding: { hits: 0, misses: 0, size: 1000, total_requests: 0, hit_rate_pct: 0 },
        fact: { hits: 0, misses: 0, size: 64, total_requests: 0, hit_rate_pct: 0 },
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

describe("CacheStatsPanel", () => {
  it("renders header and idle hint", () => {
    render(<CacheStatsPanel />);
    expect(screen.getByText("缓存命中率")).toBeInTheDocument();
  });

  it("shows loading on mount", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("加载缓存统计…")).toBeInTheDocument();
    });
  });

  it("displays embedding cache bar with stats", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheSuccess());
    render(<CacheStatsPanel />);

    await waitFor(() => {
      expect(screen.getByText("嵌入缓存")).toBeInTheDocument();
    });

    // 数值 — 嵌入和事实缓存都有 83.3，用 getAllByText
    expect(screen.getAllByText(/83\.3/).length).toBe(2);
    expect(screen.getByText(/命中 100/)).toBeInTheDocument();
    expect(screen.getByText(/未命中 20/)).toBeInTheDocument();
  });

  it("displays fact cache bar when fact is not null", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheSuccess());
    render(<CacheStatsPanel />);

    await waitFor(() => {
      expect(screen.getByText("事实提取缓存")).toBeInTheDocument();
    });
  });

  it("shows fallback when fact cache is null", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheSuccess({ factNull: true }));
    render(<CacheStatsPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("FactExtractor 未加载"),
      ).toBeInTheDocument();
    });
  });

  it("shows error and retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<CacheStatsPanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockCacheSuccess());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("嵌入缓存")).toBeInTheDocument();
    });
  });

  it("shows idle message when both caches have 0 requests", async () => {
    mockFetch.mockResolvedValueOnce(mockEmptyCache());
    render(<CacheStatsPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("暂无缓存数据，运行管线后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("renders 0% hit rate bar without crash", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          embedding: { hits: 0, misses: 10, size: 1000, total_requests: 10, hit_rate_pct: 0 },
          fact: { hits: 5, misses: 5, size: 64, total_requests: 10, hit_rate_pct: 50 },
        }),
    });
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("嵌入缓存")).toBeInTheDocument();
      // 0% 命中率 — the tabular-nums span has "0.0% 命中率" text
      const hitRateSpan = document.querySelector(".tabular-nums");
      expect(hitRateSpan).toBeTruthy();
      expect(hitRateSpan!.textContent).toMatch(/0\.0%/);
    });
  });

  it("renders 100% hit rate with full bar", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          embedding: { hits: 100, misses: 0, size: 1000, total_requests: 100, hit_rate_pct: 100 },
          fact: { hits: 50, misses: 10, size: 64, total_requests: 60, hit_rate_pct: 83.3 },
        }),
    });
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("嵌入缓存")).toBeInTheDocument();
      // 100% should display correctly — check the tabular-nums span
      const hitRateSpan = document.querySelector(".tabular-nums");
      expect(hitRateSpan!.textContent).toMatch(/100\.0%/);
    });
  });

  it("shows fact cache stats with correct capacity", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheSuccess({ factSize: 256 }));
    render(<CacheStatsPanel />);
    await waitFor(() => {
      // capacity display for fact cache
      expect(screen.getByText(/容量 256/)).toBeInTheDocument();
    });
  });

  it("refreshes and updates cache data", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheSuccess());
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "刷新数据" })).toBeInTheDocument();
    });
    // Second fetch: different hit count
    mockFetch.mockResolvedValueOnce(mockCacheSuccess({ embHits: 200, embMisses: 50 }));
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    await waitFor(() => {
      expect(screen.getByText(/命中 200/)).toBeInTheDocument();
      expect(screen.getByText(/未命中 50/)).toBeInTheDocument();
    });
  });

  it("renders large request count with comma formatting", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          embedding: { hits: 8500, misses: 1500, size: 10000, total_requests: 10000, hit_rate_pct: 85.0 },
          fact: { hits: 3200, misses: 800, size: 64, total_requests: 4000, hit_rate_pct: 80.0 },
        }),
    });
    render(<CacheStatsPanel />);
    await waitFor(() => {
      // Large numbers formatted with commas
      expect(screen.getByText(/命中 8,500/)).toBeInTheDocument();
      expect(screen.getByText(/未命中 1,500/)).toBeInTheDocument();
      expect(screen.getByText(/容量 10,000/)).toBeInTheDocument();
    });
  });
});

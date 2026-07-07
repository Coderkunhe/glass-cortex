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

/** Mock GET /lab/cache-entries?cache_type=...&limit=50 — returns CacheEntriesResponse shape */
function mockCacheEntries(overrides?: {
  cacheType?: string;
  entries?: Array<{ key: string; preview: string; tokens_est: number; kind: string }>;
  totalEntries?: number;
  hits?: number;
  misses?: number;
  hitRatePct?: number;
}) {
  const hits = overrides?.hits ?? 100;
  const misses = overrides?.misses ?? 20;
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        cache_type: overrides?.cacheType ?? "embedding",
        entries: overrides?.entries ?? [
          { key: "emb:hello-world", preview: "embedding cache entry", tokens_est: 1200, kind: "embedding" },
          { key: "emb:foo-bar", preview: "another entry", tokens_est: 800, kind: "embedding" },
        ],
        total_entries: overrides?.totalEntries ?? 1000,
        hits,
        misses,
        hit_rate_pct: overrides?.hitRatePct ?? 83.3,
      }),
  };
}

function mockEmptyCache(cacheType = "embedding") {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        cache_type: cacheType,
        entries: [],
        total_entries: 0,
        hits: 0,
        misses: 0,
        hit_rate_pct: 0,
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
  it("renders header and cache type tabs", () => {
    render(<CacheStatsPanel />);
    expect(screen.getByText("缓存命中率")).toBeInTheDocument();
    expect(screen.getByText("嵌入缓存")).toBeInTheDocument();
    expect(screen.getByText("事实缓存")).toBeInTheDocument();
    expect(screen.getByText("响应缓存")).toBeInTheDocument();
  });

  it("shows loading on mount", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("加载缓存数据…")).toBeInTheDocument();
    });
  });

  it("displays embedding cache bar with stats and entries", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheEntries());
    render(<CacheStatsPanel />);

    await waitFor(() => {
      // CacheBar label
      expect(screen.getByText("嵌入缓存")).toBeInTheDocument();
    });

    expect(screen.getByText(/命中 100/)).toBeInTheDocument();
    expect(screen.getByText(/未命中 20/)).toBeInTheDocument();
    expect(screen.getByText("83.3% 命中率")).toBeInTheDocument();

    // entries list
    expect(screen.getByText("embedding cache entry")).toBeInTheDocument();
    expect(screen.getByText("another entry")).toBeInTheDocument();
    expect(screen.getByText("~1,200 tokens")).toBeInTheDocument();

    // entry count header
    expect(screen.getByText(/缓存内容（共/)).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("displays entries with 0 tokens hidden", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({
        entries: [
          { key: "k", preview: "no token entry", tokens_est: 0, kind: "embedding" },
        ],
      }),
    );
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("no token entry")).toBeInTheDocument();
    });
    // 0 tokens should not render the token badge
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it("shows fallback to key when preview is empty", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({
        entries: [
          { key: "raw-key-123", preview: "", tokens_est: 0, kind: "embedding" },
        ],
      }),
    );
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("raw-key-123")).toBeInTheDocument();
    });
  });

  it("shows idle message when cache is empty", async () => {
    mockFetch.mockResolvedValueOnce(mockEmptyCache());
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(
        screen.getByText("该缓存当前为空，运行管线后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("shows fact-specific idle message when fact cache empty", async () => {
    // First fetch: embedding (success with entries) — just to render tabs
    mockFetch.mockResolvedValueOnce(mockCacheEntries());

    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("embedding cache entry")).toBeInTheDocument();
    });

    // Click on fact tab
    mockFetch.mockResolvedValueOnce(mockEmptyCache("fact"));
    fireEvent.click(screen.getByText("事实缓存"));

    await waitFor(() => {
      expect(
        screen.getByText(/事实提取缓存尚未初始化/),
      ).toBeInTheDocument();
    });
  });

  it("shows error and retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<CacheStatsPanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockCacheEntries());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("embedding cache entry")).toBeInTheDocument();
    });
  });

  it("renders 0% hit rate bar without crash", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({
        hits: 0,
        misses: 10,
        hitRatePct: 0,
        totalEntries: 1000,
      }),
    );
    render(<CacheStatsPanel />);
    await waitFor(() => {
      const hitRateSpan = document.querySelector(".tabular-nums");
      expect(hitRateSpan).toBeTruthy();
      expect(hitRateSpan!.textContent).toMatch(/0\.0%/);
    });
  });

  it("renders 100% hit rate with full bar", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({
        hits: 100,
        misses: 0,
        hitRatePct: 100,
        totalEntries: 1000,
      }),
    );
    render(<CacheStatsPanel />);
    await waitFor(() => {
      const hitRateSpan = document.querySelector(".tabular-nums");
      expect(hitRateSpan!.textContent).toMatch(/100\.0%/);
    });
  });

  it("switches cache type and fetches new data", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheEntries());
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("embedding cache entry")).toBeInTheDocument();
    });

    // Switch to response cache
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({
        cacheType: "response",
        entries: [
          { key: "resp:test", preview: "response cache entry", tokens_est: 500, kind: "response" },
        ],
      }),
    );
    fireEvent.click(screen.getByText("响应缓存"));

    await waitFor(() => {
      expect(screen.getByText("response cache entry")).toBeInTheDocument();
      expect(screen.getByText("~500 tokens")).toBeInTheDocument();
    });
  });

  it("refreshes and updates cache data", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheEntries());
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "刷新数据" })).toBeInTheDocument();
    });

    // Second fetch: different hit count
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({ hits: 200, misses: 50, hitRatePct: 80.0 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));

    await waitFor(() => {
      expect(screen.getByText(/命中 200/)).toBeInTheDocument();
      expect(screen.getByText(/未命中 50/)).toBeInTheDocument();
    });
  });

  it("renders large request count with comma formatting", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({
        hits: 8500,
        misses: 1500,
        totalEntries: 10000,
        hitRatePct: 85.0,
      }),
    );
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/命中 8,500/)).toBeInTheDocument();
      expect(screen.getByText(/未命中 1,500/)).toBeInTheDocument();
      expect(screen.getByText(/容量 10,000/)).toBeInTheDocument();
    });
  });

  it("shows health label for healthy cache (≥80%)", async () => {
    mockFetch.mockResolvedValueOnce(mockCacheEntries({ hitRatePct: 85.0 }));
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/健康/)).toBeInTheDocument();
    });
  });

  it("shows warning label for borderline cache (40-80%)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({ hits: 60, misses: 40, hitRatePct: 60.0 }),
    );
    render(<CacheStatsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/偏低/)).toBeInTheDocument();
    });
  });

  it("hides health label when total requests is 0", async () => {
    mockFetch.mockResolvedValueOnce(
      mockCacheEntries({
        hits: 0,
        misses: 0,
        hitRatePct: 0,
        entries: [],
        totalEntries: 1000,
      }),
    );
    render(<CacheStatsPanel />);
    await waitFor(() => {
      // empty state, no health label
      expect(screen.queryByText(/健康/)).toBeNull();
      expect(screen.queryByText(/偏低/)).toBeNull();
      expect(screen.queryByText(/异常/)).toBeNull();
    });
  });
});

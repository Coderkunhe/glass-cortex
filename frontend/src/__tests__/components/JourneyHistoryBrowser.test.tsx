import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import JourneyHistoryBrowser from "@/components/chat/JourneyHistoryBrowser";
import type { EpisodeOut } from "@/lib/api/types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const baseEpisodes: EpisodeOut[] = [
  {
    id: 1,
    content: "用户喜欢 Python 编程",
    importance: 0.8,
    initial_strength: 1.0,
    lambda: 0.015,
    timestamp: 1700000000,
    faiss_id: 10,
    access_count: 3,
    last_recall: 1700000100,
    tier: "hot",
  },
  {
    id: 2,
    content: "用户在学 Rust 语言",
    importance: 0.6,
    initial_strength: 0.9,
    lambda: 0.015,
    timestamp: 1700000001,
    faiss_id: null,
    access_count: 1,
    last_recall: null,
    tier: "warm",
  },
  {
    id: 3,
    content: "用户的项目名为 GlassCortex",
    importance: 0.9,
    initial_strength: 1.0,
    lambda: 0.01,
    timestamp: 1700000002,
    faiss_id: 20,
    access_count: 5,
    last_recall: 1700000200,
    tier: "hot",
  },
];

function mockEpisodes(items: EpisodeOut[] = baseEpisodes) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(items),
  });
}

function mockEpisodesError(msg = "Internal Server Error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ detail: msg }),
  });
}

describe("JourneyHistoryBrowser", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(cleanup);

  // ── Loading state ────────────────────────────────────────────────────

  it("shows loading spinner on initial fetch", async () => {
    // 使用 deferred promise 让 loading 态稳定可见
    let resolvePromise!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const deferred = new Promise<{ ok: boolean; json: () => Promise<unknown> }>(
      (resolve) => {
        resolvePromise = resolve;
      },
    );
    mockFetch.mockReturnValueOnce(deferred);
    render(<JourneyHistoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText("加载中…")).toBeInTheDocument();
    });

    // 随后 resolve → 进入 success 态
    resolvePromise({
      ok: true,
      json: () => Promise.resolve(baseEpisodes),
    });

    await waitFor(() => {
      expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    });
  });

  // ── Error state ──────────────────────────────────────────────────────

  it("shows categorized error on fetch failure", async () => {
    mockEpisodesError("服务不可用");
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      // ErrorDisplay shows the categorized Chinese message, not the raw string
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("shows retry button on error", async () => {
    mockEpisodesError();
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText("重试")).toBeInTheDocument();
    });
  });

  it("retry button triggers re-fetch", async () => {
    mockEpisodesError();
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText("重试")).toBeInTheDocument();
    });

    // Prepare success response for retry
    mockEpisodes();
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText(/Python/)).toBeInTheDocument();
    });
  });

  // ── Empty / idle state ───────────────────────────────────────────────

  it("shows empty state when no episodes", async () => {
    mockEpisodes([]);
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText("暂无对话历史")).toBeInTheDocument();
    });
  });

  // ── Success: list rendering ──────────────────────────────────────────

  it("renders episode list", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText(/Python 编程/)).toBeInTheDocument();
      expect(screen.getByText(/Rust 语言/)).toBeInTheDocument();
      expect(screen.getByText(/GlassCortex/)).toBeInTheDocument();
    });
  });

  it("shows episode count in header", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText("3 条")).toBeInTheDocument();
    });
  });

  it("shows collapsed content preview (truncated)", async () => {
    mockEpisodes([
      {
        id: 1,
        content:
          "这是一段非常长的内容用来测试截断功能是否正常工作" +
          "超过八十个字符后应该显示省略号来表示内容被截断了" +
          "继续添加更多文字以确保超过截断阈值让测试能够验证截断行为" +
          "还需要再长一些因为中文的每个字算一个字符所以要写到足够长",
        importance: 0.8,
        initial_strength: 1.0,
        lambda: 0.015,
        timestamp: 1700000000,
        faiss_id: null,
        access_count: 1,
        last_recall: null,
        tier: "warm",
      },
    ]);
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      const el = screen.getByText(/这是一段非常长的内容/);
      expect(el.textContent).toContain("…");
    });
  });

  // ── Expand/collapse ──────────────────────────────────────────────────

  it("expands row to show metadata on click", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText(/Python 编程/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Python 编程/));

    // Expanded detail: metadata fields visible
    expect(screen.getByText("重要性")).toBeInTheDocument();
    expect(screen.getByText("初始强度")).toBeInTheDocument();
    expect(screen.getByText("衰减系数 λ")).toBeInTheDocument();
    expect(screen.getByText("访问次数")).toBeInTheDocument();
  });

  it("collapses row on second click", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText(/Python 编程/)).toBeInTheDocument();
    });

    // Expand
    fireEvent.click(screen.getByText(/Python 编程/));
    expect(screen.getByText("重要性")).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText(/Python 编程/));
    expect(screen.queryByText("重要性")).not.toBeInTheDocument();
  });

  // ── Search filter ────────────────────────────────────────────────────

  it("filters episodes by search keyword", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText(/Python 编程/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("搜索历史内容…");
    fireEvent.change(input, { target: { value: "Rust" } });

    expect(screen.getByText(/Rust/)).toBeInTheDocument();
    expect(screen.queryByText(/Python/)).not.toBeInTheDocument();
    expect(screen.queryByText(/GlassCortex/)).not.toBeInTheDocument();
  });

  it("shows no-match message when search has no results", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText(/Python 编程/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("搜索历史内容…");
    fireEvent.change(input, { target: { value: "zzz-nomatch" } });

    await waitFor(() => {
      expect(screen.getByText(/未找到匹配/)).toBeInTheDocument();
    });
  });

  it("clear button resets search", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText(/Python 编程/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("搜索历史内容…");
    fireEvent.change(input, { target: { value: "Rust" } });
    expect(screen.queryByText(/Python/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("清除"));
    expect(screen.getByText(/Python/)).toBeInTheDocument();
    expect(screen.getByText(/Rust/)).toBeInTheDocument();
  });

  // ── Refresh ──────────────────────────────────────────────────────────

  it("refresh button triggers re-fetch", async () => {
    mockEpisodes(baseEpisodes.slice(0, 2)); // First fetch: 2 episodes
    render(<JourneyHistoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText("2 条")).toBeInTheDocument();
    });

    // Second fetch: all 3
    mockEpisodes(baseEpisodes);
    const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByText("3 条")).toBeInTheDocument();
    });
  });

  // ── Header always visible ────────────────────────────────────────────

  it("always shows header even during loading", () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);
    expect(screen.getByText("对话历史")).toBeInTheDocument();
  });

  // ── Section title ───────────────────────────────────────────────────

  it("renders with correct section title", async () => {
    mockEpisodes();
    render(<JourneyHistoryBrowser />);
    await waitFor(() => {
      expect(screen.getByText("对话历史")).toBeInTheDocument();
    });
  });
});

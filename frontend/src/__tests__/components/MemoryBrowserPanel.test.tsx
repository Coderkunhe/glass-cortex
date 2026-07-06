import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import MemoryBrowserPanel from "@/components/lab/MemoryBrowserPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockEpisodesSuccess(items?: object[]) {
  return {
    ok: true,
    json: () =>
      Promise.resolve(
        items ?? [
          {
            id: 1,
            content: "用户喜欢 Python 编程",
            importance: 0.8,
            initial_strength: 1.0,
            lambda: 0.1,
            timestamp: 1700000000,
            faiss_id: 10,
            access_count: 3,
            last_recall: 1700000100,
          },
          {
            id: 2,
            content: "用户在学 Rust",
            importance: 0.6,
            initial_strength: 0.9,
            lambda: 0.15,
            timestamp: 1700000001,
            faiss_id: null,
            access_count: 1,
            last_recall: null,
          },
        ],
      ),
  };
}

function mockFactsSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve([
        {
          id: 1,
          content: "猫是哺乳动物",
          confidence: 0.95,
          source_episode_id: 2,
          faiss_id: 20,
          subject: "猫",
          relation: "是",
          object: "哺乳动物",
          timestamp: 1719000000,
        },
        {
          id: 2,
          content: "Python 是编程语言",
          confidence: 0.9,
          source_episode_id: null,
          faiss_id: null,
          subject: "Python",
          relation: "是",
          object: "编程语言",
          timestamp: null,
        },
      ]),
  };
}

function mockEmptySuccess() {
  return {
    ok: true,
    json: () => Promise.resolve([]),
  };
}

function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("MemoryBrowserPanel", () => {
  it("renders header and idle hint on mount", () => {
    render(<MemoryBrowserPanel />);
    expect(screen.getByText("记忆浏览器")).toBeInTheDocument();
    // 默认 Episodes 子 Tab 选中
    expect(
      screen.getByRole("tab", { name: "记忆流" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: "知识碎片" }),
    ).toBeInTheDocument();
  });

  it("auto-fetches episodes on mount and shows loading", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<MemoryBrowserPanel />);
    await waitFor(() => {
      expect(screen.getByText("加载记忆流…")).toBeInTheDocument();
    });
  });

  it("displays episode list with content and importance", async () => {
    mockFetch.mockResolvedValueOnce(mockEpisodesSuccess());
    render(<MemoryBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Python 编程")).toBeInTheDocument();
    });

    expect(screen.getByText("用户在学 Rust")).toBeInTheDocument();
    // importance toFixed(2) → "0.80"
    expect(screen.getByText("0.80")).toBeInTheDocument();
  });

  it("can expand an episode to show full detail", async () => {
    mockFetch.mockResolvedValueOnce(mockEpisodesSuccess());
    render(<MemoryBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Python 编程")).toBeInTheDocument();
    });

    // 点击展开第一个 episode
    const expandBtns = screen.getAllByTitle("展开详情");
    fireEvent.click(expandBtns[0]);

    // 展开后显示更多字段
    expect(screen.getByText(/initial_strength/)).toBeInTheDocument();
    expect(screen.getByText(/access_count/)).toBeInTheDocument();
  });

  it("switches to Facts sub-tab and lazy-fetches", async () => {
    // First render auto-fetches episodes
    mockFetch.mockResolvedValueOnce(mockEpisodesSuccess());
    render(<MemoryBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Python 编程")).toBeInTheDocument();
    });

    // 切换到 Facts 子 Tab
    mockFetch.mockResolvedValueOnce(mockFactsSuccess());
    fireEvent.click(screen.getByRole("tab", { name: "知识碎片" }));

    await waitFor(() => {
      expect(screen.getByText("猫是哺乳动物")).toBeInTheDocument();
    });

    // 三连 pill 显示 — "是" 在两条 fact 中各出现一次，共 2 个
    expect(screen.getByText("猫")).toBeInTheDocument();
    expect(screen.getAllByText("是").length).toBe(2);
    expect(screen.getByText("哺乳动物")).toBeInTheDocument();
  });

  it("filters episodes client-side by search text", async () => {
    mockFetch.mockResolvedValueOnce(mockEpisodesSuccess());
    render(<MemoryBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Python 编程")).toBeInTheDocument();
    });

    // 搜索 "Rust"
    const searchInput = screen.getByPlaceholderText("搜索记忆流…");
    fireEvent.change(searchInput, { target: { value: "Rust" } });

    // 只显示匹配项
    expect(
      screen.queryByText("用户喜欢 Python 编程"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("用户在学 Rust")).toBeInTheDocument();
  });

  it("shows error and retry on episodes fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<MemoryBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockEpisodesSuccess());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Python 编程")).toBeInTheDocument();
    });
  });

  it("shows empty state when episodes list is empty", async () => {
    mockFetch.mockResolvedValueOnce(mockEmptySuccess());
    render(<MemoryBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText("暂无记忆流")).toBeInTheDocument();
    });
  });

  it("shows empty state for Facts after switching to empty facts", async () => {
    mockFetch.mockResolvedValueOnce(mockEpisodesSuccess());
    render(<MemoryBrowserPanel />);

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Python 编程")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockEmptySuccess());
    fireEvent.click(screen.getByRole("tab", { name: "知识碎片" }));

    await waitFor(() => {
      expect(screen.getByText("暂无知识碎片")).toBeInTheDocument();
    });
  });
});

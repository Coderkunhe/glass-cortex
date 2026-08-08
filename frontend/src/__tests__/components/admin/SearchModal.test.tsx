/**
 * SearchModal 组件测试。
 *
 * 覆盖：渲染/关闭、搜索过滤、键盘导航、交互、边界情况。
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { DocListItem, DocSearchResult as ApiDocSearchResult } from "@/lib/api/types";

// ── Mock API client — 默认返回空（Fuse fallback） ─────────────────

const { mockSearchDocs } = vi.hoisted(() => ({
  mockSearchDocs: vi.fn(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      searchDocs: (...args: unknown[]) => mockSearchDocs(...args),
    },
  };
});

import SearchModal from "@/components/admin/SearchModal";

afterEach(cleanup);

// ── 测试数据 ──────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DocListItem>): DocListItem {
  return {
    name: "test.md",
    path: "docs/test.md",
    group: "核心文档",
    size_bytes: 1024,
    mtime: "2026-08-08",
    lines: 100,
    ...overrides,
  };
}

const mockDocs: DocListItem[] = [
  makeDoc({
    name: "architecture.md",
    path: "docs/architecture.md",
    group: "核心文档",
    summary: "项目架构设计文档",
  }),
  makeDoc({
    name: "methodology.md",
    path: "docs/methodology.md",
    group: "核心文档",
    summary: "AI 辅助开发方法论",
  }),
  makeDoc({
    name: "pitfalls.md",
    path: "docs/pitfalls.md",
    group: "经验库",
    summary: "踩坑记录",
  }),
  makeDoc({
    name: "roadmap.md",
    path: "docs/roadmap.md",
    group: "治理看板",
    summary: "开发路线图",
  }),
  makeDoc({
    name: "daily-2026-08-08.md",
    path: "docs/daily/2026-08-08.md",
    group: "日报",
    summary: "今日工作总结",
  }),
];

const onClose = vi.fn();
const onSelectDoc = vi.fn();

function renderOpen(overrides?: Partial<{ docs: DocListItem[] }>) {
  const docs = overrides?.docs ?? mockDocs;
  return render(
    <SearchModal
      isOpen
      onClose={onClose}
      docs={docs}
      onSelectDoc={onSelectDoc}
    />,
  );
}

beforeEach(() => {
  onClose.mockClear();
  onSelectDoc.mockClear();
  mockSearchDocs.mockReset();
  mockSearchDocs.mockResolvedValue([]); // 默认返回空 → Fuse fallback
});

// ── 渲染 ──────────────────────────────────────────────────────────────

describe("rendering", () => {
  it("renders search input and results when open", () => {
    renderOpen();
    expect(screen.getByTestId("search-modal-input")).toBeInTheDocument();
    expect(screen.getByTestId("search-modal-results")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <SearchModal
        isOpen={false}
        onClose={onClose}
        docs={mockDocs}
        onSelectDoc={onSelectDoc}
      />,
    );
    expect(screen.queryByTestId("search-modal-input")).toBeNull();
  });

  it("shows docs in browse mode when query is empty", () => {
    renderOpen();
    // Should show at least one doc in browse mode
    const results = screen.getByTestId("search-modal-results");
    expect(results.children.length).toBeGreaterThan(0);
  });

  it("shows footer keyboard hints", () => {
    renderOpen();
    expect(screen.getByText("导航")).toBeInTheDocument();
    expect(screen.getByText("打开")).toBeInTheDocument();
    expect(screen.getByText("关闭")).toBeInTheDocument();
  });
});

// ── 搜索 ──────────────────────────────────────────────────────────────

describe("search", () => {
  it("filters results when typing", () => {
    renderOpen();
    const input = screen.getByTestId("search-modal-input");
    fireEvent.change(input, { target: { value: "architecture" } });
    const results = screen.getByTestId("search-modal-results");
    expect(results.children.length).toBe(1);
    expect(screen.getByText("architecture")).toBeInTheDocument();
  });

  it("shows empty state for no matches", () => {
    renderOpen();
    const input = screen.getByTestId("search-modal-input");
    fireEvent.change(input, { target: { value: "xyznonexistent" } });
    expect(screen.getByText("未找到匹配的文档")).toBeInTheDocument();
  });

  it("clears results when search is emptied", () => {
    renderOpen();
    const input = screen.getByTestId("search-modal-input");
    fireEvent.change(input, { target: { value: "arch" } });
    fireEvent.change(input, { target: { value: "" } });
    // Browse mode restored — should have results again
    const results = screen.getByTestId("search-modal-results");
    expect(results.children.length).toBeGreaterThan(0);
  });

  it("falls back to Fuse when API returns empty results", () => {
    mockSearchDocs.mockResolvedValue([]);
    renderOpen();
    const input = screen.getByTestId("search-modal-input");
    fireEvent.change(input, { target: { value: "architecture" } });
    // Fuse fallback — should find the architecture doc
    expect(screen.getByText("architecture")).toBeInTheDocument();
  });
});

// ── API 全文搜索 ─────────────────────────────────────────────────────

describe("api full-text search", () => {
  const apiResult: ApiDocSearchResult = {
    path: "docs/pitfalls.md",
    name: "pitfalls.md",
    group: "经验库",
    summary: "踩坑记录",
    snippet: "上下文溢出\n模拟引擎支持三种策略...\n详见 architecture.md",
    match_count: 3,
  };

  it("shows API search results with snippet", async () => {
    vi.useFakeTimers();
    mockSearchDocs.mockResolvedValue([apiResult]);
    renderOpen();

    const input = screen.getByTestId("search-modal-input");
    fireEvent.change(input, { target: { value: "溢出" } });

    // 跳过 200ms debounce → API resolve → React 批量更新
    await act(() => vi.advanceTimersByTimeAsync(250));

    // API 结果已渲染，同步断言（snippet 含换行，用 contains 匹配）
    expect(screen.getByText("pitfalls")).toBeInTheDocument();
    expect(screen.getByText("3 处匹配")).toBeInTheDocument();
    expect(screen.getByText(/上下文溢出/)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("shows loading spinner while API is fetching", () => {
    vi.useFakeTimers();
    // Promise never resolves — perpetually loading
    mockSearchDocs.mockReturnValue(new Promise(() => {}));
    renderOpen();

    const input = screen.getByTestId("search-modal-input");
    fireEvent.change(input, { target: { value: "溢出" } });

    // After debounce, searching = true, spinner shown
    act(() => vi.advanceTimersByTime(250));

    // The spinner icon class should include 'animate-spin'
    const spinnerSvg = document.querySelector(".animate-spin");
    expect(spinnerSvg).not.toBeNull();

    vi.useRealTimers();
  });

  it("keyboard Enter selects API result and closes modal", async () => {
    vi.useFakeTimers();
    mockSearchDocs.mockResolvedValue([apiResult]);
    renderOpen();

    const input = screen.getByTestId("search-modal-input");
    fireEvent.change(input, { target: { value: "溢出" } });

    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText("pitfalls")).toBeInTheDocument();

    const card = screen.getByRole("dialog");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelectDoc).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

// ── 键盘导航 ──────────────────────────────────────────────────────────

describe("keyboard navigation", () => {
  it("moves selection with ArrowDown", () => {
    renderOpen();
    const card = screen.getByRole("dialog");
    fireEvent.keyDown(card, { key: "ArrowDown" });
    // Second result should be selected
    const r1 = screen.getByTestId("search-result-1");
    expect(r1.className).toContain("bg-brand/8");
  });

  it("moves selection with ArrowUp", () => {
    renderOpen();
    const card = screen.getByRole("dialog");
    fireEvent.keyDown(card, { key: "ArrowDown" });
    fireEvent.keyDown(card, { key: "ArrowDown" });
    fireEvent.keyDown(card, { key: "ArrowUp" });
    // Should be back at index 1
    const r1 = screen.getByTestId("search-result-1");
    expect(r1.className).toContain("bg-brand/8");
  });

  it("ArrowDown clamps at bottom", () => {
    renderOpen();
    const card = screen.getByRole("dialog");
    // Press ArrowDown many times
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(card, { key: "ArrowDown" });
    }
    // Last result should be selected, not out of bounds
    const results = screen.getByTestId("search-modal-results");
    const lastIdx = results.children.length - 1;
    const last = screen.getByTestId(`search-result-${lastIdx}`);
    expect(last.className).toContain("bg-brand/8");
  });

  it("Enter triggers onSelectDoc and onClose", () => {
    renderOpen();
    const card = screen.getByRole("dialog");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onSelectDoc).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape triggers onClose", () => {
    renderOpen();
    // Escape is caught by the document-level handler, so fire on document
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── 交互 ──────────────────────────────────────────────────────────────

describe("interactions", () => {
  it("clicking result triggers onSelectDoc and onClose", () => {
    renderOpen();
    const firstResult = screen.getByTestId("search-result-0");
    fireEvent.click(firstResult);
    expect(onSelectDoc).toHaveBeenCalledTimes(1);
    expect(onSelectDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: mockDocs[0].path }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop triggers onClose", () => {
    renderOpen();
    const backdrop = screen.getByTestId("search-modal-backdrop");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("displays group badge on each result", () => {
    renderOpen();
    const badges = screen.getAllByText("核心文档");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows summary text in results", () => {
    renderOpen();
    expect(screen.getByText("项目架构设计文档")).toBeInTheDocument();
  });
});

// ── 边界情况 ──────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty docs array", () => {
    render(
      <SearchModal
        isOpen
        onClose={onClose}
        docs={[]}
        onSelectDoc={onSelectDoc}
      />,
    );
    expect(screen.getByText("暂无文档")).toBeInTheDocument();
  });

  it("handles doc with no summary", () => {
    const docs = [makeDoc({ name: "nosummary.md", summary: undefined })];
    renderOpen({ docs });
    expect(screen.getByText("nosummary")).toBeInTheDocument();
  });

  it("handles doc with special characters in name", () => {
    const docs = [
      makeDoc({
        name: "test-file-v2.1.0.md",
        path: "docs/test-file-v2.1.0.md",
      }),
    ];
    renderOpen({ docs });
    expect(screen.getByText("test-file-v2.1.0")).toBeInTheDocument();
  });

  it("strips .md extension from display name", () => {
    renderOpen();
    // Should display "architecture" not "architecture.md"
    expect(screen.getByText("architecture")).toBeInTheDocument();
  });
});

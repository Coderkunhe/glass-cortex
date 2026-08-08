import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type { DocListItem } from "@/lib/api/types";
import type { AdminTab } from "@/components/admin/AdminSidebar";

// ── Mock API (partial — keep other exports intact) ────────────────

const mockGetDocs = vi.fn();

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocs: (...args: unknown[]) => mockGetDocs(...args),
    },
  };
});

import DocsPanel from "@/components/admin/DocsPanel";

afterEach(cleanup);

// ── Test data ───────────────────────────────────────────────────────

const MOCK_DOCS: DocListItem[] = [
  // 普通文档文件
  {
    name: "architecture.md",
    path: "docs/architecture.md",
    group: "核心文档",
    size_bytes: 12345,
    mtime: "2026-08-07",
    lines: 200,
    summary: "系统架构设计文档",
  },
  {
    name: "methodology.md",
    path: "docs/methodology.md",
    group: "核心文档",
    size_bytes: 8900,
    mtime: "2026-08-06",
    lines: 150,
    // Intentionally no summary — to test "暂无说明" fallback
  },
  // 日报目录
  {
    name: "日报",
    path: "docs/daily",
    group: "日报",
    size_bytes: 0,
    mtime: "2026-08-07",
    lines: 0,
    is_directory: true,
    count: 30,
    children: [
      {
        name: "2026-08-07.md",
        path: "docs/daily/2026-08-07.md",
        group: "日报",
        size_bytes: 1024,
        mtime: "2026-08-07",
        lines: 50,
      },
      {
        name: "2026-08-06.md",
        path: "docs/daily/2026-08-06.md",
        group: "日报",
        size_bytes: 2048,
        mtime: "2026-08-06",
        lines: 80,
      },
    ],
  },
  // 需求日志目录
  {
    name: "需求日志",
    path: "docs/requirements-log.md",
    group: "需求日志",
    size_bytes: 5678,
    mtime: "2026-08-07",
    lines: 100,
    is_directory: true,
    count: 5,
  },
  // 经验库文档
  {
    name: "lessons-learned.md",
    path: "docs/lessons-learned.md",
    group: "经验库",
    size_bytes: 4500,
    mtime: "2026-08-05",
    lines: 80,
    summary: "可迁移通用经验沉淀",
  },
];

// ── Helpers ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocs.mockReset();
});

function renderPanel(props: {
  onSelectDoc?: (item: DocListItem) => void;
  onNavigate?: (tab: AdminTab) => void;
  filterGroup?: string | string[];
} = {}) {
  const onSelectDoc = props.onSelectDoc ?? vi.fn();
  const onNavigate = props.onNavigate ?? vi.fn();
  const result = render(
    <DocsPanel
      onSelectDoc={onSelectDoc}
      onNavigate={onNavigate}
      filterGroup={props.filterGroup}
    />,
  );
  return { onSelectDoc, onNavigate, ...result };
}

/** Find a group header button by its heading text, avoiding conflict with badge spans */
function getGroupHeader(name: string): HTMLElement {
  const headings = screen.getAllByRole("heading", { name });
  // Pick the first h3 (group header) — h4 would be a summary card title
  return headings.find((h) => h.tagName === "H3")!;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("DocsPanel", () => {
  describe("loading state", () => {
    it("shows skeletons while loading", () => {
      mockGetDocs.mockReturnValue(new Promise(() => {}));
      renderPanel();
      const skeletons = document.querySelectorAll(".gm-skeleton-shimmer");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("shows error message on fetch failure", async () => {
      mockGetDocs.mockRejectedValue(new Error("网络超时"));
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("文档清单加载失败")).toBeInTheDocument();
      });
      expect(screen.getByText("网络超时")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty message when no documents", async () => {
      mockGetDocs.mockResolvedValue([]);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("暂无文档")).toBeInTheDocument();
      });
    });
  });

  describe("data rendering", () => {
    it("renders doc groups sorted by GROUP_ORDER", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      // Use h3 headings for group titles — avoids badge span conflict
      await waitFor(() => {
        expect(getGroupHeader("核心文档")).toBeInTheDocument();
      });

      const groupHeaders = document.querySelectorAll("h3");
      const groupNames = Array.from(groupHeaders).map((h) => h.textContent);
      const coreIdx = groupNames.indexOf("核心文档");
      const lessonsIdx = groupNames.indexOf("经验库");
      const dailyIdx = groupNames.indexOf("日报");
      const reqIdx = groupNames.indexOf("需求日志");

      expect(coreIdx).toBeLessThan(lessonsIdx);
      expect(lessonsIdx).toBeLessThan(dailyIdx);
      expect(dailyIdx).toBeLessThan(reqIdx);
    });

    it("renders doc file cards with summaries", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("architecture")).toBeInTheDocument();
      });
      expect(screen.getByText("系统架构设计文档")).toBeInTheDocument();
    });

    it("shows '暂无说明' for docs without summary", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        // methodology.md has no summary → "暂无说明"
        expect(screen.getByText("暂无说明")).toBeInTheDocument();
      });
    });

    it("renders doc file card meta info (lines, size, date)", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("architecture")).toBeInTheDocument();
      });
      expect(screen.getByText("200 行")).toBeInTheDocument();
    });
  });

  describe("summary cards (日报 / 需求日志)", () => {
    it("renders summary card for daily group instead of file list", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        // "工作日报" is the SummaryCard title h4, unique text
        expect(screen.getByText("工作日报")).toBeInTheDocument();
      });
      expect(screen.getByText("查看日历")).toBeInTheDocument();
    });

    it("renders summary card for requirements-log group", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        // SummaryCard renders h4 with config.title — "需求日志"
        // It's distinct from the h3 group heading via heading level
        const h4s = screen.getAllByRole("heading", { level: 4 });
        expect(h4s.length).toBeGreaterThanOrEqual(1);
        expect(h4s.some((h) => h.textContent === "需求日志")).toBe(true);
        expect(screen.getByText("查看全部")).toBeInTheDocument();
      });
    });

    it("calls onNavigate when clicking summary card", async () => {
      const onNavigate = vi.fn();
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel({ onNavigate });

      await waitFor(() => {
        expect(screen.getByText("查看日历")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("查看日历").closest("button")!);
      expect(onNavigate).toHaveBeenCalledWith("daily");

      fireEvent.click(screen.getByText("查看全部").closest("button")!);
      expect(onNavigate).toHaveBeenCalledWith("requirements-log");
    });
  });

  describe("file click", () => {
    it("calls onSelectDoc when clicking a file card", async () => {
      const onSelectDoc = vi.fn();
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel({ onSelectDoc });

      await waitFor(() => {
        expect(screen.getByText("architecture")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("architecture").closest("button")!);
      expect(onSelectDoc).toHaveBeenCalledTimes(1);
      expect(onSelectDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: "docs/architecture.md" }),
      );
    });
  });

  describe("group expand/collapse", () => {
    it("collapses a group when clicking its header", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        expect(getGroupHeader("核心文档")).toBeInTheDocument();
      });

      // Click the h3 group header button (parent button)
      const headerBtn = getGroupHeader("核心文档").closest("button")!;
      fireEvent.click(headerBtn);

      // After collapse, the content (file cards) should be hidden
      await waitFor(() => {
        expect(screen.queryByText("architecture")).not.toBeInTheDocument();
      });
    });
  });

  describe("filterGroup prop", () => {
    it("filters to only matching group when filterGroup is a string", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel({ filterGroup: "日报" });

      // 日报 group renders with SummaryCard h4 "工作日报", not a file card
      await waitFor(() => {
        expect(screen.getByText("工作日报")).toBeInTheDocument();
      });

      // Should NOT show non-daily group headers
      expect(screen.queryByText("核心文档")).not.toBeInTheDocument();
      expect(screen.queryByText("经验库")).not.toBeInTheDocument();
    });

    it("filters to multiple groups when filterGroup is an array", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel({ filterGroup: ["核心文档", "经验库"] });

      // Only these two groups render — use h3 headings to avoid badge span conflict
      await waitFor(() => {
        expect(getGroupHeader("核心文档")).toBeInTheDocument();
        expect(getGroupHeader("经验库")).toBeInTheDocument();
      });

      // Should NOT show daily or requirements-log groups
      expect(screen.queryByText("工作日报")).not.toBeInTheDocument();
      expect(() => getGroupHeader("需求日志")).toThrow();
    });

    it("includes directory that has children matching filterGroup", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel({ filterGroup: "日报" });

      await waitFor(() => {
        expect(screen.getByText("工作日报")).toBeInTheDocument();
      });
      // The directory with children in "日报" group shows the summary card
      expect(screen.getByText("查看日历")).toBeInTheDocument();
    });
  });

  describe("directory row expand", () => {
    it("shows child docs when clicking expand on a directory row", async () => {
      const DOCS_WITH_DIR: DocListItem[] = [
        {
          name: "archive",
          path: "docs/archive",
          group: "其他",
          size_bytes: 0,
          mtime: "2026-08-01",
          lines: 0,
          is_directory: true,
          count: 3,
          children: [
            {
              name: "old-doc.md",
              path: "docs/archive/old-doc.md",
              group: "其他",
              size_bytes: 500,
              mtime: "2026-07-01",
              lines: 20,
            },
          ],
        },
      ];

      mockGetDocs.mockResolvedValue(DOCS_WITH_DIR);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("archive")).toBeInTheDocument();
      });

      // Click to expand the directory row (it starts collapsed for non-summary groups)
      fireEvent.click(screen.getByText("archive").closest("button")!);

      await waitFor(() => {
        expect(screen.getByText("old-doc.md")).toBeInTheDocument();
      });
    });
  });

  describe("inline search", () => {
    it("renders search input with placeholder", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();
      await waitFor(() => {
        expect(screen.getByTestId("docs-search-input")).toBeInTheDocument();
      });
      expect(screen.getByPlaceholderText("搜索文档...")).toBeInTheDocument();
    });

    it("filters documents by name when typing in search", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("architecture")).toBeInTheDocument();
      });

      const input = screen.getByTestId("docs-search-input");
      fireEvent.change(input, { target: { value: "lesson" } });

      // architecture should be filtered out, lessons-learned should remain
      await waitFor(() => {
        expect(screen.queryByText("architecture")).not.toBeInTheDocument();
      });
      expect(screen.getByText("lessons-learned")).toBeInTheDocument();
    });

    it("shows clear button when search has input", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByTestId("docs-search-input")).toBeInTheDocument();
      });

      const input = screen.getByTestId("docs-search-input");
      fireEvent.change(input, { target: { value: "test" } });

      const clearBtn = screen.getByLabelText("清除搜索");
      expect(clearBtn).toBeInTheDocument();
    });

    it("clears search when clear button is clicked", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByTestId("docs-search-input")).toBeInTheDocument();
      });

      const input = screen.getByTestId("docs-search-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "test" } });
      expect(input.value).toBe("test");

      fireEvent.click(screen.getByLabelText("清除搜索"));
      expect(input.value).toBe("");
    });

    it("shows empty search result message when no match", async () => {
      mockGetDocs.mockResolvedValue(MOCK_DOCS);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByTestId("docs-search-input")).toBeInTheDocument();
      });

      const input = screen.getByTestId("docs-search-input");
      fireEvent.change(input, { target: { value: "zzz_nonexistent_xyz" } });

      await waitFor(() => {
        expect(screen.getByText("未找到匹配的文档")).toBeInTheDocument();
      });
      expect(screen.getByText("试试其他关键词")).toBeInTheDocument();
    });
  });
});

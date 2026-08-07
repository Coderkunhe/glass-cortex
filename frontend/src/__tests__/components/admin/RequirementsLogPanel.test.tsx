import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import type { DocListItem, DocContentResponse } from "@/lib/api/types";

// ── Mock API (partial — keep other exports intact) ────────────────

const mockGetDocs = vi.fn();
const mockGetDocContent = vi.fn();

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocs: (...args: unknown[]) => mockGetDocs(...args),
      getDocContent: (...args: unknown[]) => mockGetDocContent(...args),
    },
  };
});

// Need to import after mock so the mocked module is resolved
import RequirementsLogPanel from "@/components/admin/RequirementsLogPanel";

afterEach(cleanup);

// ── Test data ───────────────────────────────────────────────────────

const MOCK_CONTENT: DocContentResponse = {
  name: "requirements-log.md",
  path: "docs/requirements-log.md",
  content: `# 需求日志

### 2026-08-07 — Phase 68 Batch 5 — Admin 面板打磨 ✅

- 需求内容 A
- 需求内容 B

### 2026-08-06 — Phase 67 Batch 10 — UI 优化 ✅

- 更早的需求
`,
  lines: 30,
};

const CURRENT_LOG: DocListItem = {
  name: "requirements-log.md",
  path: "docs/requirements-log.md",
  group: "需求日志",
  size_bytes: 5678,
  mtime: "2026-08-07",
  lines: 100,
};

const ARCHIVE_CHILDREN: DocListItem[] = [
  {
    name: "requirements-log-phase-67-10.md",
    path: "docs/archive/requirements-log-phase-67-10.md",
    group: "需求日志",
    size_bytes: 3400,
    mtime: "2026-08-06",
    lines: 80,
  },
  {
    name: "requirements-log-phase-66-8.md",
    path: "docs/archive/requirements-log-phase-66-8.md",
    group: "需求日志",
    size_bytes: 2100,
    mtime: "2026-08-01",
    lines: 50,
  },
];

const ARCHIVE_DIR: DocListItem = {
  name: "归档",
  path: "docs/archive",
  group: "需求日志",
  size_bytes: 0,
  mtime: "2026-08-07",
  lines: 0,
  is_directory: true,
  count: 2,
  children: ARCHIVE_CHILDREN,
};

function makeDocs(includeCurrent = true, includeArchive = true): DocListItem[] {
  const result: DocListItem[] = [];
  if (includeCurrent) result.push(CURRENT_LOG);
  if (includeArchive) result.push(ARCHIVE_DIR);
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocs.mockReset();
  mockGetDocContent.mockReset();
});

function renderPanel(onSelectDoc?: (item: DocListItem) => void) {
  const callback = onSelectDoc ?? vi.fn();
  return { onSelectDoc: callback, ...render(<RequirementsLogPanel onSelectDoc={callback} />) };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("RequirementsLogPanel", () => {
  describe("loading state", () => {
    it("shows skeleton placeholders while loading", () => {
      mockGetDocContent.mockReturnValue(new Promise(() => {}));
      mockGetDocs.mockReturnValue(new Promise(() => {}));
      renderPanel();
      const skeletons = document.querySelectorAll(".gm-skeleton-shimmer");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("shows error message on getDocs failure", async () => {
      // getDocContent resolves fine, but getDocs fails
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockRejectedValue(new Error("网络超时"));
      renderPanel();

      await waitFor(() => {
        // Error text is "加载失败：网络超时" (combined in one <p>)
        expect(screen.getByText(/加载失败：网络超时/)).toBeInTheDocument();
      });
    });

    it("still renders data when getDocContent fails (graceful degradation)", async () => {
      // getDocContent fails — shouldn't block the panel
      mockGetDocContent.mockRejectedValue(new Error("解析失败"));
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel();

      await waitFor(() => {
        // Panel renders with fallback Phase 66
        expect(screen.getByText("requirements-log")).toBeInTheDocument();
      });
      // Should show fallback phase label "Phase 66+"
      expect(screen.getByText(/Phase 66\+/)).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows '暂无需求日志' when no items found", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue([]);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("暂无需求日志")).toBeInTheDocument();
      });
    });
  });

  describe("data rendering", () => {
    it("renders current log as a highlighted card", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("requirements-log")).toBeInTheDocument();
      });
      // Current badge
      expect(screen.getByText("当前")).toBeInTheDocument();
      // Phase label from extracted content
      expect(screen.getByText(/Phase 68\+/)).toBeInTheDocument();
    });

    it("renders archive history list with Phase labels", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("requirements-log-phase-67-10.md")).toBeInTheDocument();
      });
      expect(screen.getByText("Phase 67-10")).toBeInTheDocument();
    });

    it("renders table header in archive section", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("阶段")).toBeInTheDocument();
        expect(screen.getByText("文件")).toBeInTheDocument();
        expect(screen.getByText("行数")).toBeInTheDocument();
        expect(screen.getByText("大小")).toBeInTheDocument();
        expect(screen.getByText("日期")).toBeInTheDocument();
      });
    });

    it("shows file meta info (lines, size, date) for archive items", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("requirements-log-phase-67-10.md")).toBeInTheDocument();
      });
      // 80 lines from the mock data
      expect(screen.getByText("80")).toBeInTheDocument();
    });

    it("shows roadmap with label '路线图'", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      // Roadmap must be reachable via the component's data collection:
      // it needs to be a child of the archive directory (group "需求日志")
      const docsWithRoadmap = makeDocs();
      const archiveDir = docsWithRoadmap.find(
        (d) => d.is_directory && d.group === "需求日志",
      )!;
      archiveDir.children = [
        ...(archiveDir.children ?? []),
        {
          name: "roadmap.md",
          path: "docs/archive/roadmap.md",
          group: "需求日志",
          size_bytes: 1200,
          mtime: "2026-08-07",
          lines: 60,
        },
      ];
      mockGetDocs.mockResolvedValue(docsWithRoadmap);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("路线图")).toBeInTheDocument();
      });
    });

    it("renders only current log card when archive directory has no children", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue([CURRENT_LOG]);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("requirements-log")).toBeInTheDocument();
      });
      // Current log card is rendered with "当前" badge
      expect(screen.getByText("当前")).toBeInTheDocument();
      // Archive table header still renders (component always shows it),
      // but there are no archive item rows
      const archiveRows = document.querySelectorAll(
        ".divide-y button",
      );
      expect(archiveRows.length).toBe(0);
    });
  });

  describe("extractLatestPhase integration", () => {
    it("renders Phase 66 fallback when content parse returns null", async () => {
      const contentWithPhase1000: DocContentResponse = {
        ...MOCK_CONTENT,
        content: "### 2026-08-07 — Phase 1000 Batch 137 — 治理 ✅\n",
      };
      mockGetDocContent.mockResolvedValue(contentWithPhase1000);
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel();

      await waitFor(() => {
        // Phase 1000 excluded → fallback to 66
        expect(screen.getByText(/Phase 66\+/)).toBeInTheDocument();
      });
    });

    it("uses extracted Phase from content for current label", async () => {
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT); // Phase 68
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText(/Phase 68\+/)).toBeInTheDocument();
      });
    });
  });

  describe("item click", () => {
    it("calls onSelectDoc when clicking current log card", async () => {
      const onSelectDoc = vi.fn();
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel(onSelectDoc);

      await waitFor(() => {
        expect(screen.getByText("requirements-log")).toBeInTheDocument();
      });

      // Click the current card button — the parent of the "当前" badge
      const currentCard = screen.getByText("当前").closest("button")!;
      fireEvent.click(currentCard);

      expect(onSelectDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: "docs/requirements-log.md" }),
      );
    });

    it("calls onSelectDoc when clicking an archive item", async () => {
      const onSelectDoc = vi.fn();
      mockGetDocContent.mockResolvedValue(MOCK_CONTENT);
      mockGetDocs.mockResolvedValue(makeDocs());
      renderPanel(onSelectDoc);

      await waitFor(() => {
        expect(screen.getByText("requirements-log-phase-67-10.md")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("requirements-log-phase-67-10.md").closest("button")!);

      expect(onSelectDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: "docs/archive/requirements-log-phase-67-10.md" }),
      );
    });
  });

  describe("cancelled fetch — no state update after unmount", () => {
    it("does not throw when unmounted during fetch", async () => {
      let resolveContent: (value: DocContentResponse) => void;
      let resolveDocs: (value: DocListItem[]) => void;
      const contentP = new Promise<DocContentResponse>((r) => { resolveContent = r; });
      const docsP = new Promise<DocListItem[]>((r) => { resolveDocs = r; });
      mockGetDocContent.mockReturnValue(contentP);
      mockGetDocs.mockReturnValue(docsP);

      const { unmount } = renderPanel();
      unmount();

      await act(async () => {
        resolveContent!(MOCK_CONTENT);
        resolveDocs!(makeDocs());
      });
      // No throw = cancelled flag works
    });
  });
});

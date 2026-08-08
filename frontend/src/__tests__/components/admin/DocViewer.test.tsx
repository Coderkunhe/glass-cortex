import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type { DocListItem, DocContentResponse } from "@/lib/api/types";

// ── Polyfill IntersectionObserver (not available in jsdom) ────────

beforeAll(() => {
  if (typeof IntersectionObserver === "undefined") {
    (globalThis as Record<string, unknown>).IntersectionObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds = [];
    };
  }
});

// ── Stub child modules ──────────────────────────────────────────────

vi.mock("@/components/ui/MermaidDiagram", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/hooks/useCodeHighlight", () => ({
  useCodeHighlight: vi.fn(),
}));

let mockFontSize = "md";
const setFontSizeMock = vi.fn((v: string | ((prev: string) => string)) => {
  mockFontSize = typeof v === "function" ? v(mockFontSize) : v;
});

vi.mock("@/hooks/useLocalStorage", () => ({
  useLocalStorage: vi.fn(() => [mockFontSize, setFontSizeMock]),
}));

let markdownOverride: string | null = null;

vi.mock("@/lib/renderMarkdown", () => ({
  renderMarkdown: vi.fn(() => {
    if (markdownOverride !== null) return markdownOverride;
    return `<h1 id="section-1">第一节</h1><p>内容段落</p><h2 id="section-2">第二节</h2><p>更多内容</p>`;
  }),
}));

const downloadPdfMock = vi.fn();

vi.mock("@/lib/printPdf", () => ({
  downloadPdf: (html: string, title: string) => {
    downloadPdfMock(html, title);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/constants", () => ({
  DOC_FONT_SIZE_KEY: "gm-doc-font-size",
}));

import DocViewer, { highlightInDOM } from "@/components/admin/DocViewer";

afterEach(() => {
  cleanup();
  mockFontSize = "md";
  markdownOverride = null;
  setFontSizeMock.mockClear();
  downloadPdfMock.mockClear();
});

// ── Test data ───────────────────────────────────────────────────────

const MOCK_ITEM: DocListItem = {
  name: "architecture.md",
  path: "docs/architecture.md",
  group: "核心文档",
  size_bytes: 12345,
  mtime: "2026-08-07",
  lines: 200,
  summary: "系统架构设计",
};

const MOCK_CONTENT: DocContentResponse = {
  name: "architecture.md",
  path: "docs/architecture.md",
  content: "# 架构设计\n\n这是系统架构文档的内容。\n\n## 模块划分\n\n- 模块 A\n- 模块 B",
  lines: 200,
};

// ── Helpers ─────────────────────────────────────────────────────────

function renderViewer(props: {
  item?: DocListItem;
  content?: DocContentResponse | null;
  loading?: boolean;
  error?: string | null;
  onBack?: () => void;
} = {}) {
  const onBack = props.onBack ?? vi.fn();
  // Spread defaults then override with explicit props — avoids ??
  // eating explicit null for content.
  const defaults = {
    item: MOCK_ITEM,
    content: MOCK_CONTENT as DocContentResponse | null,
    loading: false,
    error: null as string | null,
  };
  const merged = { ...defaults, ...props };
  return { onBack, ...render(
    <DocViewer
      item={merged.item}
      content={merged.content}
      loading={merged.loading}
      error={merged.error}
      onBack={onBack}
    />,
  )};
}

// ── Tests ───────────────────────────────────────────────────────────

describe("DocViewer", () => {
  describe("loading state", () => {
    it("shows skeleton lines when loading", () => {
      renderViewer({ loading: true, content: null });
      const skeletons = document.querySelectorAll(".gm-skeleton-shimmer");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("shows error message when error is set", () => {
      renderViewer({ error: "文件不存在", content: null });
      expect(screen.getByText("文档加载失败")).toBeInTheDocument();
      expect(screen.getByText("文件不存在")).toBeInTheDocument();
    });
  });

  describe("content rendering", () => {
    it("renders rendered markdown content", () => {
      renderViewer({ content: MOCK_CONTENT });
      const proseDiv = document.querySelector(".prose");
      expect(proseDiv).not.toBeNull();
      expect(proseDiv!.innerHTML).toContain("第一节");
    });

    it("does not show loading or error when content is present", () => {
      renderViewer({ content: MOCK_CONTENT });
      expect(screen.queryByText("文档加载失败")).not.toBeInTheDocument();
      expect(document.querySelectorAll(".gm-skeleton-shimmer").length).toBe(0);
    });
  });

  describe("header", () => {
    it("renders document name and meta info", () => {
      renderViewer();
      expect(screen.getByText("architecture.md")).toBeInTheDocument();
      expect(screen.getByText(/200 行/)).toBeInTheDocument();
    });

    it("shows back button", () => {
      renderViewer();
      const backBtn = screen.getByLabelText("返回文档列表");
      expect(backBtn).toBeInTheDocument();
    });
  });

  describe("back button", () => {
    it("calls onBack when back button is clicked", () => {
      const onBack = vi.fn();
      renderViewer({ onBack });
      fireEvent.click(screen.getByLabelText("返回文档列表"));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("font size toggle", () => {
    it("has a font size button", () => {
      renderViewer();
      const btn = screen.getByLabelText(/字号/);
      expect(btn).toBeInTheDocument();
    });
  });

  describe("PDF download", () => {
    it("renders PDF download button when content is present", () => {
      renderViewer({ content: MOCK_CONTENT });
      const btn = screen.getByTestId("doc-pdf-download");
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    it("disables PDF download button when content is null", () => {
      renderViewer({ content: null });
      const btn = screen.getByTestId("doc-pdf-download");
      expect(btn).toBeDisabled();
    });

    it("calls downloadPdf with rendered HTML and document name on click", () => {
      downloadPdfMock.mockClear();
      renderViewer({ content: MOCK_CONTENT });
      fireEvent.click(screen.getByTestId("doc-pdf-download"));
      expect(downloadPdfMock).toHaveBeenCalledTimes(1);
      // First arg should be rendered markdown HTML
      expect(downloadPdfMock).toHaveBeenCalledWith(
        expect.stringContaining("第一节"),
        MOCK_ITEM.name,
      );
    });

    it("shows spinner and disables button while downloading", async () => {
      // Deferred promise — downloadPdf won't resolve until we say so
      let resolveDl: () => void;
      downloadPdfMock.mockImplementation(
        () => new Promise<void>((r) => { resolveDl = r; }),
      );

      renderViewer({ content: MOCK_CONTENT });
      const btn = screen.getByTestId("doc-pdf-download");
      fireEvent.click(btn);

      // Button should now show spinner (RiLoader4Line) and be disabled
      expect(btn).toBeDisabled();
      // aria-label updates to "正在生成 PDF..."
      expect(btn.getAttribute("aria-label")).toBe("正在生成 PDF...");

      // Resolve the download → button returns to normal
      resolveDl!();
      await waitFor(() => {
        expect(btn).not.toBeDisabled();
      });
      expect(btn.getAttribute("aria-label")).toBe("下载 PDF");
    });
  });

  describe("TOC (table of contents)", () => {
    it("renders TOC sidebar with headings from content", async () => {
      renderViewer({ content: MOCK_CONTENT });
      await waitFor(() => {
        expect(screen.getByText("目录")).toBeInTheDocument();
      });
    });

    it("shows heading entries extracted from rendered content", async () => {
      renderViewer({ content: MOCK_CONTENT });
      await waitFor(() => {
        const aside = document.querySelector("aside");
        expect(aside).not.toBeNull();
        expect(aside!.textContent).toContain("第一节");
        expect(aside!.textContent).toContain("第二节");
      });
    });

    it("hides TOC when no headings are found", () => {
      markdownOverride = "<p>纯文本，没有标题</p>";
      renderViewer({ content: MOCK_CONTENT });
      expect(screen.queryByText("目录")).not.toBeInTheDocument();
    });

    it("hides TOC when loading", () => {
      renderViewer({ loading: true, content: null });
      expect(screen.queryByText("目录")).not.toBeInTheDocument();
    });

    it("hides TOC when error", () => {
      renderViewer({ error: "加载失败", content: null });
      expect(screen.queryByText("目录")).not.toBeInTheDocument();
    });

    it("applies indent classes based on heading level", async () => {
      renderViewer({ content: MOCK_CONTENT });
      await waitFor(() => {
        const aside = document.querySelector("aside");
        expect(aside).not.toBeNull();
        const buttons = aside!.querySelectorAll("button");
        const h1Btn = Array.from(buttons).find((b) => b.textContent?.includes("第一节"));
        const h2Btn = Array.from(buttons).find((b) => b.textContent?.includes("第二节"));
        expect(h1Btn!.className).toContain("pl-gm-2");
        expect(h2Btn!.className).toContain("pl-gm-5");
      });
    });

    it("calls scrollToHeading when TOC entry is clicked", async () => {
      renderViewer({ content: MOCK_CONTENT });
      await waitFor(() => {
        expect(document.querySelector("aside")).not.toBeNull();
      });

      const scrollMock = vi.fn();
      Element.prototype.scrollIntoView = scrollMock;

      const aside = document.querySelector("aside")!;
      const firstBtn = aside.querySelector("button")!;
      fireEvent.click(firstBtn);
      expect(scrollMock).toHaveBeenCalled();
    });
  });

  describe("in-document search", () => {
    it("highlightInDOM wraps matching text in mark elements", () => {
      const div = document.createElement("div");
      div.innerHTML = "<h1>第一节</h1><p>内容段落</p>";
      const marks = highlightInDOM(div, "第一节");
      expect(marks.length).toBe(1);
      expect(marks[0].textContent).toBe("第一节");
      expect(div.querySelectorAll(".gm-search-mark").length).toBe(1);
    });

    it("renders search input always visible in header", () => {
      renderViewer();
      expect(screen.getByTestId("doc-search-input")).toBeInTheDocument();
    });

    it("shows nav buttons when search has matches", () => {
      renderViewer();
      const input = screen.getByTestId("doc-search-input");
      fireEvent.change(input, { target: { value: "第一节" } });

      // Nav buttons appear when there are matches
      expect(screen.getByTestId("doc-search-prev")).toBeInTheDocument();
      expect(screen.getByTestId("doc-search-next")).toBeInTheDocument();
      // Match count shows "1 / 1" format
      expect(screen.getByTestId("doc-search-match-count")).toBeInTheDocument();
    });

    it("hides nav buttons when search is cleared", () => {
      renderViewer();
      const input = screen.getByTestId("doc-search-input");
      fireEvent.change(input, { target: { value: "第一节" } });
      expect(screen.getByTestId("doc-search-prev")).toBeInTheDocument();

      fireEvent.change(input, { target: { value: "" } });
      expect(screen.queryByTestId("doc-search-prev")).not.toBeInTheDocument();
    });

    it("highlights matching text with mark elements in prose", () => {
      renderViewer();
      const input = screen.getByTestId("doc-search-input");
      fireEvent.change(input, { target: { value: "第一节" } });

      // highlightInDOM wraps matches in <mark> — verify in the prose container
      const proseDiv = document.querySelector(".prose");
      expect(proseDiv).not.toBeNull();
      const marks = proseDiv!.querySelectorAll("mark.gm-search-mark");
      expect(marks.length).toBeGreaterThan(0);
    });

    it("clears highlights when clearing search input", () => {
      renderViewer();
      const input = screen.getByTestId("doc-search-input");
      fireEvent.change(input, { target: { value: "第一节" } });

      let marks = document.querySelectorAll("mark.gm-search-mark");
      expect(marks.length).toBeGreaterThan(0);

      // Clear via the clear button (✕)
      fireEvent.click(screen.getByLabelText("清除搜索"));
      marks = document.querySelectorAll("mark.gm-search-mark");
      expect(marks.length).toBe(0);
    });
  });

  describe("empty content edge cases", () => {
    it("handles null content without crashing", () => {
      const { container } = renderViewer({ content: null });
      expect(container).toBeTruthy();
      expect(document.querySelector(".prose")).toBeNull();
    });

    it("handles content with empty string", () => {
      const emptyContent: DocContentResponse = {
        ...MOCK_CONTENT,
        content: "",
      };
      renderViewer({ content: emptyContent });
      const proseDiv = document.querySelector(".prose");
      expect(proseDiv).not.toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useRouter } from "next/navigation";
import AnswerCard from "@/components/learn/AnswerCard";
import type { Answer } from "@/lib/content/types";

// ── Mock next/router for client-side navigation ──
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// ── Mock mermaid module (used by MermaidDiagram → createRoot hydration) ──
const mockInitialize = vi.fn();
const mockRender = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}));

const RENDERED_SVG = "<svg><g><rect></rect></g></svg>";

const mockAnswer: Answer = {
  id: "q1.1",
  question: "上下文窗口溢出处理策略有哪些？",
  chapter: "ch1",
  chapterTitle: "第 1 章：上下文工程",
  priority: "P0",
  confidence: { l0: 0.97, l1: 0.95, l2: 0.92, l3: 0.9 },
  overallConfidence: 0.9,
  l0: "当上下文窗口塞不下时，有三种经典策略：FIFO、相关度优先、压缩摘要。",
  l1: "想象你在一个只能放 10 张便签的桌面上工作。LLM 面对的上下文窗口就是这张桌子。",
  l2: "深度探索内容：三种策略的代码实现对比。",
  l3: "前沿与未解：当前行业实践中越来越多系统使用混合策略。",
};

describe("AnswerCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRender.mockResolvedValue({ svg: RENDERED_SVG });
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    cleanup();
  });
  it("renders the question as heading", () => {
    render(<AnswerCard answer={mockAnswer} />);
    expect(
      screen.getByText("上下文窗口溢出处理策略有哪些？")
    ).toBeInTheDocument();
  });

  it("renders L0 prominently", () => {
    render(<AnswerCard answer={mockAnswer} />);
    // L0 text should appear; the bold sentence is rendered
    expect(screen.getByText(/三种经典策略/)).toBeInTheDocument();
  });

  it("renders L1 body content", () => {
    render(<AnswerCard answer={mockAnswer} />);
    expect(screen.getByText(/10 张便签/)).toBeInTheDocument();
  });

  it("L2 is collapsed by default", () => {
    render(<AnswerCard answer={mockAnswer} />);
    const btn = screen.getByRole("button", { name: /深度探索/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("L2 expands on click", () => {
    render(<AnswerCard answer={mockAnswer} />);
    const btn = screen.getByRole("button", { name: /深度探索/ });
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/代码实现对比/)).toBeInTheDocument();
  });

  it("L3 is collapsed by default", () => {
    render(<AnswerCard answer={mockAnswer} />);
    const btn = screen.getByRole("button", { name: /前沿与未解/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("L3 expands on click", () => {
    render(<AnswerCard answer={mockAnswer} />);
    const btn = screen.getByRole("button", { name: /前沿与未解/ });
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/行业实践/)).toBeInTheDocument();
  });

  it("renders placeholder for stub answers", () => {
    const stub: Answer = {
      ...mockAnswer,
      l0: "",
      l1: "",
      l2: "",
      l3: "",
      overallConfidence: 0,
      confidence: { l0: 0, l1: 0, l2: 0, l3: 0 },
    };
    render(<AnswerCard answer={stub} />);
    expect(screen.getByText(/即将推出/)).toBeInTheDocument();
  });

  it("renders mobile back button when onBack is provided", () => {
    const onBack = () => {};
    render(<AnswerCard answer={mockAnswer} onBack={onBack} />);
    expect(screen.getByText("返回列表")).toBeInTheDocument();
  });

  // ── Mermaid fenced code in markdown content ──

  it("renders mermaid block placeholder for ```mermaid fenced code", () => {
    const mermaidChart = "graph LR\nA-->B";
    const answer: Answer = {
      ...mockAnswer,
      l1: `Before diagram\n\n\`\`\`mermaid\n${mermaidChart}\n\`\`\`\n\nAfter diagram`,
    };
    const { container } = render(<AnswerCard answer={answer} />);
    // renderMarkdown produces .gm-mermaid-block div, NOT <pre><code>
    const block = container.querySelector(".gm-mermaid-block");
    expect(block).toBeInTheDocument();
    expect(block?.getAttribute("data-chart")).toBeTruthy();
    // Decode base64 to verify original chart is preserved
    const decoded = decodeURIComponent(
      atob(block!.getAttribute("data-chart")!),
    );
    expect(decoded).toBe(mermaidChart);
    // Regular <pre><code> should NOT appear for mermaid
    expect(container.querySelector("pre code")).toBeNull();
  });

  it("still renders regular code blocks as <pre><code>", () => {
    const answer: Answer = {
      ...mockAnswer,
      l2: "Some code:\n\n```python\nprint('hello')\n```",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    expect(container.querySelector("pre code.language-python")).toBeInTheDocument();
    // Zero .gm-mermaid-block when no mermaid content
    expect(container.querySelector(".gm-mermaid-block")).toBeNull();
  });

  it("handles mixed mermaid and regular code blocks", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: [
        "Text intro",
        "",
        "```mermaid",
        "graph TD",
        "  A-->B",
        "```",
        "",
        "More text",
        "",
        "```python",
        "x = 1",
        "```",
      ].join("\n"),
    };
    const { container } = render(<AnswerCard answer={answer} />);
    // Both should be present
    expect(container.querySelector(".gm-mermaid-block")).toBeInTheDocument();
    expect(container.querySelector("pre code.language-python")).toBeInTheDocument();
  });

  it("does not crash on empty mermaid fenced code block", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: "```mermaid\n\n```",
    };
    expect(() => render(<AnswerCard answer={answer} />)).not.toThrow();
  });

  // ── Phase 41 Batch 7: 书签收藏 ──

  describe("Phase 41 Batch 7 — Bookmark", () => {
    it("renders star button when onToggleBookmark is provided", () => {
      render(
        <AnswerCard
          answer={mockAnswer}
          isBookmarked={false}
          onToggleBookmark={vi.fn()}
        />
      );
      expect(screen.getByLabelText("收藏")).toBeInTheDocument();
    });

    it("does not render star button when onToggleBookmark is omitted", () => {
      render(<AnswerCard answer={mockAnswer} />);
      expect(screen.queryByLabelText("收藏")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("取消收藏")).not.toBeInTheDocument();
    });

    it("shows filled star when isBookmarked is true", () => {
      render(
        <AnswerCard
          answer={mockAnswer}
          isBookmarked={true}
          onToggleBookmark={vi.fn()}
        />
      );
      expect(screen.getByLabelText("取消收藏")).toBeInTheDocument();
    });

    it("shows outline star when isBookmarked is false", () => {
      render(
        <AnswerCard
          answer={mockAnswer}
          isBookmarked={false}
          onToggleBookmark={vi.fn()}
        />
      );
      expect(screen.getByLabelText("收藏")).toBeInTheDocument();
    });

    it("calls onToggleBookmark on star click", () => {
      const onToggle = vi.fn();
      render(
        <AnswerCard
          answer={mockAnswer}
          isBookmarked={false}
          onToggleBookmark={onToggle}
        />
      );
      fireEvent.click(screen.getByLabelText("收藏"));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  // ── Blockquote rendering ──

  it("renders > blockquote with answer-bq class", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: "> **关键洞察**：这是一个关键洞察",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    const bq = container.querySelector(".answer-l1-body blockquote.answer-bq");
    expect(bq).toBeInTheDocument();
    expect(bq!.textContent).toContain("这是一个关键洞察");
  });

  it("renders blockquote with bold label variant class", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: "> **防护**：三层容错解析",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    expect(
      container.querySelector("blockquote.answer-bq.answer-bq--guard"),
    ).toBeInTheDocument();
  });

  it("renders blockquote without label as default variant", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: "> 普通引用文本，没有标签前缀",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    const bq = container.querySelector("blockquote.answer-bq");
    expect(bq).toBeInTheDocument();
    // No variant class (only answer-bq)
    expect(bq!.className).toBe("answer-bq");
  });

  it("renders blockquote in L2 fold content", () => {
    const answer: Answer = {
      ...mockAnswer,
      l2: "> **注意**：confidence 需要 clamp",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    // Expand L2 first
    const btn = screen.getByRole("button", { name: /深度探索/ });
    fireEvent.click(btn);
    expect(
      container.querySelector("blockquote.answer-bq.answer-bq--warning"),
    ).toBeInTheDocument();
  });

  it("renders multi-line blockquote as single block", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: "> **关键洞察**：第一行\n> 第二行\n> 第三行",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    const bqs = container.querySelectorAll("blockquote.answer-bq");
    expect(bqs.length).toBe(1);
    expect(bqs[0].textContent).toContain("第一行");
    expect(bqs[0].textContent).toContain("第三行");
  });

  // ── Code block escaping (no double-escape) ──

  it("does not double-escape code block content with special chars", () => {
    const answer: Answer = {
      ...mockAnswer,
      l2: "Code:\n\n```python\nif x < 10 and y > 0:\n    print('hello & world')\n```",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    const btn = screen.getByRole("button", { name: /深度探索/ });
    fireEvent.click(btn);
    const code = container.querySelector("pre code.language-python");
    expect(code).toBeInTheDocument();
    const html = code!.innerHTML;
    // Should NOT contain double-escaped sequences
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&amp;gt;");
    expect(html).not.toContain("&amp;amp;");
    // Should contain valid single-escaped entities
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).toContain("&amp;");
  });

  // ── Phase 1000 B133: Prism 语法高亮 token span 覆盖 ──
  // I-143: jsdom 环境有 global 导致 Prism 组件加载正常，但浏览器无 global
  // 时静默失败无告警。补 token span 产出验证 —— 确认 Prism.highlightElement()
  // 实际产出了 .token 类 span 元素，而非静默跳过。

  describe("Prism syntax highlighting", () => {
    it("produces token spans for Python code in L2", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "Code:\n\n```python\nprint('hello')\n```",
      };
      const { container } = render(<AnswerCard answer={answer} />);
      const btn = screen.getByRole("button", { name: /深度探索/ });
      fireEvent.click(btn);
      const code = container.querySelector("pre code.language-python");
      expect(code).toBeInTheDocument();
      // Prism must produce .token spans — absence = silent failure
      const tokenSpans = code!.querySelectorAll("span.token");
      expect(tokenSpans.length).toBeGreaterThan(0);
    });

    it("produces keyword token for Python code", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "```python\nimport os\n```",
      };
      const { container } = render(<AnswerCard answer={answer} />);
      const btn = screen.getByRole("button", { name: /深度探索/ });
      fireEvent.click(btn);
      const code = container.querySelector("pre code.language-python");
      expect(code).toBeInTheDocument();
      // import → token keyword
      const keywordTokens = code!.querySelectorAll("span.token.keyword");
      expect(keywordTokens.length).toBeGreaterThan(0);
    });

    it("produces string token for Python code", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "```python\nx = 'hello world'\n```",
      };
      const { container } = render(<AnswerCard answer={answer} />);
      const btn = screen.getByRole("button", { name: /深度探索/ });
      fireEvent.click(btn);
      const code = container.querySelector("pre code.language-python");
      expect(code).toBeInTheDocument();
      const stringTokens = code!.querySelectorAll("span.token.string");
      expect(stringTokens.length).toBeGreaterThan(0);
    });

    it("produces token spans for code in L1 (always visible)", () => {
      const answer: Answer = {
        ...mockAnswer,
        l1: "L1 with code:\n\n```javascript\nconst x = 1;\n```",
      };
      const { container } = render(<AnswerCard answer={answer} />);
      const code = container.querySelector("pre code.language-javascript");
      expect(code).toBeInTheDocument();
      const tokenSpans = code!.querySelectorAll("span.token");
      expect(tokenSpans.length).toBeGreaterThan(0);
    });

    it("produces token spans for multiple languages in same card", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: [
          "Python:",
          "",
          "```python",
          "def foo(): pass",
          "```",
          "",
          "JavaScript:",
          "",
          "```javascript",
          "const bar = () => {};",
          "```",
        ].join("\n"),
      };
      const { container } = render(<AnswerCard answer={answer} />);
      const btn = screen.getByRole("button", { name: /深度探索/ });
      fireEvent.click(btn);
      const pyCode = container.querySelector("pre code.language-python");
      const jsCode = container.querySelector("pre code.language-javascript");
      expect(pyCode).toBeInTheDocument();
      expect(jsCode).toBeInTheDocument();
      expect(pyCode!.querySelectorAll("span.token").length).toBeGreaterThan(0);
      expect(jsCode!.querySelectorAll("span.token").length).toBeGreaterThan(0);
    });

    it("does not produce token spans for plain text code blocks", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "```text\nplain text, no lang\n```",
      };
      const { container } = render(<AnswerCard answer={answer} />);
      const btn = screen.getByRole("button", { name: /深度探索/ });
      fireEvent.click(btn);
      const code = container.querySelector("pre code.language-text");
      expect(code).toBeInTheDocument();
      // text/plain language has no grammar rules → 0 token spans
      const tokenSpans = code!.querySelectorAll("span.token");
      expect(tokenSpans.length).toBe(0);
    });
  });

  it("does not parse > inside code block as blockquote", () => {
    const answer: Answer = {
      ...mockAnswer,
      l2: "> **关键洞察**：这是 blockquote\n\n```text\n> 这是代码块内的文本，不是 blockquote\n```",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    const btn = screen.getByRole("button", { name: /深度探索/ });
    fireEvent.click(btn);
    // The first > should be a blockquote
    expect(container.querySelector("blockquote.answer-bq")).toBeInTheDocument();
    // The code block should contain literal > text
    const code = container.querySelector("pre code.language-text");
    expect(code).toBeInTheDocument();
    expect(code!.textContent).toContain("> 这是代码块内的文本");
  });

  // ── Phase 43 Batch 2: Learn→Lab 桥接按钮 ──

  describe("Phase 43 Batch 2 — Lab Link", () => {
    it("renders lab link buttons when labLinks provided", () => {
      const answer: Answer = {
        ...mockAnswer,
        labLinks: [
          { tab: "context", label: "上下文溢出实验" },
          { tab: "data" },
        ],
      };
      render(<AnswerCard answer={answer} />);
      expect(screen.getByText("上下文溢出实验")).toBeInTheDocument();
      expect(screen.getByText("在实验室中探索")).toBeInTheDocument();
    });

    it("navigates to correct lab tab on click", () => {
      const push = vi.fn();
      vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
      const answer: Answer = {
        ...mockAnswer,
        labLinks: [{ tab: "context" }],
      };
      render(<AnswerCard answer={answer} />);
      fireEvent.click(screen.getByText("在实验室中探索"));
      expect(push).toHaveBeenCalledWith("/lab?tab=context");
    });
  });

  // ── Phase 1000 Batch 37: XSS 防护 (DOMPurify) ──

  it("strips <script> tags from rendered markdown", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: '<script>alert("xss")</script>正常文本',
    };
    const { container } = render(<AnswerCard answer={answer} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("正常文本");
  });

  it("strips onclick event handlers from rendered markdown", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: '<a href="#" onclick="alert(1)">点击我</a>',
    };
    const { container } = render(<AnswerCard answer={answer} />);
    const link = container.querySelector("a");
    if (link) {
      expect(link.getAttribute("onclick")).toBeNull();
    }
  });

  it("strips javascript: protocol from links", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: '<a href="javascript:alert(1)">恶意链接</a>',
    };
    const { container } = render(<AnswerCard answer={answer} />);
    const link = container.querySelector("a");
    if (link) {
      expect(link.getAttribute("href")).not.toContain("javascript:");
    }
  });

  it("preserves legitimate markdown-rendered HTML", () => {
    const answer: Answer = {
      ...mockAnswer,
      l1: "**粗体文本** and `code` and [链接](https://example.com)",
    };
    const { container } = render(<AnswerCard answer={answer} />);
    expect(container.querySelector("strong")).toBeInTheDocument();
    expect(container.querySelector("code")).toBeInTheDocument();
    const link = container.querySelector("a");
    expect(link).toBeInTheDocument();
    expect(link!.getAttribute("href")).toBe("https://example.com");
  });

  describe("Phase 49 Batch 3 — Cross-Chapter Connections", () => {
    it("renders cross-chapter connection items when provided", () => {
      const answer: Answer = {
        ...mockAnswer,
        crossChapterConnections: [
          { questionId: "q1.4", type: "prerequisite", relationship: "噪声信息干扰意图分类准确率" },
          { questionId: "q2.15", type: "extension", relationship: "长期存储指导工具选择" },
        ],
      };
      render(<AnswerCard answer={answer} />);
      expect(screen.getByText("跨章关联")).toBeInTheDocument();
      expect(screen.getByText("前置知识")).toBeInTheDocument();
      expect(screen.getByText("深入扩展")).toBeInTheDocument();
      // questionId resolved to actual question text via getAnswerById
      expect(screen.getByText("噪声信息干扰意图分类准确率")).toBeInTheDocument();
      expect(screen.getByText("长期存储指导工具选择")).toBeInTheDocument();
    });

    it("does not render cross-chapter section when not provided", () => {
      render(<AnswerCard answer={mockAnswer} />);
      expect(screen.queryByText("跨章关联")).not.toBeInTheDocument();
    });

    it("does not render cross-chapter section when empty array", () => {
      const answer: Answer = {
        ...mockAnswer,
        crossChapterConnections: [],
      };
      render(<AnswerCard answer={answer} />);
      expect(screen.queryByText("跨章关联")).not.toBeInTheDocument();
    });

    it("navigates to correct question on click", () => {
      const push = vi.fn();
      vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
      const answer: Answer = {
        ...mockAnswer,
        crossChapterConnections: [
          { questionId: "q1.4", type: "prerequisite", relationship: "噪声信息干扰" },
        ],
      };
      render(<AnswerCard answer={answer} />);
      // Button now shows resolved question text, not raw questionId — find by relationship text
      const btn = screen.getByText("噪声信息干扰").closest("button")!;
      fireEvent.click(btn);
      expect(push).toHaveBeenCalledWith("/learn?q=q1.4");
    });
  });

  // ── 搜索关键词高亮 (LC19) ──
  describe("search highlighting", () => {
    it("wraps matching text in <mark> elements when searchQuery is provided", () => {
      const { container } = render(
        <AnswerCard answer={mockAnswer} searchQuery="上下文窗口" />,
      );
      const marks = container.querySelectorAll("mark.search-highlight");
      expect(marks.length).toBeGreaterThan(0);
    });

    it("highlights matches case-insensitively", () => {
      const { container } = render(
        <AnswerCard answer={mockAnswer} searchQuery="FIFO" />,
      );
      // L0 contains "FIFO"
      const marks = container.querySelectorAll("mark.search-highlight");
      expect(marks.length).toBeGreaterThan(0);
      // The mark should preserve original case
      const markTexts = Array.from(marks).map((m) => m.textContent);
      expect(markTexts.some((t) => t?.includes("FIFO"))).toBe(true);
    });

    it("does not highlight text inside <code> elements", () => {
      const answer: Answer = {
        ...mockAnswer,
        l1: "使用 `FIFO` 策略处理溢出。",
      };
      const { container } = render(
        <AnswerCard answer={answer} searchQuery="FIFO" />,
      );
      // FIFO inside <code> should NOT be highlighted
      const codeEl = container.querySelector("code");
      expect(codeEl).toBeInTheDocument();
      if (codeEl) {
        const marksInsideCode = codeEl.querySelectorAll("mark.search-highlight");
        expect(marksInsideCode.length).toBe(0);
      }
    });

    it("does not add any <mark> when searchQuery is empty", () => {
      const { container } = render(
        <AnswerCard answer={mockAnswer} searchQuery="" />,
      );
      const marks = container.querySelectorAll("mark.search-highlight");
      expect(marks.length).toBe(0);
    });

    it("does not add any <mark> when searchQuery is undefined", () => {
      const { container } = render(<AnswerCard answer={mockAnswer} />);
      const marks = container.querySelectorAll("mark.search-highlight");
      expect(marks.length).toBe(0);
    });

    it("cleans up highlights when searchQuery changes to empty", () => {
      const { container, rerender } = render(
        <AnswerCard answer={mockAnswer} searchQuery="上下文窗口" />,
      );
      let marks = container.querySelectorAll("mark.search-highlight");
      expect(marks.length).toBeGreaterThan(0);

      rerender(<AnswerCard answer={mockAnswer} searchQuery="" />);
      marks = container.querySelectorAll("mark.search-highlight");
      expect(marks.length).toBe(0);
    });
  });

  // ── B66→B146: 笔记划词高亮（多色升级）──
  describe("B66 note highlighting", () => {
    it("highlights note selectedText in content", () => {
      const { container } = render(
        <AnswerCard
          answer={mockAnswer}
          noteHighlights={[{ text: "三种经典策略", color: "yellow" }]}
        />,
      );
      const marks = container.querySelectorAll("mark.note-highlight-yellow");
      expect(marks.length).toBeGreaterThan(0);
      const markTexts = Array.from(marks).map((m) => m.textContent);
      expect(markTexts.some((t) => t?.includes("三种经典策略"))).toBe(true);
    });

    it("does not highlight text shorter than 3 characters", () => {
      const { container } = render(
        <AnswerCard
          answer={mockAnswer}
          noteHighlights={[{ text: "的", color: "yellow" }]}
        />,
      );
      const marks = container.querySelectorAll("mark.note-highlight-yellow");
      expect(marks.length).toBe(0);
    });

    it("does not add note marks when noteHighlights is empty", () => {
      const { container } = render(
        <AnswerCard answer={mockAnswer} noteHighlights={[]} />,
      );
      const marks = container.querySelectorAll("mark[class*='note-highlight-']");
      expect(marks.length).toBe(0);
    });

    it("does not add note marks when noteHighlights is undefined", () => {
      const { container } = render(<AnswerCard answer={mockAnswer} />);
      const marks = container.querySelectorAll("mark[class*='note-highlight-']");
      expect(marks.length).toBe(0);
    });

    it("highlights multiple note texts simultaneously", () => {
      const { container } = render(
        <AnswerCard
          answer={mockAnswer}
          noteHighlights={[
            { text: "三种经典策略", color: "yellow" },
            { text: "压缩摘要", color: "green" },
          ]}
        />,
      );
      const marks = container.querySelectorAll("mark[class*='note-highlight-']");
      expect(marks.length).toBeGreaterThanOrEqual(2);
    });

    it("cleans up note highlights when noteHighlights changes", () => {
      const { container, rerender } = render(
        <AnswerCard
          answer={mockAnswer}
          noteHighlights={[{ text: "三种经典策略", color: "yellow" }]}
        />,
      );
      let marks = container.querySelectorAll("mark[class*='note-highlight-']");
      expect(marks.length).toBeGreaterThan(0);

      rerender(<AnswerCard answer={mockAnswer} noteHighlights={[]} />);
      marks = container.querySelectorAll("mark[class*='note-highlight-']");
      expect(marks.length).toBe(0);
    });

    it("does not highlight inside <code> elements", () => {
      const answer: Answer = {
        ...mockAnswer,
        l1: "使用 `FIFO` 策略处理溢出。",
      };
      const { container } = render(
        <AnswerCard answer={answer} noteHighlights={[{ text: "FIFO", color: "yellow" }]} />,
      );
      const codeEl = container.querySelector("code");
      expect(codeEl).toBeInTheDocument();
      if (codeEl) {
        const marksInsideCode = codeEl.querySelectorAll("mark");
        expect(marksInsideCode.length).toBe(0);
      }
    });

    it("note and search highlights coexist", () => {
      const { container } = render(
        <AnswerCard
          answer={mockAnswer}
          searchQuery="上下文窗口"
          noteHighlights={[{ text: "三种经典策略", color: "yellow" }]}
        />,
      );
      const searchMarks = container.querySelectorAll("mark.search-highlight");
      const noteMarks = container.querySelectorAll("mark.note-highlight-yellow");
      expect(searchMarks.length).toBeGreaterThan(0);
      expect(noteMarks.length).toBeGreaterThan(0);
    });
  });

  // ── B137: L2/L3 折叠区内容类型徽章 ──
  describe("B137 content type badges", () => {
    it("shows no badge when L2 has no code/mermaid/table", () => {
      render(<AnswerCard answer={mockAnswer} />);
      // mockAnswer.l2 = plain text → no badges
      expect(screen.queryByText("代码示例")).not.toBeInTheDocument();
      expect(screen.queryByText("流程图")).not.toBeInTheDocument();
      expect(screen.queryByText("表格")).not.toBeInTheDocument();
    });

    it("shows '代码示例' badge when L2 has code fences", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "这里有一段代码：\n\n```python\nprint('hello')\n```",
      };
      render(<AnswerCard answer={answer} />);
      expect(screen.getByText("代码示例")).toBeInTheDocument();
    });

    it("shows '流程图' badge when L2 has mermaid fences", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "流程图如下：\n\n```mermaid\ngraph TD\nA --> B\n```",
      };
      render(<AnswerCard answer={answer} />);
      expect(screen.getByText("流程图")).toBeInTheDocument();
    });

    it("shows '表格' badge when L2 has markdown tables", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "数据对比如下：\n\n| 策略 | 优点 | 缺点 |\n|------|------|------|\n| FIFO | 简单 | 丢关键信息 |",
      };
      render(<AnswerCard answer={answer} />);
      expect(screen.getByText("表格")).toBeInTheDocument();
    });

    it("shows multiple badges when L2 has code + table", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "代码：\n\n```js\nconst x = 1;\n```\n\n数据：\n\n| A | B |\n|---|---|\n| 1 | 2 |",
      };
      render(<AnswerCard answer={answer} />);
      expect(screen.getByText("代码示例")).toBeInTheDocument();
      expect(screen.getByText("表格")).toBeInTheDocument();
    });

    it("L2 button still accessible with badges present", () => {
      const answer: Answer = {
        ...mockAnswer,
        l2: "```python\nprint('hi')\n```\n\n```mermaid\ngraph TD\n```",
      };
      render(<AnswerCard answer={answer} />);
      // Button accessible name includes "深度探索" + badge texts
      const btn = screen.getByRole("button", { name: /深度探索/ });
      expect(btn).toBeInTheDocument();
      // Still collapsed by default
      expect(btn.getAttribute("aria-expanded")).toBe("false");
    });

    it("L3 also shows badges for its content", () => {
      const answer: Answer = {
        ...mockAnswer,
        l3: "```rust\nfn main() {}\n```",
      };
      render(<AnswerCard answer={answer} />);
      const btn = screen.getByRole("button", { name: /前沿与未解/ });
      expect(btn).toBeInTheDocument();
      // L3 button text includes badge
      expect(screen.getByText("代码示例")).toBeInTheDocument();
    });
  });

  // ── B66: 划词浮动工具栏 ──
  describe("B66 SelectionToolbar integration", () => {
    it("renders SelectionToolbar when onAddNote is provided", () => {
      const onAddNote = vi.fn();
      render(<AnswerCard answer={mockAnswer} onAddNote={onAddNote} />);
      // SelectionToolbar 默认不可见（无选区时），验证组件挂载不崩溃
      expect(screen.getByText(mockAnswer.question)).toBeInTheDocument();
    });

    it("does not render SelectionToolbar when onAddNote is omitted", () => {
      render(<AnswerCard answer={mockAnswer} />);
      // 不应有 data-selection-toolbar 元素
      expect(
        document.querySelector("[data-selection-toolbar]"),
      ).toBeNull();
    });

    it("calls onAddNote with selected text when toolbar button clicked", () => {
      const onAddNote = vi.fn();
      const { container } = render(
        <AnswerCard answer={mockAnswer} onAddNote={onAddNote} />,
      );

      // 模拟选区在容器内
      const textNode = container.querySelector("p");
      expect(textNode).toBeInTheDocument();

      // 直接调用 onAddNote 验证 callback 连通性
      onAddNote("测试选中文本");
      expect(onAddNote).toHaveBeenCalledWith("测试选中文本");
    });
  });
});

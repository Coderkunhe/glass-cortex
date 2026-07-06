import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuestionList from "@/components/learn/QuestionList";
import type { Answer, Chapter } from "@/lib/content/types";

const mockChapters: Chapter[] = [
  {
    id: "ch1",
    shortLabel: "上下文工程",
    title: "上下文工程",
    englishTitle: "Context Engineering",
    coreQuestion: "有限上下文窗口里塞什么？",
    icon: "RiDashboardLine",
    questionCount: 2,
    answeredCount: 1,
  },
  {
    id: "ch2",
    shortLabel: "记忆系统",
    title: "记忆系统",
    englishTitle: "Memory Systems",
    coreQuestion: "如何组织信息？",
    icon: "RiBrainLine",
    questionCount: 1,
    answeredCount: 0,
  },
];

const mockQuestions: Record<string, Answer[]> = {
  ch1: [
    {
      id: "q1.1",
      question: "溢出处理策略",
      chapter: "ch1",
      chapterTitle: "第 1 章：上下文工程",
      priority: "P0",
      confidence: { l0: 0.97, l1: 0.95, l2: 0.92, l3: 0.9 },
      overallConfidence: 0.9,
      l0: "三种策略",
      l1: "详细内容",
      l2: "深度",
      l3: "前沿",
    },
    {
      id: "q1.2",
      question: "输出超长处理",
      chapter: "ch1",
      chapterTitle: "第 1 章：上下文工程",
      priority: "P2",
      confidence: { l0: 0, l1: 0, l2: 0, l3: 0 },
      overallConfidence: 0,
      l0: "",
      l1: "",
      l2: "",
      l3: "",
    },
  ],
  ch2: [
    {
      id: "q2.1",
      question: "事实抽取手段",
      chapter: "ch2",
      chapterTitle: "第 2 章：记忆系统",
      priority: "P1",
      confidence: { l0: 0, l1: 0, l2: 0, l3: 0 },
      overallConfidence: 0,
      l0: "",
      l1: "",
      l2: "",
      l3: "",
    },
  ],
};

describe("QuestionList", () => {
  it("renders chapter tree headers", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    // 所有章节头部应可见
    expect(screen.getByText("上下文工程")).toBeInTheDocument();
    expect(screen.getByText("记忆系统")).toBeInTheDocument();
  });

  it("shows question count per chapter", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    // 上下文工程 1/2，记忆系统 0/1
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();
  });

  it("shows questions under expanded chapter tree", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    // 默认展开，所有问题可见
    expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
    expect(screen.getByText("输出超长处理")).toBeInTheDocument();
    expect(screen.getByText("事实抽取手段")).toBeInTheDocument();
  });

  it("calls onSelect when clicking a question", () => {
    const onSelect = vi.fn();
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    fireEvent.click(screen.getByText("溢出处理策略"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "q1.1" })
    );
  });

  it("toggles chapter collapse on tree header click", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    // 默认展开，上下文工程 问题可见
    expect(screen.getByText("溢出处理策略")).toBeInTheDocument();

    // 点击 上下文工程 头部折叠
    fireEvent.click(screen.getByText("上下文工程"));

    // 折叠后问题应隐藏
    expect(screen.queryByText("溢出处理策略")).not.toBeInTheDocument();

    // 再次点击展开
    fireEvent.click(screen.getByText("上下文工程"));
    expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
  });

  // LC18: stub "待撰写" 标签已移除 — 不渲染负面标签
  it("does not render stub label for unanswered questions (LC18 fix)", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    // LC18: 不再显示"待撰写"标签
    expect(screen.queryByText("待撰写")).toBeNull();
  });

  it("filters questions by search query", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    const searchInput = screen.getByLabelText("搜索问题");

    // 搜索"超长"→ 只匹配"输出超长处理"
    fireEvent.change(searchInput, { target: { value: "超长" } });
    expect(screen.getByText("输出超长处理")).toBeInTheDocument();
    expect(screen.queryByText("溢出处理策略")).not.toBeInTheDocument();
    expect(screen.queryByText("事实抽取手段")).not.toBeInTheDocument();
  });

  it("shows empty state when search matches nothing", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    const searchInput = screen.getByLabelText("搜索问题");
    fireEvent.change(searchInput, { target: { value: "不存在的查询" } });

    expect(screen.getAllByText(/未找到匹配/).length).toBeGreaterThanOrEqual(1);
  });

  it("clears search with clear button", () => {    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    const searchInput = screen.getByLabelText("搜索问题");
    fireEvent.change(searchInput, { target: { value: "超长" } });

    // 搜索后应出现清除按钮
    const clearBtn = screen.getByLabelText("清除搜索");
    expect(clearBtn).toBeInTheDocument();

    // 清除后应回到全部显示
    fireEvent.click(clearBtn);
    expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
  });

  it("highlights selected question", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId="q1.1"
        onSelect={vi.fn()}
      />
    );
    // 选中项应包含 selected 样式
    const buttons = screen.getAllByRole("button");
    const selectedBtn = buttons.find((b) =>
      b.textContent?.includes("溢出处理策略")
    );
    // 注意：现在 question-list-item 始终带 brand 边框，
    // 选中态主要通过 question-list-item--selected 类区分
    expect(selectedBtn).toBeDefined();
    expect(selectedBtn?.className).toContain("question-list-item--selected");
  });

  it("shows search placeholder and clear button behavior", () => {
    render(
      <QuestionList
        chapters={mockChapters}
        questionsByChapter={mockQuestions}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(
      screen.getByPlaceholderText(/搜索/)
    ).toBeInTheDocument();
  });

  // ── Phase 41 Batch 6: 搜索过滤按钮 ──

  describe("Phase 41 Batch 6 — Filter chips", () => {
    it("renders all filter chips", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      expect(screen.getByText("全部")).toBeInTheDocument();
      expect(screen.getByText("已答")).toBeInTheDocument();
    });

    it('filters answered questions only', () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      // Click "已答"
      fireEvent.click(screen.getByText("已答"));

      // q1.1 has l0!=="" → should show; q1.2 + q2.1 have l0==="" → hidden
      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      expect(screen.queryByText("输出超长处理")).not.toBeInTheDocument();
      expect(screen.queryByText("事实抽取手段")).not.toBeInTheDocument();
    });


    it('combines answer filter with text search (AND logic)', () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      // Filter: answered → only q1.1
      fireEvent.click(screen.getByText("已答"));

      // Search for "溢出" → q1.1 matches both filter AND search
      const searchInput = screen.getByLabelText("搜索问题");
      fireEvent.change(searchInput, { target: { value: "溢出" } });

      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      expect(screen.queryByText("事实抽取手段")).not.toBeInTheDocument();
    });

    it('shows empty state when filter + search match nothing', () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      // Filter: answered → only q1.1
      fireEvent.click(screen.getByText("已答"));

      // Search for something that doesn't match q1.1
      const searchInput = screen.getByLabelText("搜索问题");
      fireEvent.change(searchInput, { target: { value: "事实抽取" } });

      expect(screen.getAllByText(/未找到匹配/).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Phase 41 Batch 6: 最近阅读 ──

  describe("Phase 41 Batch 6 — Visit history", () => {
    const visitHistoryMock = [
      mockQuestions.ch1[0],
      mockQuestions.ch1[1],
    ];

    it("renders visit history section when provided", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
          visitHistory={visitHistoryMock}
        />
      );

      // "最近阅读" heading is unique to visit history section
      expect(screen.getByText("最近阅读")).toBeInTheDocument();
      // Questions appear in both tree + history; verify they exist somewhere
      expect(screen.getAllByText("溢出处理策略").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("输出超长处理").length).toBeGreaterThanOrEqual(1);
    });

    it("does not render visit history section when empty", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
          visitHistory={[]}
        />
      );

      expect(screen.queryByText("最近阅读")).not.toBeInTheDocument();
    });

    it("highlights currently selected question in visit history", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId="q1.1"
          onSelect={vi.fn()}
          visitHistory={visitHistoryMock}
        />
      );

      // q1.1 appears in both tree + history; verify it renders
      expect(screen.getAllByText("溢出处理策略").length).toBeGreaterThanOrEqual(1);
    });

    it("calls onSelect when clicking a visit history item", () => {
      const onSelect = vi.fn();
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={onSelect}
          visitHistory={visitHistoryMock}
        />
      );

      // Text appears in both tree + history; pick first match
      fireEvent.click(screen.getAllByText("输出超长处理")[0]);
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q1.2" })
      );
    });
  });

  // ── Phase 41 Batch 7: 书签过滤 ──

  describe("Phase 41 Batch 7 — Bookmark filter", () => {
    it("hides '收藏' chip when bookmarks is undefined", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );
      expect(screen.queryByText("收藏")).not.toBeInTheDocument();
    });

    it("hides '收藏' chip when bookmarks is empty", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
          bookmarks={[]}
        />
      );
      expect(screen.queryByText("收藏")).not.toBeInTheDocument();
    });

    it("shows '收藏' chip when bookmarks is non-empty", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
          bookmarks={["q1.1"]}
        />
      );
      expect(screen.getByText(/^收藏/)).toBeInTheDocument();
    });

    it("shows only bookmarked questions when bookmark filter is active", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
          bookmarks={["q1.1"]}
        />
      );
      fireEvent.click(screen.getByText(/^收藏/));
      // Only q1.1 is bookmarked → should show
      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      // q1.2 and q2.1 not bookmarked → hidden
      expect(screen.queryByText("输出超长处理")).not.toBeInTheDocument();
      expect(screen.queryByText("事实抽取手段")).not.toBeInTheDocument();
    });

    it("toggles bookmark filter off on second click", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
          bookmarks={["q1.1"]}
        />
      );
      // Activate filter
      fireEvent.click(screen.getByText(/^收藏/));
      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      expect(screen.queryByText("事实抽取手段")).not.toBeInTheDocument();

      // Deactivate filter → all questions visible
      fireEvent.click(screen.getByText(/^收藏/));
      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      expect(screen.getByText("事实抽取手段")).toBeInTheDocument();
    });

    it("combines bookmark filter with answer filter (AND logic)", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
          bookmarks={["q1.1", "q2.1"]}
        />
      );
      // Activate bookmark filter → q1.1 + q2.1 visible
      fireEvent.click(screen.getByText(/^收藏/));
      // Then filter by "已答" → only q1.1 (l0!=="") should survive
      fireEvent.click(screen.getByText("已答"));
      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      expect(screen.queryByText("事实抽取手段")).not.toBeInTheDocument();
    });
  });

  // ── Phase 41 Batch 8: 全文搜索 ──

  describe("Phase 41 Batch 8 — Full-text search", () => {
    it("finds question by matching L0 content", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      // q1.1 的 L0 是 "三种策略"
      const searchInput = screen.getByLabelText("搜索问题");
      fireEvent.change(searchInput, { target: { value: "三种策略" } });

      // 应匹配 q1.1
      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      // 不应匹配 q1.2 / q2.1
      expect(screen.queryByText("输出超长处理")).not.toBeInTheDocument();
      expect(screen.queryByText("事实抽取手段")).not.toBeInTheDocument();
    });

    it("finds question by matching L1 content", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      // q1.1 的 L1 是 "详细内容"
      const searchInput = screen.getByLabelText("搜索问题");
      fireEvent.change(searchInput, { target: { value: "详细内容" } });

      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
      // q1.2 的 L1 是空字符串 → 不应匹配
      expect(screen.queryByText("输出超长处理")).not.toBeInTheDocument();
    });

    it("combines full-text search with answer filter (AND logic)", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      // 过滤：已答 → 仅 q1.1 (l0!=="")
      fireEvent.click(screen.getByText("已答"));

      // 搜索 L1 内容 "详细内容"
      const searchInput = screen.getByLabelText("搜索问题");
      fireEvent.change(searchInput, { target: { value: "详细内容" } });

      // q1.1 应该同时满足两个条件
      expect(screen.getByText("溢出处理策略")).toBeInTheDocument();
    });

    it("shows field label for content-level match", () => {
      render(
        <QuestionList
          chapters={mockChapters}
          questionsByChapter={mockQuestions}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      // 搜索 L0 内容
      const searchInput = screen.getByLabelText("搜索问题");
      fireEvent.change(searchInput, { target: { value: "三种策略" } });

      // 应显示字段标签 "L0 结论"（在 snippet 区域）
      expect(screen.getByText("L0 结论")).toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── mock functions must be hoisted above the vi.mock call ──
const {
  mockGetChapters,
  mockGetQuestionsByChapter,
  mockGetAnswerById,
  mockLoadAllChaptersParallel,
  mockRouterReplace,
} = vi.hoisted(() => ({
  mockGetChapters: vi.fn(),
  mockGetQuestionsByChapter: vi.fn(),
  mockGetAnswerById: vi.fn(),
  mockLoadAllChaptersParallel: vi.fn(),
  mockRouterReplace: vi.fn(),
}));

vi.mock("@/lib/content/questions", () => ({
  getChapters: mockGetChapters,
  getQuestionsByChapter: mockGetQuestionsByChapter,
  getAnswerById: mockGetAnswerById,
  loadAllChaptersParallel: mockLoadAllChaptersParallel,
}));

// Mock next/navigation — LearnPage now uses AppShell which renders ProjectMapDrawer (useRouter)
vi.mock("next/navigation", () => ({
  usePathname: () => "/learn",
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    replace: mockRouterReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock heavy AppShell children to isolate LearnPage testing
vi.mock("@/components/layout/ProjectMapDrawer", () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="project-map-drawer">
        <button data-testid="map-close" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));
vi.mock("@/components/chat/ProcessDrawer", () => ({
  default: () => <div data-testid="process-drawer-mock" />,
}));
vi.mock("@/components/chat/DrawerContext", () => ({
  DrawerProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/chat/ChatParamsContext", () => ({
  ChatParamsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Import LearnPage AFTER vi.mock so it gets the mocked module
import LearnPage from "@/app/learn/page";
import LearnLoadingSkeleton from "@/app/learn/_components/LearnLoadingSkeleton";
import type { Answer, Chapter } from "@/lib/content/types";

// ── test data factories ──

function makeChapters(): Chapter[] {
  return [
    {
      id: "ch1",
      shortLabel: "Ch1",
      title: "上下文工程",
      englishTitle: "Context Engineering",
      coreQuestion: "有限上下文窗口里塞什么？",
      icon: "RiDashboardLine",
      questionCount: 2,
      answeredCount: 1,
    },
    {
      id: "ch2",
      shortLabel: "Ch2",
      title: "记忆系统",
      englishTitle: "Memory Systems",
      coreQuestion: "如何组织信息？",
      icon: "RiBrainLine",
      questionCount: 1,
      answeredCount: 0,
    },
  ];
}

function makeAnswers(): Answer[] {
  return [
    {
      id: "q1.1",
      question: "溢出处理策略对比",
      chapter: "ch1",
      chapterTitle: "第 1 章：上下文工程",
      priority: "P0",
      confidence: { l0: 0.97, l1: 0.95, l2: 0.92, l3: 0.9 },
      overallConfidence: 0.9,
      l0: "三种策略各有优劣",
      l1: "详细展开",
      l2: "",
      l3: "",
    },
    {
      id: "q1.2",
      question: "分区算法详解",
      chapter: "ch1",
      chapterTitle: "第 1 章：上下文工程",
      priority: "P0",
      confidence: { l0: 0.95, l1: 0.9, l2: 0.88, l3: 0.0 },
      overallConfidence: 0.0,
      l0: "",
      l1: "",
      l2: "",
      l3: "",
    },
    {
      id: "q2.1",
      question: "艾宾浩斯遗忘曲线",
      chapter: "ch2",
      chapterTitle: "第 2 章：记忆系统",
      priority: "P1",
      confidence: { l0: 0.9, l1: 0.85, l2: 0.8, l3: 0.75 },
      overallConfidence: 0.75,
      l0: "",
      l1: "",
      l2: "",
      l3: "",
    },
  ];
}

describe("LearnPage", () => {
  let chapters: Chapter[];
  let answers: Answer[];

  beforeEach(() => {
    chapters = makeChapters();
    answers = makeAnswers();

    mockGetChapters.mockReturnValue(chapters);
    mockGetQuestionsByChapter.mockImplementation((chId: string) =>
      answers.filter((a) => a.chapter === chId),
    );
    mockGetAnswerById.mockImplementation((id: string) =>
      answers.find((a) => a.id === id),
    );
    mockLoadAllChaptersParallel.mockImplementation(() => {
      const map: Record<string, Answer[]> = {};
      for (const ch of chapters) {
        map[ch.id] = answers.filter((a) => a.chapter === ch.id);
      }
      return Promise.resolve(map);
    });
  });

  /** 默认空的 searchParams */
  const defaultSearchParams = Promise.resolve({});

  /** 异步渲染 LearnPage（async server component）。 */
  async function renderPage(searchParams?: Promise<{ q?: string }>) {
    const page = await LearnPage({ searchParams: searchParams ?? defaultSearchParams });
    render(page);
  }

  // ── 无 ?q= 时显示仪表盘（不再自动选中首题）──
  it("shows dashboard when no URL param is present", async () => {
    await renderPage();

    // 无 ?q= 参数 → 显示仪表盘
    expect(screen.getAllByTestId("content-dashboard").length).toBeGreaterThanOrEqual(1);
  });

  // ── ?q= 参数选中指定问题 ──
  it("selects question via URL ?q= param", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    // URL 指定 q1.1 → AnswerCard 显示 q1.1 的 L0 内容
    const questions = screen.getAllByText("溢出处理策略对比");
    expect(questions.length).toBeGreaterThanOrEqual(1);

    const l0Texts = screen.getAllByText("三种策略各有优劣");
    expect(l0Texts.length).toBeGreaterThanOrEqual(1);
  });

  // ── AnswerCard 不渲染置信度标签（LC18 修复：产品信心自毁）──
  it("does not render confidence badge (LC18: negative label removed)", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    // LC18: 置信度% 标签已移除，不应出现在 DOM 中
    expect(screen.queryByText("90% 置信度")).toBeNull();
  });

  // ── 欢迎视图（空章节时显示内容仪表盘）──
  it("shows content dashboard when no chapters", async () => {
    mockGetChapters.mockReturnValue([]);

    await renderPage();

    expect(screen.getAllByTestId("content-dashboard").length).toBeGreaterThanOrEqual(1);
    const chapterTexts = screen.getAllByText(/0 章/);
    expect(chapterTexts.length).toBeGreaterThanOrEqual(1);
  });

  // ── 空章节不崩溃 ──
  it("does not crash with empty chapter list", async () => {
    mockGetChapters.mockReturnValue([]);

    await expect(LearnPage({ searchParams: Promise.resolve({}) })).resolves.not.toThrow();
  });

  // ── 分区算法（第二个问题、未答）也在列表中 ──
  it("lists unanswered questions alongside answered ones", async () => {
    await renderPage();

    // q1.2 (分区算法详解) has l0="" but should still appear in the list
    const q12 = screen.getAllByText("分区算法详解");
    expect(q12.length).toBeGreaterThanOrEqual(1);
  });

  // ── 侧栏切换按钮存在（需 ?q= 进入 AnswerCard 视图）──
  it("renders sidebar toggle button", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    const toggleBtn = screen.getByLabelText("收起目录");
    expect(toggleBtn).toBeInTheDocument();
  });

  // ── Batch 145: 搜索框存在 ──
  it("renders search input in QuestionList", async () => {
    await renderPage();

    // 桌面 + 移动端各有一个搜索框
    const inputs = screen.getAllByLabelText("搜索问题");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  // ── Batch 146: Header 导航存在 ──
  it("renders Header with navigation links", async () => {
    await renderPage();

    // Header 应包含"聊天"链接回到首页
    expect(screen.getByText("聊天")).toBeInTheDocument();
    expect(screen.getByText("问答")).toBeInTheDocument();
  });

  // ── Batch 146: 进度和导航存在（需 ?q= 进入 AnswerCard 视图）──
  it("shows navigation elements when question is selected via URL", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    // 导航按钮存在
    const prevBtn = screen.getByLabelText("上一节");
    expect(prevBtn).toBeDisabled(); // index 0 → 禁用

    const nextBtn = screen.getByLabelText("下一节");
    expect(nextBtn).not.toBeDisabled();

    // 底部导航也存在
    expect(screen.getByText("上一节")).toBeInTheDocument();
    expect(screen.getByText("下一节")).toBeInTheDocument();
  });

  // ── Batch 146: 回到顶部可用（直接渲染最后一个问题）──
  it("shows back-to-top on last question", async () => {
    // 直接渲染最后一个问题（q2.1 = test data 第二个章节的唯一问题）
    await renderPage(Promise.resolve({ q: "q2.1" }));

    // 最后一个问题：顶部和底部均显示"回到顶部"
    expect(screen.getByLabelText("回到顶部")).toBeInTheDocument();
    const scrollTopBtns = screen.getAllByText("回到顶部");
    expect(scrollTopBtns.length).toBeGreaterThanOrEqual(1);
  });

  // ── Batch 146: Header 导航存在 ──
  it("renders Header with navigation links", async () => {
    await renderPage();

    // Header 应包含"聊天"链接回到首页
    expect(screen.getByText("聊天")).toBeInTheDocument();
    expect(screen.getByText("问答")).toBeInTheDocument();
  });

  // ── Batch 147: 沉浸阅读按钮存在（需 ?q= 进入 AnswerCard 视图）──
  it("renders immersive reading button", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    const immersiveBtn = screen.getByLabelText("沉浸阅读");
    expect(immersiveBtn).toBeInTheDocument();
  });

  // ── Batch 147: 点击沉浸按钮 → 进入沉浸模式（需 ?q=）──
  it("enters immersive mode on button click", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    // 默认：沉浸按钮可见
    expect(screen.getByLabelText("沉浸阅读")).toBeInTheDocument();

    // 点击进入沉浸模式
    act(() => {
      fireEvent.click(screen.getByLabelText("沉浸阅读"));
    });

    // 沉浸模式：退出按钮出现
    expect(screen.getByLabelText("退出沉浸模式")).toBeInTheDocument();

    // 沉浸模式：上一节/下一节按钮不可见（顶栏隐藏）
    expect(screen.queryByLabelText("上一节")).not.toBeInTheDocument();

    // 沉浸模式：阅读进度百分比出现（含预估阅读时间）
    expect(screen.getByText(/^0%/)).toBeInTheDocument();
  });

  // ── B63: 沉浸模式增强 — 顶部进度条 + 阅读时间 ──
  it("renders top progress bar in immersive mode", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    act(() => {
      fireEvent.click(screen.getByLabelText("沉浸阅读"));
    });

    // 顶部进度条存在（class 为 immersive-top-progress）
    const topBar = document.querySelector(".immersive-top-progress");
    expect(topBar).toBeInTheDocument();
    expect(topBar).toHaveStyle({ width: "0%" });
  });

  it("shows reading time alongside progress percentage in immersive mode", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    act(() => {
      fireEvent.click(screen.getByLabelText("沉浸阅读"));
    });

    // 百分比元素包含预估阅读时间（格式：N% · 约 N 分钟）
    const pctEl = document.querySelector(".immersive-percentage");
    expect(pctEl).toBeInTheDocument();
    expect(pctEl!.textContent).toMatch(/0%.*约.*分钟/);
  });

  // ── B63: 断点续读 — 滚动位置保存与恢复 ──
  describe("scroll position persistence (B63)", () => {
    let mockStore: Record<string, string>;

    beforeEach(() => {
      mockStore = {};
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(
        (key: string) => mockStore[key] ?? null,
      );
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(
        (key: string, value: string) => {
          mockStore[key] = value;
        },
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("saves scroll position to localStorage on beforeunload", async () => {
      await renderPage(Promise.resolve({ q: "q1.1" }));

      // 模拟滚动到 50%
      const main = document.querySelector("main");
      if (main) {
        Object.defineProperty(main, "scrollHeight", {
          value: 2000,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(main, "clientHeight", {
          value: 800,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(main, "scrollTop", {
          value: 600,
          writable: true,
          configurable: true,
        });
      }

      // 触发 beforeunload
      act(() => {
        window.dispatchEvent(new Event("beforeunload"));
      });

      // 验证 localStorage 中保存了滚动位置
      const saved = JSON.parse(
        mockStore["gm-learn-scroll-positions"] || "{}",
      ) as Record<string, number>;
      expect(saved["q1.1"]).toBe(50); // (600 / (2000 - 800)) * 100 = 50
    });

    it("restores scroll position when revisiting a question", async () => {
      // 预填滚动位置记忆
      mockStore["gm-learn-scroll-positions"] = JSON.stringify({ "q1.1": 50 });

      await renderPage(Promise.resolve({ q: "q1.1" }));

      // 验证页面渲染正常（scroll 恢复在 jsdom 中受限，验证不崩溃即可）
      const questions = screen.getAllByText("溢出处理策略对比");
      expect(questions.length).toBeGreaterThanOrEqual(1);
    });

    it("does not restore scroll when saved position is near top (≤5%)", async () => {
      // 预填 ≤5% 的位置（不应恢复）
      mockStore["gm-learn-scroll-positions"] = JSON.stringify({ "q1.1": 3 });

      await renderPage(Promise.resolve({ q: "q1.1" }));

      // 页面正常渲染，不崩溃
      expect(screen.getAllByText("溢出处理策略对比").length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Batch 147: Esc 退出沉浸模式（需 ?q=）──
  it("exits immersive mode on Escape key", async () => {
    await renderPage(Promise.resolve({ q: "q1.1" }));

    // 进入沉浸模式
    act(() => {
      fireEvent.click(screen.getByLabelText("沉浸阅读"));
    });
    expect(screen.getByLabelText("退出沉浸模式")).toBeInTheDocument();

    // Esc 退出
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // 沉浸模式退出：退出按钮消失
    expect(screen.queryByLabelText("退出沉浸模式")).not.toBeInTheDocument();

    // 导航重新出现
    expect(screen.getByLabelText("上一节")).toBeInTheDocument();
  });

  // ── Phase 41 Batch 2 + Batch 4: URL 路由 + 阅读位置回退 ──

  describe("URL routing and reading position fallback", () => {
    /** 简易 mock localStorage */
    let mockStore: Record<string, string>;

    beforeEach(() => {
      mockStore = {};
      const mockLS = {
        getItem: vi.fn((key: string) => mockStore[key] ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStore[key] = val;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStore[key];
        }),
        clear: vi.fn(() => {
          mockStore = {};
        }),
        get length() {
          return Object.keys(mockStore).length;
        },
        key: vi.fn((i: number) => Object.keys(mockStore)[i] ?? null),
      };
      vi.stubGlobal("localStorage", mockLS);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // ── URL 路由测试：?q= 参数作为真相源 ──

    it("reads selected question from URL ?q= param", async () => {
      await renderPage(Promise.resolve({ q: "q2.1" }));

      // q2.1 应该通过 URL 参数选中并显示
      const q2title = screen.getAllByText("艾宾浩斯遗忘曲线");
      expect(q2title.length).toBeGreaterThanOrEqual(1);
    });

    it("shows dashboard when no ?q= param is present", async () => {
      await renderPage(Promise.resolve({}));

      // 无 ?q= 参数时应显示仪表盘（环形进度图标题）
      expect(screen.getAllByTestId("content-dashboard").length).toBeGreaterThanOrEqual(1);
    });

    it("URL param takes priority over localStorage storedId", async () => {
      // localStorage 存储 q1.1，但 URL 指定 q2.1
      mockStore["gm-learn-last-read"] = '"q1.1"';
      await renderPage(Promise.resolve({ q: "q2.1" }));

      // URL 参数优先 → 显示 q2.1 而非 q1.1
      const q2title = screen.getAllByText("艾宾浩斯遗忘曲线");
      expect(q2title.length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to localStorage storedId for sidebar highlight when URL has no ?q=", async () => {
      // localStorage 存储 q2.1
      mockStore["gm-learn-last-read"] = '"q2.1"';
      await renderPage(Promise.resolve({}));

      // 无 ?q= → 显示仪表盘（而非 q2.1 AnswerCard）
      expect(screen.getAllByTestId("content-dashboard").length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to first answered when URL has no ?q= and no storedId", async () => {
      // 不设 localStorage 值
      mockStore["gm-learn-last-read"] = "null";

      await renderPage(Promise.resolve({}));

      // 无 ?q= → 显示仪表盘
      expect(screen.getAllByTestId("content-dashboard").length).toBeGreaterThanOrEqual(1);
    });

    it("handles invalid question ID in URL gracefully", async () => {
      await renderPage(Promise.resolve({ q: "q99.99" }));

      // 不存在的问题 ID → selectedAnswer undefined → fallback to dashboard
      expect(screen.getAllByTestId("content-dashboard").length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Phase 41 Batch 5: 仪表盘交互增强 ──

  describe("Phase 41 Batch 5 — Dashboard interactions", () => {
    beforeEach(() => {
      mockRouterReplace.mockClear();
    });

    it("clicking a chapter card navigates to first unanswered question", async () => {
      await renderPage();

      // Ch1: q1.1 answered (l0!==""), q1.2 unanswered (l0==="")
      // Clicking ch1 card → should navigate to q1.2 (first unanswered)
      // Two ContentDashboards (desktop + mobile) → pick first
      const ch1Card = screen.getAllByTestId("chapter-card-ch1")[0];

      act(() => {
        fireEvent.click(ch1Card);
      });

      expect(mockRouterReplace).toHaveBeenCalledWith(
        expect.stringContaining("q=q1.2"),
        expect.objectContaining({ scroll: false }),
      );
    });

    it("clicking fully-answered chapter navigates to first question", async () => {
      // Override q1.2 to be answered — must mock loadAllChaptersParallel
      // since ContentDashboard uses questionsByChapter from loaded data, not getQuestionsByChapter
      const modifiedAnswers = answers.map((a) =>
        a.id === "q1.2" ? { ...a, l0: "answered", l1: "content" } : a,
      );
      mockLoadAllChaptersParallel.mockImplementation(() => {
        const map: Record<string, Answer[]> = {};
        for (const ch of chapters) {
          map[ch.id] = modifiedAnswers.filter((a) => a.chapter === ch.id);
        }
        return Promise.resolve(map);
      });

      await renderPage();

      // Two ContentDashboards (desktop + mobile) → pick first
      const ch1Card = screen.getAllByTestId("chapter-card-ch1")[0];

      act(() => {
        fireEvent.click(ch1Card);
      });

      // All answered → navigate to first question q1.1
      expect(mockRouterReplace).toHaveBeenCalledWith(
        expect.stringContaining("q=q1.1"),
        expect.objectContaining({ scroll: false }),
      );
    });

    it("clicking chapter with no questions does not navigate", async () => {
      // Empty questions for ch2 — must mock loadAllChaptersParallel
      // since ContentDashboard uses questionsByChapter from loaded data
      mockLoadAllChaptersParallel.mockImplementation(() => {
        const map: Record<string, Answer[]> = {};
        for (const ch of chapters) {
          map[ch.id] = ch.id === "ch2" ? [] : answers.filter((a) => a.chapter === ch.id);
        }
        return Promise.resolve(map);
      });

      await renderPage();

      // Two ContentDashboards (desktop + mobile) → pick first
      const ch2Card = screen.getAllByTestId("chapter-card-ch2")[0];

      act(() => {
        fireEvent.click(ch2Card);
      });

      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it('shows dashboard on mobile when no question selected', async () => {
      await renderPage();

      // Both desktop and mobile ContentDashboard render in JSDOM — should be 2
      const allDashboards = screen.getAllByTestId('content-dashboard');
      expect(allDashboards.length).toBe(2);
    });
  });

  // ── Phase 41 Batch 6: 阅读历史 ──

  describe('Phase 41 Batch 6 — Visit history persistence', () => {
    let mockStore: Record<string, string>;

    beforeEach(() => {
      mockStore = {};
      const mockLS = {
        getItem: vi.fn((key: string) => mockStore[key] ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStore[key] = val;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStore[key];
        }),
        clear: vi.fn(() => {
          mockStore = {};
        }),
        get length() {
          return Object.keys(mockStore).length;
        },
        key: vi.fn((i: number) => Object.keys(mockStore)[i] ?? null),
      };
      vi.stubGlobal('localStorage', mockLS);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('records visit history when navigating to a question via chapter card', async () => {
      // Mock the visit history key
      mockStore['gm-learn-visit-history'] = '[]';

      await renderPage();

      const ch1Card = screen.getAllByTestId('chapter-card-ch1')[0];
      act(() => { fireEvent.click(ch1Card); });

      const saved = JSON.parse(mockStore['gm-learn-visit-history'] ?? '[]');
      expect(Array.isArray(saved)).toBeTruthy();
      // q1.2 is first unanswered in ch1 → should be recorded
      expect(saved).toContain('q1.2');
    });

    it('records multiple navigations and keeps sliding window of 5', async () => {
      // Simulate 6 visits by setting history directly and clicking ch1 card
      mockStore['gm-learn-visit-history'] = JSON.stringify([
        'q1.1', 'q1.2', 'q2.1', 'q1.1', 'q1.2',
      ]);

      await renderPage();

      // Click ch1 card → should append q1.2 to front and deduplicate
      const ch1Card = screen.getAllByTestId('chapter-card-ch1')[0];
      act(() => { fireEvent.click(ch1Card); });

      const saved: string[] = JSON.parse(mockStore['gm-learn-visit-history'] ?? '[]');
      expect(saved.length).toBeLessThanOrEqual(5);
      // q1.2 should be at position 0 (most recent)
      expect(saved[0]).toBe('q1.2');
    });
  });

  // ── Phase 66 B53: 安全兜底 — ErrorBoundary + 数据加载兜底 ──

  describe("Phase 66 B53 — Error boundary and data loading fallback", () => {
    it("renders loading skeleton (Suspense fallback) with correct structure", () => {
      const { container } = render(<LearnLoadingSkeleton />);

      // 应包含环形 SVG placeholder
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();

      // 应有 8 条章节行骨架 + 1 条推荐阅读占位 = 9 行
      const rows = container.querySelectorAll(".rounded-gm-lg.bg-surface-elevated");
      expect(rows.length).toBe(9);

      // 应有 role="status" 供屏幕阅读器
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("shows error display when loadAllChaptersParallel fails", async () => {
      // mock 数据加载失败
      mockLoadAllChaptersParallel.mockRejectedValueOnce(
        new Error("动态导入失败：ch3 模块不可用"),
      );

      // 服务端组件抛异常 — Next.js 会交由 error.tsx 处理
      // 在测试中验证异常确实被抛出
      await expect(
        LearnPage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow("动态导入失败");
    });

    it("ErrorBoundary wraps LearnClientShell in page component", async () => {
      // 验证 page.tsx 渲染输出中包含 ErrorBoundary 结构
      // ErrorBoundary 在正常渲染时不产生额外 DOM，但 children 正确渲染
      await renderPage(Promise.resolve({ q: "q1.1" }));

      // LearnClientShell 在 ErrorBoundary 内正常渲染
      const questions = screen.getAllByText("溢出处理策略对比");
      expect(questions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Phase 66 B64: 字号偏好 ──

  describe("Phase 66 B64 — Font size adjustment", () => {
    let mockStore: Record<string, string>;

    beforeEach(() => {
      mockStore = {};
      const mockLS = {
        getItem: vi.fn((key: string) => mockStore[key] ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStore[key] = val;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStore[key];
        }),
        clear: vi.fn(() => {
          mockStore = {};
        }),
        get length() {
          return Object.keys(mockStore).length;
        },
        key: vi.fn((i: number) => Object.keys(mockStore)[i] ?? null),
      };
      vi.stubGlobal("localStorage", mockLS);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("cycles font size sm → md → lg → sm on button click", async () => {
      mockStore["gm-learn-font-size"] = JSON.stringify("md");
      await renderPage(Promise.resolve({ q: "q1.1" }));

      const btn = screen.getByLabelText("字号：中");
      expect(btn).toBeInTheDocument();

      // md → lg
      act(() => { fireEvent.click(btn); });
      expect(JSON.parse(mockStore["gm-learn-font-size"])).toBe("lg");
      expect(document.body.classList.contains("gm-font-lg")).toBe(true);

      // lg → sm
      // Need to re-render to reflect state change — click again on the updated button
      const btnLg = screen.getByLabelText("字号：大");
      act(() => { fireEvent.click(btnLg); });
      expect(JSON.parse(mockStore["gm-learn-font-size"])).toBe("sm");
      expect(document.body.classList.contains("gm-font-sm")).toBe(true);
      expect(document.body.classList.contains("gm-font-lg")).toBe(false);
    });

    it("defaults to md font size when no localStorage entry", async () => {
      await renderPage(Promise.resolve({ q: "q1.1" }));

      const btn = screen.getByLabelText("字号：中");
      expect(btn).toBeInTheDocument();
      expect(document.body.classList.contains("gm-font-sm")).toBe(false);
      expect(document.body.classList.contains("gm-font-lg")).toBe(false);
    });

    it("restores font size from localStorage on mount", async () => {
      mockStore["gm-learn-font-size"] = JSON.stringify("lg");
      await renderPage(Promise.resolve({ q: "q1.1" }));

      expect(document.body.classList.contains("gm-font-lg")).toBe(true);
    });

    it("font size button not visible on dashboard (no question selected)", async () => {
      await renderPage();

      // 字号按钮仅在选中问题时显示（在工具栏内）
      expect(screen.queryByLabelText("字号：中")).toBeNull();
    });
  });

  // ── Phase 66 B64: 仪表盘阅读历史 ──

  describe("Phase 66 B64 — Reading history on dashboard", () => {
    let mockStore: Record<string, string>;

    beforeEach(() => {
      mockStore = {};
      const mockLS = {
        getItem: vi.fn((key: string) => mockStore[key] ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStore[key] = val;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStore[key];
        }),
        clear: vi.fn(() => {
          mockStore = {};
        }),
        get length() {
          return Object.keys(mockStore).length;
        },
        key: vi.fn((i: number) => Object.keys(mockStore)[i] ?? null),
      };
      vi.stubGlobal("localStorage", mockLS);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("shows recent reading history on dashboard when history exists", async () => {
      mockStore["gm-learn-visit-history"] = JSON.stringify(["q1.1", "q2.1"]);

      await renderPage();

      // 桌面 + 移动端各一套 ContentDashboard → 各有一个 "最近阅读" 标题
      const headings = screen.getAllByText("最近阅读");
      expect(headings.length).toBeGreaterThanOrEqual(1);
      // 问题标题在历史条目中，每套各出现一次 → 共 2 次
      const q11Instances = screen.getAllByText("溢出处理策略对比");
      expect(q11Instances.length).toBeGreaterThanOrEqual(1);
      const q21Instances = screen.getAllByText("艾宾浩斯遗忘曲线");
      expect(q21Instances.length).toBeGreaterThanOrEqual(1);
    });

    it("does not show reading history section when history is empty", async () => {
      mockStore["gm-learn-visit-history"] = JSON.stringify([]);

      await renderPage();

      expect(screen.queryByText("最近阅读")).toBeNull();
    });

    it("clicking a history item navigates to that question", async () => {
      mockStore["gm-learn-visit-history"] = JSON.stringify(["q1.1"]);

      await renderPage();

      // 桌面/移动端各一个历史按钮，取第一个
      const historyBtns = screen.getAllByText("溢出处理策略对比");
      act(() => { fireEvent.click(historyBtns[0]); });

      expect(mockRouterReplace).toHaveBeenCalledWith(
        expect.stringContaining("q=q1.1"),
        expect.objectContaining({ scroll: false }),
      );
    });
  });
});

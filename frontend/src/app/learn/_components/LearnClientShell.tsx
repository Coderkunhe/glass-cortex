"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  RiMenuFoldLine,
  RiMenuUnfoldLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiFullscreenLine,
  RiFullscreenExitLine,
  RiBarChart2Line,
  RiDashboardLine,
  RiBrainLine,
  RiTaskLine,
  RiCoinsLine,
  RiGitMergeLine,
  RiTimerLine,
  RiEyeLine,
  RiMentalHealthLine,
  RiBookOpenLine,
  RiLightbulbLine,
  RiFontSize,
} from "@remixicon/react";
import type { Answer, Chapter } from "@/lib/content/types";
import { getAnswerById } from "@/lib/content/questions";
import { estimateReadingTime, formatReadingTime } from "@/lib/content/estimateReadingTime";
import { formatChapterTitle } from "@/lib/formatChapter";
import AppShell from "@/components/layout/AppShell";
import QuestionList from "@/components/learn/QuestionList";
import AnswerCard from "@/components/learn/AnswerCard";
import NotesPanel from "@/components/learn/NotesPanel";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { LearnNote } from "@/lib/constants";
import {
  LEARN_LAST_READ_KEY,
  LEARN_COLLAPSED_KEY,
  LEARN_SIDEBAR_KEY,
  LEARN_VISIT_HISTORY_KEY,
  LEARN_BOOKMARKS_KEY,
  LEARN_SCROLL_POSITIONS_KEY,
  LEARN_FONT_SIZE_KEY,
  LEARN_NOTES_KEY,
} from "@/lib/constants";

/** Remixicon 章节图标映射（与 QuestionList ICON_MAP 对齐） */
const CHAPTER_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  RiDashboardLine,
  RiBrainLine,
  RiTaskLine,
  RiCoinsLine,
  RiGitMergeLine,
  RiTimerLine,
  RiEyeLine,
  RiMentalHealthLine,
};

// ── Props ─────────────────────────────────────────────────────

export interface LearnClientShellProps {
  chapters: Chapter[];
  questionsByChapter: Record<string, Answer[]>;
  initialUrlId?: string | null;
}

/**
 * /learn 页面客户端容器。
 * 通过 AppShell sidebar slot 注入 QuestionList，统一布局体系。
 * 使用 URL 查询参数 ?q= 作为选中问题的真相源（deep linking），
 * 支持浏览器前进/后退导航和链接分享。
 * 优先级链：URL ?q= > localStorage storedId > defaultId（首个已答）。
 */
export default function LearnClientShell({
  chapters,
  questionsByChapter,
  initialUrlId,
}: LearnClientShellProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL 中的 ?q= 参数（浏览器前进/后退时由 useSearchParams 自动更新）
  const urlId = searchParams.get("q") ?? initialUrlId ?? null;

  // 找出第一个有已答问题的 ID（首次加载自动选中）
  const defaultId = useMemo(() => {
    for (const ch of chapters) {
      const qs = questionsByChapter[ch.id] || [];
      const answered = qs.find((q) => q.l0 !== "");
      if (answered) return answered.id;
    }
    for (const ch of chapters) {
      const qs = questionsByChapter[ch.id] || [];
      if (qs.length > 0) return qs[0].id;
    }
    return null;
  }, [chapters, questionsByChapter]);

  // ── 持久化状态 ──

  /** localStorage 中上次阅读的问题 ID */
  const [storedId, setStoredId] = useLocalStorage<string | null>(
    LEARN_LAST_READ_KEY,
    null,
  );

  /** 侧栏展开/收起 */
  const [sidebarOpen, setSidebarOpen] = useLocalStorage(
    LEARN_SIDEBAR_KEY,
    true,
  );

  /** 折叠的章节 ID 列表 */
  const [collapsedIds, setCollapsedIds] = useLocalStorage<string[]>(
    LEARN_COLLAPSED_KEY,
    [],
  );

  /** 最近阅读历史（滑动窗口，最多 5 条问题 ID） */
  const [visitHistoryIds, setVisitHistoryIds] = useLocalStorage<string[]>(
    LEARN_VISIT_HISTORY_KEY,
    [],
  );

  /** 已收藏的问题 ID 列表 */
  const [bookmarks, setBookmarks] = useLocalStorage<string[]>(
    LEARN_BOOKMARKS_KEY,
    [],
  );

  /** 滚动位置记忆 — question ID → scroll percentage (0-100)。 */
  const [scrollPositions, setScrollPositions] = useLocalStorage<
    Record<string, number>
  >(LEARN_SCROLL_POSITIONS_KEY, {});

  /** 阅读字号偏好 — "sm" | "md" | "lg"（默认 "md"）。 */
  const [fontSize, setFontSize] = useLocalStorage<string>(
    LEARN_FONT_SIZE_KEY,
    "md",
  );

  /** 搜索关键词 — 由 QuestionList 同步，传递给 AnswerCard 用于正文高亮 */
  const [searchQuery, setSearchQuery] = useState("");

  /** 笔记数据 — 读取全量笔记映射，用于高亮渲染（与 NotesPanel 共享同一 localStorage key） */
  const [notesMap] = useLocalStorage<Record<string, LearnNote[]>>(
    LEARN_NOTES_KEY,
    {},
  );

  /** 划词选中待记文本 — 非空时触发 NotesPanel 自动进入创建模式 */
  const [pendingSelectionText, setPendingSelectionText] = useState<string | null>(null);

  /**
   * 当前选中的问题 ID。
   * 优先级：URL ?q= > localStorage storedId > 首个已答 defaultId。
   * 用于侧栏高亮标记（sidebar）。
   */
  const sidebarSelectedId = urlId ?? storedId ?? defaultId;

  /**
   * 当前正显示的问题答案。
   * 仅当 URL 有 ?q= 时非空 — 无 ?q= 时显示仪表盘。
   * 与 sidebarSelectedId 分离：侧栏可高亮 stored/default 问题，
   * 而 AnswerCard 只响应 URL 参数。
   */
  const selectedAnswer = urlId ? getAnswerById(urlId) : undefined;

  /** 当前问题的笔记高亮文本列表（提取所有已存笔记的 selectedText） */
  const noteHighlights = useMemo(() => {
    if (!selectedAnswer) return [];
    const notes = notesMap[selectedAnswer.id] || [];
    return notes
      .map((n) => n.selectedText)
      .filter((t): t is string => !!t && t.trim().length >= 3);
  }, [notesMap, selectedAnswer]);

  /** 当前选中答案的预估阅读时间（分钟） */
  const readingTime = useMemo(() => {
    if (!selectedAnswer) return undefined;
    const text = [
      selectedAnswer.l0,
      selectedAnswer.l1,
      selectedAnswer.l2,
      selectedAnswer.l3,
    ]
      .filter(Boolean)
      .join("\n");
    return estimateReadingTime(text);
  }, [selectedAnswer]);

  /**
   * 更新 URL 查询参数。 + localStorage。
   * 用 replace 而非 push 避免破坏浏览器历史栈中的 /learn 入口。
   */
  const updateUrl = useCallback(
    (id: string | null) => {
      if (id) {
        router.replace(`${pathname}?q=${encodeURIComponent(id)}`, {
          scroll: false,
        });
      } else {
        router.replace(pathname, { scroll: false });
      }
    },
    [pathname, router],
  );

  /** 选中某个问题：同步 URL + localStorage */
  const setSelectedId = useCallback(
    (id: string | null) => {
      setStoredId(id);
      updateUrl(id);
    },
    [setStoredId, updateUrl],
  );

  /** 保存当前问题的滚动位置（百分比），供断点续读使用。 */
  const saveCurrentScrollPosition = useCallback(() => {
    const main = document.querySelector("main");
    if (!main || !selectedAnswer) return;
    const total = main.scrollHeight - main.clientHeight;
    if (total <= 0) return;
    const pct = Math.round((main.scrollTop / total) * 100);
    setScrollPositions((prev) => ({ ...prev, [selectedAnswer.id]: pct }));
  }, [selectedAnswer, setScrollPositions]);

  /** 返回仪表盘：清除 URL ?q= 参数 */
  const goToDashboard = useCallback(() => {
    saveCurrentScrollPosition();
    updateUrl(null);
  }, [saveCurrentScrollPosition, updateUrl]);

  const [immersive, setImmersive] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);

  /** 全量问题列表（按章节顺序展平） */
  const allQuestions = useMemo(() => {
    return chapters.flatMap((ch) => questionsByChapter[ch.id] || []);
  }, [chapters, questionsByChapter]);

  /** 最近阅读的 Answer 对象列表（按 visitHistoryIds 顺序） */
  const visitHistoryAnswers = useMemo(() => {
    const map = new Map(allQuestions.map((q) => [q.id, q]));
    return visitHistoryIds.map((id) => map.get(id)).filter(Boolean) as Answer[];
  }, [allQuestions, visitHistoryIds]);

  const currentIndex = useMemo(() => {
    if (!urlId) return -1;
    return allQuestions.findIndex((q) => q.id === urlId);
  }, [urlId, allQuestions]);

  const totalQuestions = allQuestions.length;
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= totalQuestions - 1;

  const handleBack = useCallback(() => {
    goToDashboard();
  }, [goToDashboard]);

  const handleSelect = useCallback(
    (answer: Answer) => {
      if (answer.id !== selectedAnswer?.id) {
        saveCurrentScrollPosition();
      }
      setSelectedId(answer.id);
      setVisitHistoryIds((prev) => {
        // 滑动窗口：去重后追加到队首，最多 5 条
        const next = [answer.id, ...prev.filter((id) => id !== answer.id)].slice(
          0,
          5,
        );
        return next;
      });
    },
    [setSelectedId, setVisitHistoryIds, selectedAnswer, saveCurrentScrollPosition],
  );

  /** 切换收藏状态 */
  const toggleBookmark = useCallback(
    (id: string) => {
      setBookmarks((prev) => {
        if (prev.includes(id)) {
          return prev.filter((b) => b !== id);
        }
        return [...prev, id];
      });
    },
    [setBookmarks],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, [setSidebarOpen]);

  /** 上一节 */
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setSelectedId(allQuestions[currentIndex - 1].id);
      document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentIndex, allQuestions, setSelectedId]);

  /** 下一节 */
  const handleNext = useCallback(() => {
    if (currentIndex < totalQuestions - 1) {
      setSelectedId(allQuestions[currentIndex + 1].id);
      document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentIndex, allQuestions, totalQuestions, setSelectedId]);

  /** 最后一节：回到顶部 */
  const handleScrollToTop = useCallback(() => {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /** 找到选中问题所属章节 */
  const currentChapter = useMemo(() => {
    if (!selectedAnswer) return null;
    return chapters.find((c) => c.id === selectedAnswer.chapter) || null;
  }, [selectedAnswer, chapters]);

  /** 当前问题在所属章节中的位置（用于面包屑） */
  const questionIndexInChapter = useMemo(() => {
    if (!selectedAnswer || !currentChapter) return null;
    const chQuestions = questionsByChapter[currentChapter.id] || [];
    const idx = chQuestions.findIndex((q) => q.id === selectedAnswer.id);
    return idx >= 0 ? { index: idx + 1, total: chQuestions.length } : null;
  }, [selectedAnswer, currentChapter, questionsByChapter]);

  /** aria-live 内容播报文本 */
  const contentAnnouncement = useMemo(() => {
    if (!selectedAnswer) return "学习进度仪表盘";
    const chapter = currentChapter?.title || "";
    return chapter
      ? `${chapter} · ${selectedAnswer.question}`
      : selectedAnswer.question;
  }, [selectedAnswer, currentChapter]);

  /** 切换沉浸模式 */
  const toggleImmersive = useCallback(() => {
    setImmersive((prev) => !prev);
  }, []);

  // ── beforeunload 兜底：页面关闭/刷新前保存滚动位置 ──
  useEffect(() => {
    const onBeforeUnload = () => {
      const main = document.querySelector("main");
      if (!main || !selectedAnswer) return;
      const total = main.scrollHeight - main.clientHeight;
      if (total <= 0) return;
      const pct = Math.round((main.scrollTop / total) * 100);
      // 同步写入 localStorage（beforeunload 内异步不保证执行）
      try {
        const raw = localStorage.getItem(LEARN_SCROLL_POSITIONS_KEY);
        const prev: Record<string, number> = raw ? JSON.parse(raw) : {};
        prev[selectedAnswer.id] = pct;
        localStorage.setItem(
          LEARN_SCROLL_POSITIONS_KEY,
          JSON.stringify(prev),
        );
      } catch {
        // 私密浏览或无存储空间，静默失败
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [selectedAnswer]);

  // ── 断点续读：返回已读问题时恢复滚动位置 ──
  useEffect(() => {
    const id = selectedAnswer?.id;
    if (!id) return;
    const savedPct = scrollPositions[id];
    if (savedPct === undefined || savedPct <= 5) return; // ≤5% 视为"在顶部"，不恢复
    const main = document.querySelector("main");
    if (!main) return;
    // 等待内容渲染完成再恢复位置
    const raf = requestAnimationFrame(() => {
      const total = main.scrollHeight - main.clientHeight;
      if (total <= 0) return;
      // 短内容不恢复（总高度 < 1.5 × 视口高度）
      if (main.scrollHeight < main.clientHeight * 1.5) return;
      const target = Math.min((savedPct / 100) * total, total);
      main.scrollTo({ top: target, behavior: "instant" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedAnswer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 仅在问题 ID 变化时触发；不依赖 scrollPositions 避免恢复后重新执行

  /** 沉浸模式 side effects: body class + 阅读进度 + Esc 退出 + 控件自动隐藏。 */
  useEffect(() => {
    const main = document.querySelector("main");
    if (immersive) {
      document.body.classList.add("gm-immersive");
      const handler = () => {
        if (!main) return;
        const scrolled = main.scrollTop;
        const total = main.scrollHeight - main.clientHeight;
        setReadingProgress(
          total > 0
            ? Math.min(100, Math.round((scrolled / total) * 100))
            : 0,
        );
      };
      main?.addEventListener("scroll", handler, { passive: true });

      // 控件自动隐藏：2s 无鼠标移动 → 添加 idle class
      let idleTimeout: ReturnType<typeof setTimeout>;
      const resetIdle = () => {
        const track = document.querySelector(".immersive-progress-track");
        const pct = document.querySelector(".immersive-percentage");
        const btn = document.querySelector(".immersive-exit-btn");
        track?.classList.remove("immersive-controls--idle");
        pct?.classList.remove("immersive-controls--idle");
        btn?.classList.remove("immersive-controls--idle");
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          track?.classList.add("immersive-controls--idle");
          pct?.classList.add("immersive-controls--idle");
          btn?.classList.add("immersive-controls--idle");
        }, 2000);
      };
      main?.addEventListener("mousemove", resetIdle, { passive: true });
      main?.addEventListener("scroll", resetIdle, { passive: true });
      resetIdle(); // 启动初始计时器

      const escHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") setImmersive(false);
      };
      window.addEventListener("keydown", escHandler);
      return () => {
        document.body.classList.remove("gm-immersive");
        window.removeEventListener("keydown", escHandler);
        main?.removeEventListener("scroll", handler);
        main?.removeEventListener("mousemove", resetIdle);
        main?.removeEventListener("scroll", resetIdle);
        clearTimeout(idleTimeout);
      };
    } else {
      document.body.classList.remove("gm-immersive");
      const id = setTimeout(() => setReadingProgress(0), 0);
      return () => {
        clearTimeout(id);
      };
    }
  }, [immersive]);

  /** 字号偏好 body class 管理：gm-font-sm / gm-font-lg（默认 md 不额外加 class）。 */
  useEffect(() => {
    document.body.classList.remove("gm-font-sm", "gm-font-lg");
    if (fontSize === "sm") {
      document.body.classList.add("gm-font-sm");
    } else if (fontSize === "lg") {
      document.body.classList.add("gm-font-lg");
    }
    return () => {
      document.body.classList.remove("gm-font-sm", "gm-font-lg");
    };
  }, [fontSize]);

  // ── Sidebar slot（桌面端；沉浸模式显式隐藏）──
  const sidebarSlot: React.ReactNode | false =
    !immersive ? (
      <div
        className={`sidebar-panel${
          sidebarOpen ? "" : " sidebar-panel--collapsed"
        }`}
      >
        <QuestionList
          chapters={chapters}
          questionsByChapter={questionsByChapter}
          selectedId={sidebarSelectedId}
          onSelect={(answer) => {
            handleSelect(answer);
          }}
          onSearchChange={setSearchQuery}
          collapsedChapters={collapsedIds}
          onCollapsedChange={setCollapsedIds}
          visitHistory={visitHistoryAnswers}
          bookmarks={bookmarks}
        />
      </div>
    ) : false;

  return (
    <AppShell sidebar={sidebarSlot}>
      {/* 内容播报（aria-live，屏幕阅读器专用） */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {contentAnnouncement}
      </div>
      <div className="flex h-full">
        {/* ── 大屏内容区：AppShell <main> 提供滚动 ── */}
        <div className="hidden lg:flex flex-col flex-1">
          {/* 内容区顶栏：目录切换 + 当前章节 + 导航 + 进度 + 沉浸按钮 */}
          {!immersive && selectedAnswer && (
            <div className="sticky top-0 z-10 flex items-center gap-gm-2 px-gm-4 py-gm-2 bg-bg-subtle border-b border-border">
              <button
                onClick={toggleSidebar}
                className="sidebar-toggle-btn"
                title={sidebarOpen ? "收起目录" : "展开目录"}
                aria-label={sidebarOpen ? "收起目录" : "展开目录"}
              >
                {sidebarOpen ? (
                  <RiMenuFoldLine className="w-gm-icon-md h-gm-icon-md" />
                ) : (
                  <RiMenuUnfoldLine className="w-gm-icon-md h-gm-icon-md" />
                )}
              </button>

              <button
                onClick={goToDashboard}
                className="learn-nav-btn group relative focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
                aria-label="学习进度"
              >
                <RiBarChart2Line className="w-gm-icon-md h-gm-icon-md" />
                <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-gm-md bg-deep px-gm-2 py-gm-1 text-gm-xs text-inverse opacity-0 transition-opacity group-hover:opacity-100">
                  学习进度
                </span>
              </button>

              <span className="text-gm-xs text-text-muted">
                {selectedAnswer?.chapterTitle ? formatChapterTitle(selectedAnswer.chapterTitle) : currentChapter?.title || ""}
                {questionIndexInChapter && (
                  <> · 第{questionIndexInChapter.index}问 / {questionIndexInChapter.total}问</>
                )}
              </span>

              {/* 阅读导航 */}
              <div className="flex items-center gap-gm-1 ml-auto">
                <span className="text-gm-xs text-text-muted tabular-nums mr-gm-1">
                  {currentIndex + 1}/{totalQuestions}
                </span>

                <button
                  onClick={handlePrev}
                  disabled={isFirst}
                  className="learn-nav-btn"
                  title={isFirst ? "已是第一节" : "上一节"}
                  aria-label="上一节"
                >
                  <RiArrowUpSLine className="w-gm-icon-md h-gm-icon-md" />
                </button>

                {isLast ? (
                  <button
                    onClick={handleScrollToTop}
                    className="learn-nav-btn"
                    title="回到顶部"
                    aria-label="回到顶部"
                  >
                    <RiArrowDownSLine className="w-gm-icon-md h-gm-icon-md" />
                  </button>
                ) : (
                  <button
                    onClick={handleNext}
                    className="learn-nav-btn"
                    title="下一节"
                    aria-label="下一节"
                  >
                    <RiArrowDownSLine className="w-gm-icon-md h-gm-icon-md" />
                  </button>
                )}

                <div className="ml-gm-2">
                  <button
                    onClick={() =>
                      setFontSize((prev) =>
                        prev === "sm" ? "md" : prev === "md" ? "lg" : "sm",
                      )
                    }
                    className="learn-nav-btn"
                    title={`字号：${
                      fontSize === "sm" ? "小" : fontSize === "lg" ? "大" : "中"
                    }`}
                    aria-label={`字号：${fontSize === "sm" ? "小" : fontSize === "lg" ? "大" : "中"}`}
                  >
                    <RiFontSize className="w-gm-icon-md h-gm-icon-md" />
                  </button>
                </div>

                <div className="ml-gm-2">
                  <button
                    onClick={toggleImmersive}
                    className="learn-nav-btn"
                    title="沉浸阅读"
                    aria-label="沉浸阅读"
                  >
                    <RiFullscreenLine className="w-gm-icon-md h-gm-icon-md" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 内容主体 */}
          <div
            className={`flex-1 mx-auto px-gm-8 py-gm-8 ${
              immersive
                ? "immersive-content max-w-[720px]"
                : "max-w-5xl"
            }`}
          >
            {selectedAnswer ? (
              <>
                <div className="max-w-3xl mx-auto w-full">
                  <AnswerCard
                    answer={selectedAnswer}
                    immersive={immersive}
                    isBookmarked={bookmarks.includes(selectedAnswer.id)}
                    onToggleBookmark={() => toggleBookmark(selectedAnswer.id)}
                    searchQuery={searchQuery}
                    estimatedReadingTime={readingTime}
                    noteHighlights={noteHighlights}
                    onAddNote={(text) => setPendingSelectionText(text)}
                    questionIndex={questionIndexInChapter ?? undefined}
                  />
                </div>

                {/* B66: NotesPanel — 划词笔记面板 */}
                {!immersive && (
                  <div className="max-w-3xl mx-auto w-full mt-gm-6">
                    <NotesPanel
                      questionId={selectedAnswer.id}
                      initialSelectedText={pendingSelectionText ?? undefined}
                      onNoteCreated={() => setPendingSelectionText(null)}
                    />
                  </div>
                )}

                {/* 底部导航（桌面端，沉浸模式隐藏） */}
                {!immersive && totalQuestions > 0 && (
                  <div className="learn-nav-bottom flex">
                    <button
                      onClick={handlePrev}
                      disabled={isFirst}
                      className="learn-nav-bottom-btn"
                    >
                      <RiArrowLeftSLine className="w-4 h-4" />
                      上一节
                    </button>

                    <span className="text-gm-xs text-text-muted tabular-nums">
                      {currentIndex + 1}/{totalQuestions}
                    </span>

                    {isLast ? (
                      <button
                        onClick={handleScrollToTop}
                        className="learn-nav-top-btn"
                      >
                        <RiArrowUpSLine className="w-4 h-4" />
                        回到顶部
                      </button>
                    ) : (
                      <button
                        onClick={handleNext}
                        className="learn-nav-bottom-btn"
                      >
                        下一节
                        <RiArrowRightSLine className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
          <ContentDashboard chapters={chapters} questionsByChapter={questionsByChapter} lastReadId={storedId} onNavigate={handleSelect} visitHistory={visitHistoryAnswers} />
            )}
          </div>

          {/* 沉浸模式浮动控件 */}
          {immersive && selectedAnswer && (
            <>
              {/* 顶部阅读进度条（YouTube/Medium 风格） */}
              <div
                className="immersive-top-progress"
                style={{ width: `${readingProgress}%` }}
              />

              <div className="immersive-progress-track">
                <div
                  className="immersive-progress-fill"
                  style={{ height: `${readingProgress}%` }}
                />
              </div>

              <div className="immersive-percentage">
                {readingProgress}%
                {readingTime !== undefined && readingTime > 0 && (
                  <>{' · '}{formatReadingTime(readingTime)}</>
                )}
              </div>

              <button
                onClick={toggleImmersive}
                className="immersive-exit-btn"
                aria-label="退出沉浸模式"
                title="退出沉浸模式 (Esc)"
              >
                <RiFullscreenExitLine className="w-4 h-4" />
                <span>退出</span>
              </button>
            </>
          )}
        </div>

        {/* ── 小屏：单栏切换 ── */}
        <div className="lg:hidden flex-1 overflow-y-auto">
          {selectedAnswer ? (
            <div className="px-gm-4 py-gm-4">
              <AnswerCard
                answer={selectedAnswer}
                onBack={handleBack}
                isBookmarked={bookmarks.includes(selectedAnswer.id)}
                onToggleBookmark={() => toggleBookmark(selectedAnswer.id)}
                searchQuery={searchQuery}
                estimatedReadingTime={readingTime}
                noteHighlights={noteHighlights}
                onAddNote={(text) => setPendingSelectionText(text)}
                questionIndex={questionIndexInChapter ?? undefined}
              />
              {/* B66: NotesPanel — 移动端笔记面板 */}
              <div className="mt-gm-4">
                <NotesPanel
                  questionId={selectedAnswer.id}
                  initialSelectedText={pendingSelectionText ?? undefined}
                  onNoteCreated={() => setPendingSelectionText(null)}
                />
              </div>
            </div>
          ) : (
            <ContentDashboard
              chapters={chapters}
              questionsByChapter={questionsByChapter}
              lastReadId={storedId}
              onNavigate={handleSelect}
              visitHistory={visitHistoryAnswers}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/**
 * 内容进度仪表盘 — 当未选中问题时展示。
 * 用 chapters 元数据的 answeredCount/questionCount 渲染总进度条 + 每章进度行。
 * 有阅读记录时优先推荐"继续阅读"；无记录时推荐完成率最高的章节。
 */
function ContentDashboard({
  chapters,
  questionsByChapter,
  lastReadId,
  onNavigate,
  visitHistory,
}: {
  chapters: Chapter[];
  questionsByChapter: Record<string, Answer[]>;
  lastReadId: string | null;
  onNavigate?: (answer: Answer) => void;
  /** 最近阅读的问题列表（最多 5 条），用于仪表盘"最近阅读"区域。 */
  visitHistory?: Answer[];
}) {
  const totalAnswered = chapters.reduce((s, c) => s + c.answeredCount, 0);
  const totalQuestions = chapters.reduce((s, c) => s + c.questionCount, 0);
  const totalPct =
    totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0;

  // ── 推荐阅读：优先"继续阅读" ──

  /** 找到上次阅读问题所属章节的下一个未答问题 */
  const continueReading = useMemo(() => {
    if (!lastReadId) return null;
    const lastAnswer = getAnswerById(lastReadId);
    if (!lastAnswer) return null;
    const chQuestions =
      lastAnswer && chapters.find((c) => c.id === lastAnswer.chapter)
        ? (questionsByChapter || {})[lastAnswer.chapter]
        : null;
    if (!chQuestions || chQuestions.length === 0) return null;

    // 从上次阅读位置往后找下一个 stub（l0 === ""）
    const lastIdx = chQuestions.findIndex((q) => q.id === lastReadId);
    if (lastIdx === -1) return null;
    const nextUnanswered = chQuestions
      .slice(lastIdx + 1)
      .find((q) => q.l0 === "");
    if (!nextUnanswered) return null;
    const ch = chapters.find((c) => c.id === nextUnanswered.chapter);
    return ch ? { chapter: ch, question: nextUnanswered } : null;
  }, [lastReadId, chapters, questionsByChapter]);

  /** 最佳完成率章节（回退推荐） */
  const bestChapter = useMemo(
    () =>
      chapters
        .filter((c) => c.answeredCount > 0)
        .sort((a, b) => {
          const ra = a.answeredCount / a.questionCount;
          const rb = b.answeredCount / b.questionCount;
          return rb - ra || b.answeredCount - a.answeredCount;
        })[0] ?? null,
    [chapters],
  );

  /** 推荐章节的第一个可读问题（优先未答，全答完则取第一个） */
  const bestChapterFirstQuestion = useMemo(() => {
    if (!bestChapter) return null;
    const questions = questionsByChapter[bestChapter.id];
    if (!questions || questions.length === 0) return null;
    const unanswered = questions.find((q) => q.l0 === "");
    return unanswered || questions[0];
  }, [bestChapter, questionsByChapter]);

  const CIRCUMFERENCE = 2 * Math.PI * 52; // r=52 for SVG ring

  return (
    <div className="flex flex-col items-center gap-gm-5 w-full max-w-3xl mx-auto py-gm-6" data-testid="content-dashboard">
      {/* ── 环形总进度 ── */}
      <div className="flex items-center gap-gm-6 w-full">
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120" role="progressbar" aria-valuenow={Math.round(totalPct)} aria-valuemin={0} aria-valuemax={100} aria-label={`总学习进度 ${Math.round(totalPct)}%`}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-surface-alt" />
            <circle
              cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - totalPct / 100)}
              className="text-brand transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-gm-2xl font-bold text-text">{Math.round(totalPct)}%</span>
          </div>
        </div>
        <div className="flex flex-col gap-gm-1">
          <h2 className="text-gm-xl font-semibold text-text">学习进度</h2>
          <p className="text-gm-sm text-text-muted leading-relaxed">
            {chapters.length} 章 · {totalQuestions} 问
          </p>
          <p className="text-gm-sm text-text-secondary">
            已完成 <strong className="text-text">{totalAnswered}</strong> / {totalQuestions}
          </p>
        </div>
      </div>

      {/* ── 继续阅读（主要 CTA）── */}
      {continueReading && (
        <button
          type="button"
          onClick={() => onNavigate?.(continueReading.question)}
          className="w-full text-left cursor-pointer rounded-gm-lg border border-l-2 border-l-brand border-border bg-brand/10 px-gm-5 py-gm-4 transition-all hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-gm-2">
              <RiBookOpenLine className="w-gm-icon-md h-gm-icon-md text-brand" />
              <span className="text-gm-sm font-semibold text-brand">继续阅读</span>
            </div>
            <span className="text-gm-sm text-brand">→</span>
          </div>
          <p className="mt-gm-1 text-gm-sm text-text">
            {continueReading.chapter.title} · {continueReading.question.question}
          </p>
        </button>
      )}

      {/* ── 各章节进度 ── */}
      <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gm-3">
        {chapters.map((ch) => {
          const pct =
            ch.questionCount > 0
              ? (ch.answeredCount / ch.questionCount) * 100
              : 0;
          const isComplete =
            ch.answeredCount > 0 && ch.answeredCount === ch.questionCount;
          const isBlank = ch.answeredCount === 0;

          return (
            <button
              key={ch.id}
              type="button"
              data-testid={`chapter-card-${ch.id}`}
              onClick={() => {
                const questions = questionsByChapter[ch.id];
                if (!questions || questions.length === 0) return;
                const target = questions.find(q => q.l0 === "") || questions[0];
                onNavigate?.(target);
              }}
              className="flex items-center gap-gm-3 px-gm-4 py-gm-3 rounded-gm-lg bg-surface-elevated border border-border text-left w-full transition-all hover:bg-surface-hover cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
            >
              {(() => {
                const Icon = CHAPTER_ICON_MAP[ch.icon];
                return Icon ? <Icon className="w-gm-icon-md h-gm-icon-md text-text-secondary flex-shrink-0" /> : null;
              })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-gm-1">
                  <span className="text-gm-sm font-medium text-text truncate">{ch.title}</span>
                  <span className="text-gm-xs text-text-muted tabular-nums ml-gm-2 flex-shrink-0">
                    {ch.answeredCount}/{ch.questionCount}
                  </span>
                </div>
                <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${ch.title} 完成进度 ${Math.round(pct)}%`}>
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isComplete ? "bg-success-light" : isBlank ? "bg-border-strong" : "bg-brand"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="flex-shrink-0 w-16 text-right">
                {isComplete && (
                  <span className="inline-flex items-center gap-gm-1 text-gm-xs text-success font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    完成
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 推荐阅读 ── */}
      {!continueReading && bestChapter && bestChapterFirstQuestion && (
        <button
          type="button"
          onClick={() => onNavigate?.(bestChapterFirstQuestion)}
          className="w-full text-left cursor-pointer rounded-gm-lg border border-border bg-brand/5 px-gm-4 py-gm-3 transition-all hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-gm-2">
              <RiLightbulbLine className="w-gm-icon-md h-gm-icon-md" />
              <span className="text-gm-sm font-semibold text-brand">推荐阅读</span>
            </div>
            <span className="text-gm-sm text-brand">→</span>
          </div>
          <p className="mt-gm-1 text-gm-sm text-text">
            {bestChapter.title} · {bestChapter.answeredCount === bestChapter.questionCount
              ? `${bestChapter.questionCount} 问全部完成`
              : `已完成 ${bestChapter.answeredCount}/${bestChapter.questionCount} 问`}
          </p>
        </button>
      )}

      {/* ── B64 最近阅读 ── */}
      {visitHistory && visitHistory.length > 0 && (
        <>
          <hr className="w-full border-border" />
          <div className="w-full">
            <h3 className="text-gm-sm font-semibold text-text-secondary mb-gm-3">
              最近阅读
            </h3>
            <div className="flex flex-col gap-gm-1">
              {visitHistory.slice(0, 5).map((a) => {
                const ch = chapters.find((c) => c.id === a.chapter);
                const Icon = ch ? CHAPTER_ICON_MAP[ch.icon] : null;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onNavigate?.(a)}
                    className="flex items-center gap-gm-2 px-gm-3 py-gm-2 rounded-gm-md
                               bg-surface-elevated border border-border hover:bg-surface-hover
                               transition-colors text-left w-full
                               focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
                  >
                    {Icon && <Icon className="w-gm-icon-sm h-gm-icon-sm text-text-muted flex-shrink-0" />}
                    <span className="text-gm-sm text-text truncate flex-1">
                      {a.question}
                    </span>
                    {ch && (
                      <span className="text-gm-xs text-text-muted flex-shrink-0 hidden sm:inline">
                        {ch.title}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

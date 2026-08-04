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
  RiFontSize,
} from "@remixicon/react";
import type { Answer, Chapter } from "@/lib/content/types";
import { getAnswerById } from "@/lib/content/questions";
import { ContentDashboard } from "./ContentDashboard";
import { estimateReadingTime, formatReadingTime } from "@/lib/content/estimateReadingTime";
import { formatChapterTitle } from "@/lib/formatChapter";
import AppShell from "@/components/layout/AppShell";
import QuestionList from "@/components/learn/QuestionList";
import AnswerCard from "@/components/learn/AnswerCard";
import NotesPanel from "@/components/learn/NotesPanel";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useLearnProgress, computeAllChapterProgress } from "@/hooks/useLearnProgress";
import type { LearnNote, ChapterProgress } from "@/lib/constants";
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
/** 沉浸模式控件自动隐藏延迟（ms）。Phase 1000 B109 从内联魔数 2000 提取。 */
const IMMERSIVE_IDLE_TIMEOUT_MS = 2000;

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

  /** 用户学习进度 — 基于 localStorage 持久化的问题阅读记录。 */
  const { progress: userProgress, markViewed } = useLearnProgress();

  /** 按章节汇总的用户进度（供 ContentDashboard / QuestionList 消费）。 */
  const chapterProgressMap = useMemo<Record<string, ChapterProgress>>(
    () => computeAllChapterProgress(userProgress, questionsByChapter),
    [userProgress, questionsByChapter],
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

  // Phase 66 B106 — 即时 tooltip 替代原生 title (T16-T22: 侧栏/导航/字号/沉浸按钮)
  const [learnTooltip, setLearnTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

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
      markViewed(answer.id);
      setVisitHistoryIds((prev) => {
        // 滑动窗口：去重后追加到队首，最多 5 条
        const next = [answer.id, ...prev.filter((id) => id !== answer.id)].slice(
          0,
          5,
        );
        return next;
      });
    },
    [setSelectedId, setVisitHistoryIds, selectedAnswer, saveCurrentScrollPosition, markViewed],
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
        }, IMMERSIVE_IDLE_TIMEOUT_MS);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 对标 B89 消除模式，退出沉浸模式同步复位进度
      setReadingProgress(0);
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
          userProgress={chapterProgressMap}
        />
      </div>
    ) : false;

  return (
    <>
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
                className="sidebar-toggle-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                onMouseEnter={(e) => setLearnTooltip({ x: e.clientX, y: e.clientY, text: sidebarOpen ? "收起目录" : "展开目录" })}
                onMouseMove={(e) => setLearnTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={() => setLearnTooltip(null)}
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
                className="learn-nav-btn group relative focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
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
                  className="learn-nav-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                  onMouseEnter={(e) => setLearnTooltip({ x: e.clientX, y: e.clientY, text: isFirst ? "已是第一节" : "上一节" })}
                  onMouseMove={(e) => setLearnTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                  onMouseLeave={() => setLearnTooltip(null)}
                  aria-label="上一节"
                >
                  <RiArrowUpSLine className="w-gm-icon-md h-gm-icon-md" />
                </button>

                {isLast ? (
                  <button
                    onClick={handleScrollToTop}
                    className="learn-nav-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                    onMouseEnter={(e) => setLearnTooltip({ x: e.clientX, y: e.clientY, text: "回到顶部" })}
                    onMouseMove={(e) => setLearnTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={() => setLearnTooltip(null)}
                    aria-label="回到顶部"
                  >
                    <RiArrowDownSLine className="w-gm-icon-md h-gm-icon-md" />
                  </button>
                ) : (
                  <button
                    onClick={handleNext}
                    className="learn-nav-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                    onMouseEnter={(e) => setLearnTooltip({ x: e.clientX, y: e.clientY, text: "下一节" })}
                    onMouseMove={(e) => setLearnTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={() => setLearnTooltip(null)}
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
                    className="learn-nav-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                    onMouseEnter={(e) => setLearnTooltip({ x: e.clientX, y: e.clientY, text: `字号：${fontSize === "sm" ? "小" : fontSize === "lg" ? "大" : "中"}` })}
                    onMouseMove={(e) => setLearnTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={() => setLearnTooltip(null)}
                    aria-label={`字号：${fontSize === "sm" ? "小" : fontSize === "lg" ? "大" : "中"}`}
                  >
                    <RiFontSize className="w-gm-icon-md h-gm-icon-md" />
                  </button>
                </div>

                <div className="ml-gm-2">
                  <button
                    onClick={toggleImmersive}
                    className="learn-nav-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                    onMouseEnter={(e) => setLearnTooltip({ x: e.clientX, y: e.clientY, text: "沉浸阅读" })}
                    onMouseMove={(e) => setLearnTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={() => setLearnTooltip(null)}
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
                      className="learn-nav-bottom-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
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
                        className="learn-nav-top-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                      >
                        <RiArrowUpSLine className="w-4 h-4" />
                        回到顶部
                      </button>
                    ) : (
                      <button
                        onClick={handleNext}
                        className="learn-nav-bottom-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                      >
                        下一节
                        <RiArrowRightSLine className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
          <ContentDashboard chapters={chapters} questionsByChapter={questionsByChapter} lastReadId={storedId} onNavigate={handleSelect} visitHistory={visitHistoryAnswers} userProgress={chapterProgressMap} />
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
                className="immersive-exit-btn focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                aria-label="退出沉浸模式"
                onMouseEnter={(e) => setLearnTooltip({ x: e.clientX, y: e.clientY, text: "退出沉浸模式 (Esc)" })}
                onMouseMove={(e) => setLearnTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={() => setLearnTooltip(null)}
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
              userProgress={chapterProgressMap}
            />
          )}
        </div>
      </div>
    </AppShell>
    {/* Phase 66 B106 — T16-T22: 即时 tooltip 替代原生 title (7 处按钮) */}
    {learnTooltip && (
      <div
        className="fixed z-50 rounded-gm-sm border border-border-strong bg-surface-elevated px-gm-2.5 py-gm-1.5 shadow-gm-md pointer-events-none"
        style={{ left: learnTooltip.x + 12, top: learnTooltip.y - 8 }}
      >
        <p className="text-gm-xs text-text whitespace-nowrap">{learnTooltip.text}</p>
      </div>
    )}
    </>
  );
}

// ContentDashboard 已抽取至 ./ContentDashboard.tsx（Phase 66 B97）

"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  RiSearchLine,
  RiCloseLine,
  RiArrowDownSLine,
  RiStarFill,
} from "@remixicon/react";
import type { Answer, Chapter } from "@/lib/content/types";
import type { ChapterProgress } from "@/lib/constants";
import type { MatchSnippet } from "@/lib/content/search";
import {
  createSearchIndex,
  extractBestSnippet,
  getSnippetParts,
  renderSnippetParts,
  FIELD_LABELS,
} from "@/lib/content/search";

import { toChineseNumeral } from "@/lib/formatChapter";

export interface QuestionListProps {
  /** 全部章节 */
  chapters: Chapter[];
  /** 按章节 ID 分组的问题 */
  questionsByChapter: Record<string, Answer[]>;
  /** 当前选中的问题 ID */
  selectedId: string | null;
  /** 问题选择回调 */
  onSelect: (answer: Answer) => void;
  /** 搜索回调 — 向父组件同步搜索状态（可选） */
  onSearchChange?: (query: string) => void;
  /**
   * 外部折叠状态（从 localStorage 恢复）。
   * 提供时组件使用受控折叠，不提供则内部管理。
   */
  collapsedChapters?: string[];
  /** 折叠状态变更回调（配合 collapsedChapters 使用） */
  onCollapsedChange?: (ids: string[]) => void;
  /** 最近阅读的问题列表（已解析的 Answer 对象，最多 5 条） */
  visitHistory?: Answer[];
  /** 已收藏的问题 ID 列表 */
  bookmarks?: string[];
  /** 用户学习进度（按章节汇总）。提供时优先用于进度条展示，否则 fallback 到 chapter.answeredCount。 */
  userProgress?: Record<string, ChapterProgress>;
}

/**
 * 问题列表组件 (Batch 145 重构版)。
 *
 * 替代原章节标签页+单章问题列表模式，改为：
 * 1. 顶部搜索框 — 实时过滤问题标题
 * 2. 全章节树形目录 — 每章可折叠/展开
 * 3. 搜索时自动展开匹配章节
 *
 * 大屏（>=lg）：左侧 280px 固定侧栏（可折叠）
 * 小屏（<lg）：全宽单栏布局
 */
export default function QuestionList({
  chapters,
  questionsByChapter,
  selectedId,
  onSelect,
  onSearchChange,
  collapsedChapters: collapsedProp,
  onCollapsedChange,
  visitHistory,
  bookmarks,
  userProgress,
}: QuestionListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [answerFilter, setAnswerFilter] = useState<
    "all" | "answered"
  >("all");
  const [bookmarkFilter, setBookmarkFilter] = useState(false);
  const [internalCollapsed, setInternalCollapsed] = useState<Set<string>>(
    new Set(),
  );

  /** 某章的用户已读数，无 userProgress 时 fallback 到内容 answeredCount。 */
  const chapterViewed = useCallback(
    (ch: Chapter): number =>
      userProgress?.[ch.id]?.viewed ?? ch.answeredCount,
    [userProgress],
  );

  // 受控 vs 非受控折叠状态：外部提供 prop 时使用外部状态，否则内部管理
  const collapsedChapters = useMemo(
    () => (collapsedProp ? new Set(collapsedProp) : internalCollapsed),
    [collapsedProp, internalCollapsed],
  );

  const searchInputRef = useRef<HTMLInputElement>(null);

  /** 用于全文搜索的全量问题列表（展平） */
  const allQuestionsForSearch = useMemo(
    () => chapters.flatMap((ch) => questionsByChapter[ch.id] || []),
    [chapters, questionsByChapter],
  );

  /** Fuse.js 搜索索引（全量问题，仅创建一次） */
  const searchIndex = useMemo(
    () =>
      allQuestionsForSearch.length > 0
        ? createSearchIndex(allQuestionsForSearch)
        : null,
    [allQuestionsForSearch],
  );

  /** Fuse.js 搜索结果（按 query 匹配全量问题，与 status filter 无关） */
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !searchIndex) return null;
    return searchIndex.search(searchQuery.trim());
  }, [searchQuery, searchIndex]);

  /** 从搜索匹配中提取的摘要映射（answerId → snippet），用于渲染匹配上下文 */
  const snippetMap = useMemo<Record<string, MatchSnippet>>(() => {
    if (!searchResults) return {};
    const map: Record<string, MatchSnippet> = {};
    for (const r of searchResults) {
      const snippet = extractBestSnippet(r);
      if (snippet) map[r.item.id] = snippet;
    }
    return map;
  }, [searchResults]);

  /** 切换书签过滤 */
  const toggleBookmarkFilter = useCallback(() => {
    setBookmarkFilter((prev) => !prev);
  }, []);

  /** 切换回答状态过滤 */
  const setFilter = useCallback((v: "all" | "answered") => {
    setAnswerFilter(v);
  }, []);

  // 只显示有问题列表的章节
  const visibleChapters = useMemo(
    () => chapters.filter((c) => (questionsByChapter[c.id]?.length || 0) > 0),
    [chapters, questionsByChapter],
  );

  /** 是否处于文本搜索模式（区别于纯 filter 模式） */
  const hasTextSearch = searchQuery.trim().length > 0;

  /** 是否激活了 answer 或 priority 或 bookmark 过滤 */
  const hasStatusFilter = answerFilter !== "all" || bookmarkFilter;

  /** 问题→章节内位置映射（用于序号显示） */
  const questionChapterPosition = useMemo(() => {
    const map: Record<string, { index: number; total: number }> = {};
    for (const ch of chapters) {
      const questions = questionsByChapter[ch.id] || [];
      questions.forEach((q, i) => {
        map[q.id] = { index: i + 1, total: questions.length };
      });
    }
    return map;
  }, [chapters, questionsByChapter]);

  /**
   * 过滤数据流水线：
   * 1. answer status 过滤 → 2. priority 过滤 → 3. 文本搜索
   * 返回 null 表示无任何过滤（浏览模式），返回数组表示已过滤。
   */
  const filteredData = useMemo(() => {
    if (!hasStatusFilter && !hasTextSearch) return null;

    const q = searchQuery.trim().toLowerCase();

    return visibleChapters
      .map((ch) => {
        let questions = questionsByChapter[ch.id] || [];

        // Step 1: Answer status filter
        if (answerFilter === "answered") {
          questions = questions.filter((qa) => qa.l0 !== "");
        }

        // Step 2: Bookmark filter
        if (bookmarkFilter && bookmarks && bookmarks.length > 0) {
          questions = questions.filter((qa) => bookmarks.includes(qa.id));
        }

        // Step 3: Full-text search with Fuse.js
        if (q && searchResults) {
          const matchedIds = new Set(searchResults.map((r) => r.item.id));
          questions = questions.filter((qa) => matchedIds.has(qa.id));
        }

        return { chapter: ch, questions };
      })
      .filter((item) => item.questions.length > 0);
  }, [
    searchQuery,
    visibleChapters,
    questionsByChapter,
    answerFilter,
    bookmarkFilter,
    bookmarks,
    searchResults,
    hasStatusFilter,
    hasTextSearch,
  ]);

  const hasAnyFilter = hasStatusFilter || hasTextSearch;
  const isEmptyFilterResult = hasAnyFilter && filteredData?.length === 0;

  /** aria-live 搜索播报文本 */
  const searchAnnouncement = useMemo(() => {
    if (!hasTextSearch || !searchQuery.trim()) return "";
    if (isEmptyFilterResult) {
      return `未找到匹配"${searchQuery.trim()}"的问题`;
    }
    const total = filteredData?.reduce((sum, item) => sum + item.questions.length, 0) ?? 0;
    return `搜索"${searchQuery.trim()}"，找到 ${total} 个结果`;
  }, [hasTextSearch, searchQuery, isEmptyFilterResult, filteredData]);

  /** 切换章节折叠状态 */
  const toggleChapter = useCallback((chId: string) => {
    if (collapsedProp !== undefined) {
      const next = new Set(collapsedChapters);
      if (next.has(chId)) next.delete(chId);
      else next.add(chId);
      onCollapsedChange?.(Array.from(next));
    } else {
      setInternalCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(chId)) next.delete(chId);
        else next.add(chId);
        return next;
      });
    }
  }, [collapsedChapters, collapsedProp, onCollapsedChange]);

  /** 处理搜索输入 */
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchQuery(value);
      onSearchChange?.(value);
    },
    [onSearchChange],
  );

  /** 清除搜索 */
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    onSearchChange?.("");
    searchInputRef.current?.focus();
  }, [onSearchChange]);

  /** 键盘快捷键："/" 聚焦搜索 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <aside className="flex flex-col h-full border-r border-border bg-surface-lowered">
      {/* 搜索框 */}
      <div className="search-bar-container">
        <RiSearchLine className="search-bar-icon" />
        <input
          ref={searchInputRef}
          type="text"
          className="search-bar-input"
          placeholder="搜索问题、概念、关键词…"
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="搜索问题、概念、关键词"
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            className="search-bar-clear focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
            aria-label="清除搜索"
          >
            <RiCloseLine className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 过滤芯片行 */}
      <div className="flex flex-wrap items-center gap-0.5 lg:gap-1 px-gm-2 lg:px-gm-3 py-gm-1 lg:py-gm-1_5 border-b border-border">
        {/* 回答状态切换 */}
        <FilterChip
          active={answerFilter === "all"}
          onClick={() => setFilter("all")}
        >
          全部
        </FilterChip>
        <FilterChip
          active={answerFilter === "answered"}
          onClick={() => setFilter("answered")}
        >
          已答
        </FilterChip>

        {/* 收藏过滤（仅当有收藏时显示） */}
        {bookmarks && bookmarks.length > 0 && (
          <>
            <span className="w-px h-4 bg-border mx-gm-1" />
            <FilterChip
              active={bookmarkFilter}
              onClick={toggleBookmarkFilter}
            >
              收藏 {bookmarks.length}
            </FilterChip>
          </>
        )}
      </div>

      {/* 搜索播报（aria-live，屏幕阅读器专用） */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {searchAnnouncement}
      </div>

      {/* 章节树形目录 + 问题列表 */}
      <div className="flex-1 overflow-y-auto" role="navigation" aria-label="章节导航">
        {isEmptyFilterResult ? (
          /* 过滤无结果空态 */
          <div className="search-empty-state">
            <RiSearchLine className="w-5 h-5 text-text-muted" />
            <p className="text-gm-sm text-text-muted">
              {hasTextSearch
                ? `未找到匹配「${searchQuery}」的问题`
                : "无匹配的问题"}
            </p>
          </div>
        ) : hasTextSearch && filteredData ? (
          /* 文本搜索模式：展平树，无折叠 */
          filteredData.map(({ chapter, questions }) => {
            const chIdx = chapters.findIndex((c) => c.id === chapter.id);
            return (
              <div key={chapter.id}>
                <div className="chapter-tree-header">
                  <span className="chapter-tree-header-index">
                    {chIdx >= 0 ? `${toChineseNumeral(chIdx + 1)}、` : ""}
                  </span>
                  <span className="chapter-tree-header-title">
                    {chapter.title}
                  </span>
                  <span className="chapter-tree-header-count">
                    {questions.length} 问
                  </span>
                </div>
                <div className="chapter-tree-items">
                  {questions.map((q) => {
                    const snippet = snippetMap[q.id];
                    const snippetParts = snippet
                      ? getSnippetParts(
                          snippet.fullText,
                          snippet.ranges,
                          30,
                        )
                      : null;
                    return (
                      <div key={q.id}>
                        <QuestionItem
                          answer={q}
                          isSelected={q.id === selectedId}
                          onSelect={onSelect}
                          isBookmarked={!!bookmarks?.includes(q.id)}
                        />
                        {snippet && snippetParts && (
                          <div className="flex items-start gap-gm-1 pl-gm-7 pr-gm-3 pb-gm-1">
                            <span className="text-gm-xs text-text-muted flex-shrink-0 mt-px">
                              {FIELD_LABELS[snippet.field]}
                            </span>
                            <p className="text-gm-xs text-text-muted leading-relaxed truncate">
                              {renderSnippetParts(snippetParts).map(
                                (part, i) =>
                                  part.highlighted ? (
                                    <mark
                                      key={i}
                                      className="bg-brand/20 text-text rounded-gm-xs px-0.5"
                                    >
                                      {part.text}
                                    </mark>
                                  ) : (
                                    <span key={i}>{part.text}</span>
                                  ),
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : hasStatusFilter && filteredData ? (
          /* 纯过滤模式：保留树形折叠结构，只显示过滤后的问题 */
          filteredData.map(({ chapter: ch, questions }) => {
            const isCollapsed = collapsedChapters.has(ch.id);

            return (
              <div key={ch.id}>
                <button
                  onClick={() => toggleChapter(ch.id)}
                  className="chapter-tree-header focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
                  aria-expanded={!isCollapsed}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-gm-1">
                      <span className="chapter-tree-header-index">
                        {`${toChineseNumeral(chapters.findIndex((c) => c.id === ch.id) + 1)}、`}
                      </span>
                      <span className="chapter-tree-header-title">
                        {ch.title}
                      </span>
                      <span className="chapter-tree-header-count">
                        {questions.length}/{ch.questionCount}
                      </span>
                    </div>
                    <div className="hidden lg:block mt-gm-1 h-1 bg-surface-alt rounded-full overflow-hidden" role="progressbar" aria-valuenow={ch.questionCount > 0 ? Math.round((chapterViewed(ch) / ch.questionCount) * 100) : 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${ch.title} 完成进度`}>
                      <div
                        className={`h-full rounded-full transition-all ${
                          chapterViewed(ch) > 0 &&
                          chapterViewed(ch) === ch.questionCount
                            ? "bg-success-light"
                              : chapterViewed(ch) > 0
                              ? "bg-brand"
                              : "bg-border-strong"
                        }`}
                        style={{
                          width: `${
                            ch.questionCount > 0
                              ? (chapterViewed(ch) / ch.questionCount) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                  <RiArrowDownSLine
                    className={`chapter-tree-header-toggle ${
                      isCollapsed
                        ? "chapter-tree-header-toggle--closed"
                        : "chapter-tree-header-toggle--open"
                    }`}
                  />
                </button>

                {!isCollapsed && (
                  <div className="chapter-tree-items">
                    {questions.map((q) => (
                      <QuestionItem
                        key={q.id}
                        answer={q}
                        isSelected={q.id === selectedId}
                        onSelect={onSelect}
                        chapterPosition={questionChapterPosition[q.id]}
                        isBookmarked={!!bookmarks?.includes(q.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          /* 正常浏览模式：全树形目录 */
          visibleChapters.map((ch, chIdx) => {
            const chQuestions = questionsByChapter[ch.id] || [];
            const isCollapsed = collapsedChapters.has(ch.id);

            return (
              <div key={ch.id}>
                {/* 章节头部 — 点击切换折叠 */}
                <button
                  onClick={() => toggleChapter(ch.id)}
                  className="chapter-tree-header focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
                  aria-expanded={!isCollapsed}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-gm-1">
                      <span className="chapter-tree-header-index">
                        {`${toChineseNumeral(chIdx + 1)}、`}
                      </span>
                      <span className="chapter-tree-header-title">
                        {ch.title}
                      </span>
                      <span className="chapter-tree-header-count">
                        {chapterViewed(ch)}/{ch.questionCount}
                      </span>
                      {chapterViewed(ch) > 0 &&
                        chapterViewed(ch) === ch.questionCount && (
                          <svg className="w-4 h-4 text-success-light flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="全部完成">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                    </div>
                    {/* 章节进度条 */}
                    <div className="hidden lg:block mt-gm-1 h-1 bg-surface-alt rounded-full overflow-hidden" role="progressbar" aria-valuenow={ch.questionCount > 0 ? Math.round((chapterViewed(ch) / ch.questionCount) * 100) : 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${ch.title} 完成进度`}>
                      <div
                        className={`h-full rounded-full transition-all ${
                          chapterViewed(ch) > 0 &&
                          chapterViewed(ch) === ch.questionCount
                            ? "bg-success-light"
                              : chapterViewed(ch) > 0
                              ? "bg-brand"
                              : "bg-border-strong"
                        }`}
                        style={{
                          width: `${
                            ch.questionCount > 0
                              ? (chapterViewed(ch) / ch.questionCount) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                  <RiArrowDownSLine
                    className={`chapter-tree-header-toggle ${
                      isCollapsed
                        ? "chapter-tree-header-toggle--closed"
                        : "chapter-tree-header-toggle--open"
                    }`}
                  />
                </button>

                {/* 问题列表（折叠时隐藏） */}
                {!isCollapsed && (
                  <div className="chapter-tree-items">
                    {chQuestions.map((q) => (
                      <QuestionItem
                        key={q.id}
                        answer={q}
                        isSelected={q.id === selectedId}
                        onSelect={onSelect}
                        chapterPosition={questionChapterPosition[q.id]}
                        isBookmarked={!!bookmarks?.includes(q.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 最近阅读 */}
      {visitHistory && visitHistory.length > 0 && (
        <div className="hidden lg:block border-t border-border px-gm-3 py-gm-2 bg-surface-lowered flex-shrink-0">
          <p className="text-gm-xs text-text-muted mb-gm-1">最近阅读</p>
          <div className="flex flex-col gap-gm-0_5">
            {visitHistory.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect(a)}
                className={`flex items-center gap-gm-1_5 px-gm-2 py-gm-1 rounded-gm-md text-gm-xs text-left transition-all hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98] ${
                  a.id === selectedId
                    ? "bg-brand/10 text-brand"
                    : "text-text-secondary"
                }`}
                aria-label={a.question}
              >
                <span className="w-1 h-1 rounded-full bg-text-muted flex-shrink-0" />
                <span className="truncate flex-1">{a.question}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── 子组件 ──

/** 过滤芯片按钮 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center px-gm-2 py-gm-0_5 rounded-gm-md text-gm-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98] min-h-[44px] ${
        active
          ? "bg-brand text-white"
          : "bg-surface-alt text-text-muted hover:text-text hover:bg-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}

/** 单个问题项（提取自原 QuestionList 内联渲染） */
function QuestionItem({
  answer,
  isSelected,
  onSelect,
  chapterPosition,
  isBookmarked,
}: {
  answer: Answer;
  isSelected: boolean;
  onSelect: (answer: Answer) => void;
  chapterPosition?: { index: number; total: number };
  isBookmarked?: boolean;
}) {
  const isStub = answer.l0 === "";

  return (
    <button
      onClick={() => onSelect(answer)}
      className={`question-list-item border-brand focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98] ${
        isSelected
          ? "question-list-item--selected"
          : "text-text-secondary"
      }`}
    >
      <div className="flex-1 min-w-0">
        <p
          className={`text-gm-sm leading-snug line-clamp-2 ${isStub ? "text-text-muted" : ""}`}
        >
          {chapterPosition && (
            <span className="text-gm-xs text-text-muted tabular-nums mr-gm-0_5">
              {chapterPosition.index}.
            </span>
          )}
          {answer.question}
        </p>
      </div>
      {isBookmarked && (
        <RiStarFill
          className="w-3 h-3 text-warning-light flex-shrink-0 ml-gm-1"
          aria-label="已收藏"
        />
      )}
    </button>
  );
}

"use client";

import { useMemo } from "react";
import {
  RiBookOpenLine,
  RiLightbulbLine,
  RiDashboardLine,
  RiBrainLine,
  RiTaskLine,
  RiCoinsLine,
  RiGitMergeLine,
  RiTimerLine,
  RiEyeLine,
  RiMentalHealthLine,
} from "@remixicon/react";
import type { Answer, Chapter } from "@/lib/content/types";
import type { ChapterProgress } from "@/lib/constants";
import { getAnswerById } from "@/lib/content/questions";

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

/**
 * 内容进度仪表盘 — 当未选中问题时展示。
 * 优先使用 userProgress（用户学习进度），fallback 到 chapters 元数据的 answeredCount。
 * 有阅读记录时优先推荐"继续阅读"；无记录时推荐完成率最高的章节。
 */
export function ContentDashboard({
  chapters,
  questionsByChapter,
  lastReadId,
  onNavigate,
  visitHistory,
  userProgress,
}: {
  chapters: Chapter[];
  questionsByChapter: Record<string, Answer[]>;
  lastReadId: string | null;
  onNavigate?: (answer: Answer) => void;
  /** 最近阅读的问题列表（最多 5 条），用于仪表盘"最近阅读"区域。 */
  visitHistory?: Answer[];
  /** 用户学习进度（按章节汇总）。提供时优先用于进度展示，否则 fallback 到 chapter.answeredCount。 */
  userProgress?: Record<string, ChapterProgress>;
}) {
  /** 某章的用户已读数，无 userProgress 时 fallback 到内容 answeredCount。 */
  const chapterViewed = (ch: Chapter): number =>
    userProgress?.[ch.id]?.viewed ?? ch.answeredCount;

  const totalViewed = chapters.reduce((s, c) => s + chapterViewed(c), 0);
  const totalQuestions = chapters.reduce((s, c) => s + c.questionCount, 0);
  const totalPct =
    totalQuestions > 0 ? (totalViewed / totalQuestions) * 100 : 0;

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
        .filter((c) => chapterViewed(c) > 0)
        .sort((a, b) => {
          const ra = chapterViewed(a) / a.questionCount;
          const rb = chapterViewed(b) / b.questionCount;
          return rb - ra || chapterViewed(b) - chapterViewed(a);
        })[0] ?? null,
    [chapters, userProgress], // eslint-disable-line react-hooks/exhaustive-deps
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
              className="text-brand transition-all duration-[var(--gm-duration-glacial)] ease-out"
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
            已阅读 <strong className="text-text">{totalViewed}</strong> / {totalQuestions}
          </p>
        </div>
      </div>

      {/* ── 继续阅读（主要 CTA）── */}
      {continueReading && (
        <button
          type="button"
          onClick={() => onNavigate?.(continueReading.question)}
          className="w-full text-left cursor-pointer rounded-gm-lg border border-l-2 border-l-brand border-border bg-brand/10 px-gm-5 py-gm-4 transition-all hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
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
          const viewed = chapterViewed(ch);
          const pct =
            ch.questionCount > 0
              ? (viewed / ch.questionCount) * 100
              : 0;
          const isComplete =
            viewed > 0 && viewed === ch.questionCount;
          const isBlank = viewed === 0;

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
              className="flex items-center gap-gm-3 px-gm-4 py-gm-3 rounded-gm-lg bg-surface-elevated border border-border text-left w-full transition-all hover:bg-surface-hover cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
            >
              {(() => {
                const Icon = CHAPTER_ICON_MAP[ch.icon];
                return Icon ? <Icon className="w-gm-icon-md h-gm-icon-md text-text-secondary flex-shrink-0" /> : null;
              })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-gm-1">
                  <span className="text-gm-sm font-medium text-text truncate">{ch.title}</span>
                  <span className="text-gm-xs text-text-muted tabular-nums ml-gm-2 flex-shrink-0">
                    {viewed}/{ch.questionCount}
                  </span>
                </div>
                <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${ch.title} 完成进度 ${Math.round(pct)}%`}>
                  <div
                    className={`h-full rounded-full transition-all duration-[var(--gm-duration-glacial)] ${
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
          className="w-full text-left cursor-pointer rounded-gm-lg border border-border bg-brand/5 px-gm-4 py-gm-3 transition-all hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-gm-2">
              <RiLightbulbLine className="w-gm-icon-md h-gm-icon-md" />
              <span className="text-gm-sm font-semibold text-brand">推荐阅读</span>
            </div>
            <span className="text-gm-sm text-brand">→</span>
          </div>
          <p className="mt-gm-1 text-gm-sm text-text">
            {bestChapter.title} · {chapterViewed(bestChapter) === bestChapter.questionCount
              ? `${bestChapter.questionCount} 问全部完成`
              : `已阅读 ${chapterViewed(bestChapter)}/${bestChapter.questionCount} 问`}
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
                               transition-all text-left w-full
                               focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
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

"use client";

import { useCallback } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  LEARN_PROGRESS_KEY,
  type LearnProgressEntry,
  type ChapterProgress,
} from "@/lib/constants";

/**
 * 用户学习进度 hook — 基于 localStorage 持久化。
 *
 * - `progress`: Record<questionId, LearnProgressEntry>，已阅读问题的集合
 * - `markViewed(questionId)`: 标记问题为已读（幂等：已有记录不更新时间戳）
 *
 * 进度计算（`computeChapterProgress` / `computeTotalProgress`）为纯工具函数，
 * 由消费端按需调用，不耦合到 hook 内部。
 */
export function useLearnProgress() {
  const [progress, setProgress] = useLocalStorage<
    Record<string, LearnProgressEntry>
  >(LEARN_PROGRESS_KEY, {});

  /** 标记问题为已读。已有记录时跳过，保留首次阅读时间戳。 */
  const markViewed = useCallback(
    (questionId: string) => {
      setProgress((prev) => {
        if (prev[questionId]) return prev; // 幂等：不更新已存在条目
        return { ...prev, [questionId]: { viewedAt: Date.now() } };
      });
    },
    [setProgress],
  );

  return { progress, markViewed } as const;
}

/** 计算单章用户进度。 */
export function computeChapterProgress(
  progress: Record<string, LearnProgressEntry>,
  questionIds: string[],
): ChapterProgress {
  const viewed = questionIds.filter((id) => id in progress).length;
  return { viewed, total: questionIds.length };
}

/** 计算全部章节的用户进度汇总。 */
export function computeAllChapterProgress(
  progress: Record<string, LearnProgressEntry>,
  questionsByChapter: Record<string, { id: string }[]>,
): Record<string, ChapterProgress> {
  const map: Record<string, ChapterProgress> = {};
  for (const [chId, questions] of Object.entries(questionsByChapter)) {
    map[chId] = computeChapterProgress(
      progress,
      questions.map((q) => q.id),
    );
  }
  return map;
}

/** 计算全局用户进度（跨所有章节）。 */
export function computeTotalProgress(
  chapterProgressMap: Record<string, ChapterProgress>,
): { viewed: number; total: number } {
  let viewed = 0;
  let total = 0;
  for (const cp of Object.values(chapterProgressMap)) {
    viewed += cp.viewed;
    total += cp.total;
  }
  return { viewed, total };
}

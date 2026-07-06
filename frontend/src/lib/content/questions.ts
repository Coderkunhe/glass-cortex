import type { Answer, Chapter, ChapterId } from "./types";
import { CHAPTERS } from "./chapters";
import { CH1_ANSWERS } from "./answers/ch1";
import { CH2_ANSWERS } from "./answers/ch2";
import { CH3_ANSWERS } from "./answers/ch3";
import { CH4_ANSWERS } from "./answers/ch4";
import { CH5_ANSWERS } from "./answers/ch5";
import { CH6_ANSWERS } from "./answers/ch6";
import { CH7_ANSWERS } from "./answers/ch7";
import { CH8_ANSWERS } from "./answers/ch8";

// ── 向后兼容：同步加载（测试用） ─────────────────────────

/** 全部 93 问答案（6 篇已就绪，87 篇占位） */
export const ALL_ANSWERS: Answer[] = [
  ...CH1_ANSWERS,
  ...CH2_ANSWERS,
  ...CH3_ANSWERS,
  ...CH4_ANSWERS,
  ...CH5_ANSWERS,
  ...CH6_ANSWERS,
  ...CH7_ANSWERS,
  ...CH8_ANSWERS,
];

/** 获取全部章节元数据 */
export function getChapters(): Chapter[] {
  return CHAPTERS;
}

/** 按章节筛选问题 */
export function getQuestionsByChapter(chapterId: string): Answer[] {
  return ALL_ANSWERS.filter((a) => a.chapter === chapterId);
}

/** 按 ID 查找单条答案 */
export function getAnswerById(id: string): Answer | undefined {
  return ALL_ANSWERS.find((a) => a.id === id);
}

/** 按章节 ID 查找章节元数据 */
export function getChapterById(id: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** 获取有已完成答案的章节 ID 列表 */
export function getAnsweredChapterIds(): string[] {
  const answered = new Set(
    ALL_ANSWERS.filter((a) => a.l0 !== "").map((a) => a.chapter)
  );
  return Array.from(answered);
}

// ── 并行管线：动态 import + Promise.all 章节答案 ─────────

/** 章节动态加载器（代码分割点） */
const CHAPTER_LOADERS: Record<ChapterId, () => Promise<Answer[]>> = {
  ch1: () => import("./answers/ch1").then((m) => m.CH1_ANSWERS),
  ch2: () => import("./answers/ch2").then((m) => m.CH2_ANSWERS),
  ch3: () => import("./answers/ch3").then((m) => m.CH3_ANSWERS),
  ch4: () => import("./answers/ch4").then((m) => m.CH4_ANSWERS),
  ch5: () => import("./answers/ch5").then((m) => m.CH5_ANSWERS),
  ch6: () => import("./answers/ch6").then((m) => m.CH6_ANSWERS),
  ch7: () => import("./answers/ch7").then((m) => m.CH7_ANSWERS),
  ch8: () => import("./answers/ch8").then((m) => m.CH8_ANSWERS),
};

/** 动态加载单章答案。 */
export async function loadChapter(chapterId: string): Promise<Answer[]> {
  const loader = CHAPTER_LOADERS[chapterId as ChapterId];
  if (!loader) return [];
  return loader();
}

/** 并行加载全部 8 章答案 — 各章通过动态 import() 独立加载，Promise.all 并行执行。 */
const _chapterCache = new Map<string, Answer[]>();

export async function loadAllChaptersParallel(): Promise<Record<string, Answer[]>> {
  // 从缓存读取已加载章节
  const ids = Object.keys(CHAPTER_LOADERS) as ChapterId[];
  const remaining = ids.filter((id) => !_chapterCache.has(id));

  if (remaining.length > 0) {
    const results = await Promise.all(remaining.map((id) => loadChapter(id)));
    for (let i = 0; i < remaining.length; i++) {
      _chapterCache.set(remaining[i], results[i]);
    }
  }

  const map: Record<string, Answer[]> = {};
  for (const id of ids) {
    map[id] = _chapterCache.get(id)!;
  }
  return map;
}

/** 清空章节缓存（测试用） */
export function clearChapterCache(): void {
  _chapterCache.clear();
}

/**
 * 全文搜索工具 — Fuse.js 包装。
 *
 * 对全量 Answer 数据（question/l0/l1/l2/l3）建立模糊搜索索引，
 * 支持按字段加权、匹配摘要提取、关键词高亮分段。
 *
 * 使用方式：
 * ```ts
 * const index = createSearchIndex(allAnswers);
 * const results = index.search("上下文");
 * // results[0].item → Answer 对象
 * // results[0].matches → 匹配详情（用于提取摘要和高亮）
 * ```
 */

import Fuse, { type FuseResult } from "fuse.js";
import type { Answer } from "./types";

/** 从 Fuse.js 结果中提取的单字段匹配摘要 */
export interface MatchSnippet {
  /** 匹配的字段名（question/l0/l1/l2/l3） */
  field: string;
  /** 匹配字段的完整文本 */
  fullText: string;
  /** 匹配字符范围 [[start,end], …]，相对于 fullText */
  ranges: [number, number][];
}

/** 高亮分段结果 — 三段式：高亮前、高亮段、高亮后 */
export interface SnippetParts {
  before: string;
  match: string;
  after: string;
}

/** 字段中文标签映射（用于搜索结果副标题） */
export const FIELD_LABELS: Record<string, string> = {
  question: "标题",
  l0: "L0 结论",
  l1: "L1 核心",
  l2: "L2 深入",
  l3: "L3 前沿",
};

/** 字段显示权重（用于在搜索结果中优先展示哪个匹配） */
const FIELD_WEIGHT: Record<string, number> = {
  question: 0,
  l0: 1,
  l1: 2,
  l2: 3,
  l3: 4,
};

/**
 * 为 Answer 数组创建 Fuse.js 模糊搜索索引。
 *
 * 搜索范围：question/l0/l1/l2/l3，按字段语义加权。
 * 创建一次后可复用多次 search() 调用。
 */
export function createSearchIndex(answers: Answer[]): Fuse<Answer> {
  return new Fuse(answers, {
    keys: [
      { name: "question", weight: 0.4 },
      { name: "l0", weight: 0.3 },
      { name: "l1", weight: 0.2 },
      { name: "l2", weight: 0.05 },
      { name: "l3", weight: 0.05 },
    ],
    /** 匹配阈值：0.0 精确 → 1.0 任意，0.3 允许细微差异 */
    threshold: 0.3,
    /** 返回匹配位置信息用于高亮 */
    includeMatches: true,
    /** 返回匹配分数用于排序 */
    includeScore: true,
    /** 最少匹配字符数，中文场景 1 字符即可 */
    minMatchCharLength: 1,
    /** 按匹配度排序 */
    shouldSort: true,
    /** 模糊匹配搜索半径 */
    distance: 100,
  });
}

/**
 * 从 Fuse.js 搜索结果中提取最佳的字段匹配摘要。
 *
 * 策略：
 * 1. 优先展示非 question 字段的匹配（question 已在标题行显示）
 * 2. 按 FIELD_WEIGHT 选择优先级最高的匹配字段
 * 3. 标题匹配不返回 snippet（已在列表中可见）
 *
 * @returns 匹配摘要对象，或 null（仅标题匹配 / 无匹配）
 */
export function extractBestSnippet(
  result: FuseResult<Answer>,
): MatchSnippet | null {
  if (!result.matches || result.matches.length === 0) return null;

  // 按字段优先级排序，取最值得展示的字段
  const sorted = [...result.matches].sort((a, b) => {
    const aKey = (a.key as string) || "";
    const bKey = (b.key as string) || "";
    // 优先非 question 字段
    if (aKey === "question" && bKey !== "question") return 1;
    if (aKey !== "question" && bKey === "question") return -1;
    // 同优先级按权重
    return (FIELD_WEIGHT[aKey] ?? 99) - (FIELD_WEIGHT[bKey] ?? 99);
  });

  const best = sorted[0];
  const key = (best.key as string) || "question";
  const value = (best.value as string) || "";
  const indices = (best.indices as [number, number][]) || [];

  if (indices.length === 0) return null;

  return {
    field: key,
    fullText: value,
    ranges: indices,
  };
}

/**
 * 将匹配摘要切分为三段：高亮前 + 高亮段 + 高亮后。
 *
 * @param text 匹配字段的完整文本
 * @param ranges Fuse.js 返回的匹配区间
 * @param contextChars 高亮左右取多少字符作为上下文
 */
export function getSnippetParts(
  text: string,
  ranges: [number, number][],
  contextChars = 30,
): SnippetParts {
  if (text.length === 0) {
    return { before: "", match: "", after: "" };
  }

  if (ranges.length === 0) {
    const t = text.slice(0, contextChars);
    return { before: t, match: "", after: "" };
  }

  const [start, end] = ranges[0];
  const ctxStart = Math.max(0, start - contextChars);
  const ctxEnd = Math.min(text.length, end + 1 + contextChars);

  const prefix = ctxStart > 0 ? "…" : "";
  const suffix = ctxEnd < text.length ? "…" : "";

  return {
    before: prefix + text.slice(ctxStart, start),
    match: text.slice(start, end + 1),
    after: text.slice(end + 1, ctxEnd) + suffix,
  };
}

/**
 * 将匹配摘要渲染为 React 节点数组（带 <mark> 高亮）。
 *
 * @param parts getSnippetParts 返回值
 * @returns 可渲染节点数组
 */
export function renderSnippetParts(
  parts: SnippetParts,
): Array<{ text: string; highlighted: boolean }> {
  const result: Array<{ text: string; highlighted: boolean }> = [];
  if (parts.before) result.push({ text: parts.before, highlighted: false });
  if (parts.match) result.push({ text: parts.match, highlighted: true });
  if (parts.after) result.push({ text: parts.after, highlighted: false });
  return result;
}

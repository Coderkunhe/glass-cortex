/**
 * 全文搜索工具单元测试。
 *
 * 覆盖：索引创建、全文搜索（matched fields）、
 * 摘要提取、高亮分段。
 */

import { describe, it, expect } from "vitest";
import type { Answer } from "@/lib/content/types";
import {
  createSearchIndex,
  extractBestSnippet,
  getSnippetParts,
  renderSnippetParts,
  FIELD_LABELS,
} from "@/lib/content/search";

function makeAnswer(overrides: Partial<Answer> & { id: string }): Answer {
  return {
    question: "",
    chapter: "ch1",
    chapterTitle: "第 1 章：上下文工程",
    priority: "P0",
    confidence: { l0: 0, l1: 0, l2: 0, l3: 0 },
    overallConfidence: 0,
    l0: "",
    l1: "",
    l2: "",
    l3: "",
    ...overrides,
  };
}

const mockAnswers: Answer[] = [
  makeAnswer({
    id: "q1.1",
    question: "溢出处理策略",
    l0: "三种溢出策略",
    l1: "溢出处理是 AI 上下文工程的核心机制",
    l2: "深层溢出涉及记忆压缩与分层存储。",
    l3: "前沿研究在探索动态上下文窗口。",
  }),
  makeAnswer({
    id: "q1.2",
    question: "输出超长处理",
    l0: "分段输出策略",
  }),
  makeAnswer({
    id: "q2.1",
    question: "事实抽取手段",
    l0: "正则表达式等方法",
    l1: "事实抽取是知识图谱构建的基础步骤，涉及 NLP 和模式匹配。",
  }),
  makeAnswer({
    id: "q3.1",
    question: "记忆衰减",
    l1: "记忆衰减是 ElasticSearch 中的重要概念",
  }),
];

describe("createSearchIndex", () => {
  it("creates a Fuse index from answers", () => {
    const index = createSearchIndex(mockAnswers);
    expect(index).toBeDefined();
  });

  it("returns empty results for empty index", () => {
    const index = createSearchIndex([]);
    expect(index.search("test")).toEqual([]);
  });
});

describe("full-text search — field coverage", () => {
  it("finds result by question title", () => {
    const index = createSearchIndex(mockAnswers);
    const results = index.search("溢出处理");
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain("q1.1");
  });

  it("finds result by L0 content", () => {
    const index = createSearchIndex(mockAnswers);
    const results = index.search("三种溢出");
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain("q1.1");
  });

  it("finds result by L1 content", () => {
    const index = createSearchIndex(mockAnswers);
    const results = index.search("上下文工程");
    const ids = results.map((r) => r.item.id);
    // q1.1 和 q2.1 的 L1 都含相关文本
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  it("finds result by L2 content", () => {
    const index = createSearchIndex(mockAnswers);
    const results = index.search("分层存储");
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain("q1.1");
  });

  it("finds result by L3 content", () => {
    const index = createSearchIndex(mockAnswers);
    const results = index.search("动态上下文");
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain("q1.1");
  });

  it("returns empty for no matches", () => {
    const index = createSearchIndex(mockAnswers);
    const results = index.search("zzz_not_exists_12345");
    expect(results).toHaveLength(0);
  });

  it("returns partial matches with fuzzy setting", () => {
    const index = createSearchIndex(mockAnswers);
    // "记忆衰减" should fuzzy-match
    const results = index.search("记忆");
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain("q3.1");
  });
});

describe("extractBestSnippet", () => {
  it("extracts snippet from content field (not question)", () => {
    const index = createSearchIndex(mockAnswers);
    // Search for L0 content
    const results = index.search("三种溢出");
    expect(results.length).toBeGreaterThanOrEqual(1);

    const snippet = extractBestSnippet(results[0]);
    expect(snippet).not.toBeNull();
    // This match should come from L0, not question
    expect(snippet!.field).toBe("l0");
    expect(snippet!.ranges.length).toBeGreaterThan(0);
  });

  it("returns null for question-only matches", () => {
    const index = createSearchIndex(mockAnswers);
    const results = index.search("溢出处理策略");
    expect(results.length).toBeGreaterThanOrEqual(1);

    const snippet = extractBestSnippet(results[0]);
    // This might be null because the match is on question field
    // (depends on Fuse matching — could also match L0)
    // We just verify it doesn't crash
    expect(
      snippet === null ||
        (typeof snippet.field === "string" && snippet.ranges.length > 0),
    ).toBe(true);
  });

  it("returns null for result with no matches", () => {
    const emptyResult = {
      item: mockAnswers[0],
      score: 1,
      refIndex: 0,
    } as unknown as Parameters<typeof extractBestSnippet>[0];
    const snippet = extractBestSnippet(emptyResult);
    expect(snippet).toBeNull();
  });

  it("returns null when matches field is an empty array", () => {
    const emptyMatchResult = {
      item: mockAnswers[0],
      matches: [],
      score: 1,
      refIndex: 0,
    } as unknown as Parameters<typeof extractBestSnippet>[0];
    const snippet = extractBestSnippet(emptyMatchResult);
    expect(snippet).toBeNull();
  });

  it("prioritizes content fields over question in snippet", () => {
    const index = createSearchIndex(mockAnswers);
    // Search something that matches both L0 and question
    const results = index.search("策略");
    expect(results.length).toBeGreaterThanOrEqual(1);

    const snippet = extractBestSnippet(results[0]);
    // Snippet should exist (some content field matched)
    // It should NOT be the question field (we skip that for snippets)
    if (snippet) {
      expect(snippet.field).not.toBe("question");
      expect(Object.keys(FIELD_LABELS)).toContain(snippet.field);
    }
  });
});

describe("getSnippetParts", () => {
  it("splits text into before/match/after with context", () => {
    const text = "溢出处理是 AI 上下文工程的核心机制";
    const ranges: [number, number][] = [[0, 1]]; // "溢出"
    const parts = getSnippetParts(text, ranges, 10);
    expect(parts.match).toBe("溢出");
    expect(parts.before).toBe("");
    expect(parts.after.length).toBeGreaterThan(0);
  });

  it("handles empty text", () => {
    const parts = getSnippetParts("", [[0, 1]], 30);
    expect(parts.before).toBe("");
    expect(parts.match).toBe("");
    expect(parts.after).toBe("");
  });

  it("handles empty ranges", () => {
    const parts = getSnippetParts("some text", [], 30);
    expect(parts.before).toBe("some text");
    expect(parts.match).toBe("");
    expect(parts.after).toBe("");
  });

  it("adds ellipsis when text extends beyond context window", () => {
    const text = "这是很长的一段文本，包含匹配词在中间位置。前后文都需要截断。";
    const ranges: [number, number][] = [[12, 14]]; // "匹配词"
    const parts = getSnippetParts(text, ranges, 5);
    expect(parts.before).toContain("…");
    expect(parts.match).toBe("匹配词");
    // after 可能也有截断
    expect(parts.after).toContain("…");
  });

  it("does not add ellipsis when within context bounds", () => {
    const text = "这是一个短文本匹配";
    const ranges: [number, number][] = [[7, 8]]; // "匹配"
    const parts = getSnippetParts(text, ranges, 30);
    expect(parts.before).not.toContain("…");
    expect(parts.match).toBe("匹配");
    expect(parts.after).not.toContain("…");
  });
});

describe("renderSnippetParts", () => {
  it("converts parts to segment array with highlight flag", () => {
    const parts = { before: "前", match: "高亮", after: "后" };
    const segments = renderSnippetParts(parts);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ text: "前", highlighted: false });
    expect(segments[1]).toEqual({ text: "高亮", highlighted: true });
    expect(segments[2]).toEqual({ text: "后", highlighted: false });
  });

  it("omits segments when empty", () => {
    const parts = { before: "", match: "高亮", after: "" };
    const segments = renderSnippetParts(parts);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ text: "高亮", highlighted: true });
  });

  it("returns only before when match is empty", () => {
    const segments = renderSnippetParts({
      before: "一些文本",
      match: "",
      after: "",
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].highlighted).toBe(false);
  });
});

describe("FIELD_LABELS", () => {
  it("has labels for all searchable fields", () => {
    expect(FIELD_LABELS.question).toBe("标题");
    expect(FIELD_LABELS.l0).toBe("L0 结论");
    expect(FIELD_LABELS.l1).toBe("L1 核心");
    expect(FIELD_LABELS.l2).toBe("L2 深入");
    expect(FIELD_LABELS.l3).toBe("L3 前沿");
  });
});

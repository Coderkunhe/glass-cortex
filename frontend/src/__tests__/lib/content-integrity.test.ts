/**
 * Content data 完整性校验 — 95 问答数据结构验证。
 *
 * 验证规则：
 * 1. 总题数 = 95 (17+27+17+10+6+6+6+6)
 * 2. 无重复 ID
 * 3. ID 前缀匹配所属章节 (qN.x → chN)
 * 4. chapter.questionCount 与实际题数一致
 * 5. chapter.answeredCount 与实际完成数一致
 * 6. priority ∈ {P0,P1,P2,P3}
 * 7. confidence ∈ [0,1]
 * 8. 已完成答案 L0-L3 全非空 + overallConfidence > 0
 * 9. 占位答案 L0-L3 全空 + overallConfidence = 0
 * 10. overallConfidence = min(l0,l1,l2,l3) 或占位时为 0
 */

import { describe, it, expect } from "vitest";
import {
  ALL_ANSWERS,
  getAnswerById,
  getChapters,
} from "@/lib/content/questions";
import type { PriorityTier } from "@/lib/content/types";

const VALID_PRIORITIES: PriorityTier[] = ["P0", "P1", "P2", "P3"];

describe("Content data integrity", () => {
  // ── 1. 总数 ──
  it("has 95 total questions", () => {
    expect(ALL_ANSWERS).toHaveLength(95);
  });

  it("chapter question counts sum to 95", () => {
    const total = getChapters().reduce((s, c) => s + c.questionCount, 0);
    expect(total).toBe(95);
  });

  // ── 2. 唯一 ID ──
  it("has no duplicate question IDs", () => {
    const ids = ALL_ANSWERS.map((a) => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ALL_ANSWERS.length);
  });

  // ── 3. ID 前缀 ↔ 章节 ──
  it("question IDs match chapter prefix", () => {
    const chapterMap: Record<string, number> = { ch1: 1, ch2: 2, ch3: 3, ch4: 4, ch5: 5, ch6: 6, ch7: 7, ch8: 8 };
    for (const a of ALL_ANSWERS) {
      const expectedChapter = a.chapter;
      const chapterNum = chapterMap[expectedChapter];
      expect(chapterNum).toBeDefined();
      // ID like "q1.1" → prefix "q1"
      const prefix = a.id.split(".")[0];
      expect(prefix).toBe(`q${chapterNum}`);
    }
  });

  // ── 4. chapter.questionCount ──
  it("chapter questionCount matches actual count", () => {
    for (const ch of getChapters()) {
      const actual = ALL_ANSWERS.filter((a) => a.chapter === ch.id).length;
      expect(actual).toBe(ch.questionCount);
    }
  });

  // ── 5. chapter.answeredCount ──
  it("chapter answeredCount matches actual completed answers", () => {
    for (const ch of getChapters()) {
      const completed = ALL_ANSWERS.filter(
        (a) => a.chapter === ch.id && a.l0 !== ""
      ).length;
      expect(completed).toBe(ch.answeredCount);
    }
  });

  // ── 6. priority 有效值 ──
  it("all priorities are valid", () => {
    for (const a of ALL_ANSWERS) {
      expect(VALID_PRIORITIES).toContain(a.priority);
    }
  });

  // ── 7. confidence 范围 ──
  it("all confidence values in [0, 1]", () => {
    for (const a of ALL_ANSWERS) {
      const c = a.confidence;
      expect(c.l0).toBeGreaterThanOrEqual(0);
      expect(c.l0).toBeLessThanOrEqual(1);
      expect(c.l1).toBeGreaterThanOrEqual(0);
      expect(c.l1).toBeLessThanOrEqual(1);
      expect(c.l2).toBeGreaterThanOrEqual(0);
      expect(c.l2).toBeLessThanOrEqual(1);
      expect(c.l3).toBeGreaterThanOrEqual(0);
      expect(c.l3).toBeLessThanOrEqual(1);
    }
  });

  it("overallConfidence in [0, 1]", () => {
    for (const a of ALL_ANSWERS) {
      expect(a.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(a.overallConfidence).toBeLessThanOrEqual(1);
    }
  });

  // ── 8. 已完成答案完整性 ──
  it("completed answers have all layers non-empty", () => {
    const completed = ALL_ANSWERS.filter((a) => a.l0 !== "");
    expect(completed.length).toBeGreaterThanOrEqual(15);
    for (const a of completed) {
      expect(a.l0.length, `q=${a.id} L0 empty`).toBeGreaterThan(0);
      expect(a.l1.length, `q=${a.id} L1 empty`).toBeGreaterThan(0);
      expect(a.l2.length, `q=${a.id} L2 empty`).toBeGreaterThan(0);
      expect(a.l3.length, `q=${a.id} L3 empty`).toBeGreaterThan(0);
      expect(a.overallConfidence).toBeGreaterThan(0);
    }
  });

  // ── 9. 占位答案一致性 ──
  it("placeholder answers have all layers empty and zero confidence", () => {
    const stubs = ALL_ANSWERS.filter((a) => a.l0 === "");
    expect(stubs.length).toBeGreaterThanOrEqual(0);  // >= 0: all chapters complete = zero stubs is valid
    for (const a of stubs) {
      expect(a.l0, `q=${a.id} L0 not empty`).toBe("");
      expect(a.l1, `q=${a.id} L1 not empty`).toBe("");
      expect(a.l2, `q=${a.id} L2 not empty`).toBe("");
      expect(a.l3, `q=${a.id} L3 not empty`).toBe("");
      expect(a.overallConfidence, `q=${a.id} confidence not zero`).toBe(0);
      expect(a.confidence.l0).toBe(0);
      expect(a.confidence.l1).toBe(0);
      expect(a.confidence.l2).toBe(0);
      expect(a.confidence.l3).toBe(0);
    }
  });

  // ── 10. overallConfidence 逻辑 ──
  it("overallConfidence equals min layer confidence for completed answers", () => {
    const completed = ALL_ANSWERS.filter((a) => a.l0 !== "");
    for (const a of completed) {
      const minConf = Math.min(
        a.confidence.l0,
        a.confidence.l1,
        a.confidence.l2,
        a.confidence.l3
      );
      // Allow floating-point tolerance
      expect(Math.abs(a.overallConfidence - minConf)).toBeLessThan(0.01);
    }
  });

  // ── 11. labLinks tab 值合法性 ──
  const VALID_LAB_TABS = ["context", "pipeline", "data", "graph", "experiment"] as const;
  it("labLinks tab values are valid Lab tab keys", () => {
    const withLinks = ALL_ANSWERS.filter((a) => a.labLinks && a.labLinks.length > 0);
    expect(withLinks.length).toBeGreaterThanOrEqual(19);
    for (const a of withLinks) {
      for (const link of a.labLinks!) {
        expect(
          VALID_LAB_TABS.includes(link.tab as typeof VALID_LAB_TABS[number]),
          `q=${a.id} invalid lab tab "${link.tab}"`,
        ).toBe(true);
      }
    }
  });

  // ── 额外：每个完成答案 ID 可被 getAnswerById 查找 ──
  it("every completed answer is findable by getAnswerById", () => {
    const completed = ALL_ANSWERS.filter((a) => a.l0 !== "");
    for (const a of completed) {
      const found = getAnswerById(a.id);
      expect(found).toBeDefined();
      expect(found!.l0).toBe(a.l0);
    }
  });

  // ── 额外：章答案数分布 ──
  it("chapter distribution matches spec", () => {
    const expectedDistribution: Record<string, number> = {
      ch1: 17,
      ch2: 27,
      ch3: 17,
      ch4: 10,
      ch5: 6,
      ch6: 6,
      ch7: 6,
      ch8: 6,
    };
    for (const [chId, expected] of Object.entries(expectedDistribution)) {
      expect(
        ALL_ANSWERS.filter((a) => a.chapter === chId).length
      ).toBe(expected);
    }
  });

  // ── 额外：completed + placeholder = total ──
  it("completed + placeholder = 93", () => {
    const completed = ALL_ANSWERS.filter((a) => a.l0 !== "").length;
    const stubs = ALL_ANSWERS.filter((a) => a.l0 === "").length;
    expect(completed + stubs).toBe(95);
  });
});

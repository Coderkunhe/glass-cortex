import { describe, it, expect } from "vitest";
import {
  getChapters,
  getQuestionsByChapter,
  getAnswerById,
} from "@/lib/content/questions";

describe("getChapters", () => {
  it("returns 8 chapters", () => {
    expect(getChapters()).toHaveLength(8);
  });

  it("each chapter has required fields", () => {
    for (const ch of getChapters()) {
      expect(ch.id).toBeTruthy();
      expect(ch.title).toBeTruthy();
      expect(ch.questionCount).toBeGreaterThan(0);
    }
  });

  it("ch1 has 17 questions", () => {
    const ch = getChapters().find((c) => c.id === "ch1");
    expect(ch?.questionCount).toBe(17);
  });
});

describe("getQuestionsByChapter", () => {
  it("filters by chapter id", () => {
    const ch1 = getQuestionsByChapter("ch1");
    expect(ch1).toHaveLength(17);
    expect(ch1.every((q) => q.chapter === "ch1")).toBe(true);
  });

  it("returns empty for nonexistent chapter", () => {
    expect(getQuestionsByChapter("nonexistent")).toHaveLength(0);
  });

  it("all questions have required fields", () => {
    const all = getQuestionsByChapter("ch1");
    for (const q of all) {
      expect(q.id).toBeTruthy();
      expect(q.question).toBeTruthy();
      expect(q.chapter).toBeTruthy();
      expect(q.priority).toBeTruthy();
    }
  });
});

describe("getAnswerById", () => {
  it("finds q1.1", () => {
    const a = getAnswerById("q1.1");
    expect(a).toBeDefined();
    expect(a!.question).toBeTruthy();
    expect(a!.l0).toBeTruthy();
  });

  it("returns undefined for nonexistent id", () => {
    expect(getAnswerById("nonexistent")).toBeUndefined();
  });

  it("q1.1 has non-empty L0-L3 content", () => {
    const a = getAnswerById("q1.1")!;
    expect(a.l0.length).toBeGreaterThan(0);
    expect(a.l1.length).toBeGreaterThan(0);
    expect(a.l2.length).toBeGreaterThan(0);
    expect(a.l3.length).toBeGreaterThan(0);
  });

  it("q1.2 has non-empty L0-L3 content", () => {
    const a = getAnswerById("q1.2")!;
    expect(a.l0.length).toBeGreaterThan(0);
    expect(a.l1.length).toBeGreaterThan(0);
    expect(a.l2.length).toBeGreaterThan(0);
    expect(a.l3.length).toBeGreaterThan(0);
  });
});

/**
 * estimateReadingTime 工具函数测试。
 *
 * 覆盖：纯中文、纯英文、中英混合、空字符串、formatReadingTime 各档位。
 */

import { describe, it, expect } from "vitest";
import {
  estimateReadingTime,
  formatReadingTime,
} from "@/lib/content/estimateReadingTime";

describe("estimateReadingTime", () => {
  it("returns 1 minute for empty string", () => {
    expect(estimateReadingTime("")).toBe(1);
  });

  it("returns minimum 1 minute for very short text", () => {
    expect(estimateReadingTime("你好")).toBe(1);
    expect(estimateReadingTime("hi")).toBe(1);
  });

  it("estimates pure Chinese text (~250 chars/min)", () => {
    // 250 汉字 → 1 分钟
    const chars250 = "的".repeat(250);
    expect(estimateReadingTime(chars250)).toBe(1);

    // 500 汉字 → 2 分钟
    const chars500 = "的".repeat(500);
    expect(estimateReadingTime(chars500)).toBe(2);

    // 750 汉字 → 3 分钟
    const chars750 = "的".repeat(750);
    expect(estimateReadingTime(chars750)).toBe(3);
  });

  it("estimates pure English text (~200 words/min)", () => {
    // 200 单词 → 1 分钟
    const words200 = Array(200).fill("word").join(" ");
    expect(estimateReadingTime(words200)).toBe(1);

    // 400 单词 → 2 分钟
    const words400 = Array(400).fill("word").join(" ");
    expect(estimateReadingTime(words400)).toBe(2);
  });

  it("estimates mixed Chinese/English text", () => {
    // 125 汉字 + 100 单词 → 各 0.5 分钟 → 合计 1 分钟
    const chinese125 = "的".repeat(125);
    const english100 = Array(100).fill("word").join(" ");
    expect(estimateReadingTime(chinese125 + " " + english100)).toBe(1);
  });

  it("rounds to nearest minute", () => {
    // 125 汉字 → 0.5 分钟 → round to 1（但 Math.max 确保 >=1）
    const chars125 = "的".repeat(125);
    expect(estimateReadingTime(chars125)).toBe(1);

    // 375 汉字 → 1.5 分钟 → round to 2
    const chars375 = "的".repeat(375);
    expect(estimateReadingTime(chars375)).toBe(2);
  });
});

describe("formatReadingTime", () => {
  it('returns "约 1 分钟" for 1 minute', () => {
    expect(formatReadingTime(1)).toBe("约 1 分钟");
  });

  it('returns "约 N 分钟" for < 60 minutes', () => {
    expect(formatReadingTime(3)).toBe("约 3 分钟");
    expect(formatReadingTime(59)).toBe("约 59 分钟");
  });

  it('returns "约 N 小时" for exact hours', () => {
    expect(formatReadingTime(60)).toBe("约 1 小时");
    expect(formatReadingTime(120)).toBe("约 2 小时");
  });

  it('returns "约 N 小时 M 分钟" for partial hours', () => {
    expect(formatReadingTime(75)).toBe("约 1 小时 15 分钟");
    expect(formatReadingTime(130)).toBe("约 2 小时 10 分钟");
  });

  it("handles 0 minute as 1 minute display", () => {
    expect(formatReadingTime(0)).toBe("约 1 分钟");
  });
});

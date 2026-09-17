/**
 * L0 摘要 markdown 渲染完整性校验 — B148 修复的回归守卫。
 *
 * 背景：早期问题的 l0 是纯文本一句话结论，后段问题（ch2/ch3/ch5 部分）
 * 的 l0 是含标题/表格/mermaid 的富文本摘要。B148 之前 AnswerCard 把 l0
 * 当纯文本 `{answer.l0}` 渲染，导致 q2.20/q3.3 等富文本 l0 字面显示
 * `###`/`####`/表格管道符。B148 起 l0 改走 renderMarkdownSegmented。
 *
 * 本测试用真实数据断言：富文本 l0 渲染为结构化 HTML，无字面 markdown 残留。
 */

import { describe, it, expect } from "vitest";
import { ALL_ANSWERS, getAnswerById } from "@/lib/content/questions";
import { renderMarkdownSegmented } from "@/lib/renderMarkdown";

/** 拼接所有 html 段（mermaid 段不产生字面 markdown，用占位符替代） */
function htmlOf(md: string): string {
  return renderMarkdownSegmented(md)
    .map((s) => (s.type === "html" ? s.html : "<MermaidDiagram/>"))
    .join("");
}

/** 真实数据中 l0 含 markdown 标记的 16 个答案（ch2×7 + ch3×4 + ch5×5） */
const MARKDOWN_L0_IDS = [
  "q2.20", "q2.21", "q2.22", "q2.23", "q2.24", "q2.25", "q2.26",
  "q3.3", "q3.6", "q3.7", "q3.8",
  "q5.1", "q5.2", "q5.3", "q5.4", "q5.5",
];

describe("L0 摘要 markdown 渲染（B148 回归守卫）", () => {
  it("q3.3 l0 渲染为 <h3> 且无字面 ###", () => {
    const html = htmlOf(getAnswerById("q3.3")!.l0);
    expect(html).toContain("<h3");
    expect(html).not.toMatch(/###/);
    expect(html).not.toMatch(/####/);
  });

  it("q2.20 l0 渲染出 h3/h4/表格/mermaid 段", () => {
    const segs = renderMarkdownSegmented(getAnswerById("q2.20")!.l0);
    const html = segs
      .filter((s) => s.type === "html")
      .map((s) => (s.type === "html" ? s.html : ""))
      .join("");
    expect(html).toContain("<h3");
    expect(html).toContain("<h4");
    expect(html).toContain("<table");
    expect(segs.some((s) => s.type === "mermaid")).toBe(true);
    expect(html).not.toMatch(/###/);
  });

  it("16 个 markdown-l0 答案全部无字面 markdown 标记残留", () => {
    const bad: string[] = [];
    for (const id of MARKDOWN_L0_IDS) {
      const a = getAnswerById(id);
      if (!a) {
        bad.push(`${id} MISSING`);
        continue;
      }
      const html = htmlOf(a.l0);
      for (const marker of ["###", "####", "**", "```"]) {
        if (html.includes(marker)) bad.push(`${id}: literal "${marker}"`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("全部 95 答案 l0 渲染不抛异常（含纯文本 l0）", () => {
    for (const a of ALL_ANSWERS) {
      expect(() => renderMarkdownSegmented(a.l0)).not.toThrow();
    }
  });
});

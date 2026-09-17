import { describe, it, expect } from "vitest";
import { renderMarkdownSegmented } from "@/lib/renderMarkdown";

/**
 * renderMarkdownSegmented 单元测试。
 *
 * 验证声明式分段渲染的切分契约：renderMarkdown 产出的 mermaid 占位
 * `<div class="gm-mermaid-block" data-chart="...">` 被正确切回结构化片段，
 * chart/title 反解无损，html 段顺序与原文一致。
 */
describe("renderMarkdownSegmented", () => {
  it("returns single html segment for plain text", () => {
    const segments = renderMarkdownSegmented("你好，这是一个普通段落。");
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("html");
    if (segments[0].type === "html") {
      expect(segments[0].html).toContain("你好");
    }
  });

  it("splits text + mermaid + text into three ordered segments", () => {
    const md = [
      "before diagram",
      "",
      "```mermaid",
      "graph TD",
      "A-->B",
      "```",
      "",
      "after diagram",
    ].join("\n");
    const segments = renderMarkdownSegmented(md);

    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe("html");
    expect(segments[1].type).toBe("mermaid");
    expect(segments[2].type).toBe("html");

    const mermaid = segments[1];
    if (mermaid.type === "mermaid") {
      expect(mermaid.chart).toBe("graph TD\nA-->B");
      expect(mermaid.title).toBe("流程图");
    }
  });

  it("decodes chart losslessly (unicode + special chars)", () => {
    const chart = "graph LR\n记忆[记忆系统] -->|写入| 存储[SQLite]";
    const md = `\`\`\`mermaid\n${chart}\n\`\`\``;
    const segments = renderMarkdownSegmented(md);

    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("mermaid");
    if (segments[0].type === "mermaid") {
      expect(segments[0].chart).toBe(chart);
    }
  });

  it("decodes %% title directive into title", () => {
    const md = "```mermaid\n%% title: 记忆系统架构\ngraph LR\nA-->B\n```";
    const segments = renderMarkdownSegmented(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("mermaid");
    if (segments[0].type === "mermaid") {
      expect(segments[0].title).toBe("记忆系统架构");
    }
  });

  it("preserves order across multiple mermaid blocks", () => {
    const md = [
      "intro",
      "",
      "```mermaid",
      "graph LR",
      "A-->B",
      "```",
      "",
      "middle",
      "",
      "```mermaid",
      "graph TD",
      "C-->D",
      "```",
      "",
      "outro",
    ].join("\n");
    const segments = renderMarkdownSegmented(md);

    const types = segments.map((s) => s.type);
    expect(types).toEqual(["html", "mermaid", "html", "mermaid", "html"]);

    const charts = segments
      .filter((s) => s.type === "mermaid")
      .map((s) => (s.type === "mermaid" ? s.chart : ""));
    expect(charts).toEqual(["graph LR\nA-->B", "graph TD\nC-->D"]);
  });

  it("handles mermaid at start (no leading empty html segment)", () => {
    const md = "```mermaid\ngraph LR\nA-->B\n```\n\ntrailing text";
    const segments = renderMarkdownSegmented(md);
    expect(segments[0].type).toBe("mermaid");
    expect(segments).toHaveLength(2);
    expect(segments[1].type).toBe("html");
  });

  it("handles mermaid at end (no trailing empty html segment)", () => {
    const md = "leading text\n\n```mermaid\ngraph LR\nA-->B\n```";
    const segments = renderMarkdownSegmented(md);
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe("html");
    expect(segments[1].type).toBe("mermaid");
  });

  it("returns empty array for empty/null/whitespace input", () => {
    expect(renderMarkdownSegmented("")).toEqual([]);
    expect(renderMarkdownSegmented(null as unknown as string)).toEqual([]);
    expect(renderMarkdownSegmented("   \n\t\n  ")).toEqual([]);
  });

  it("does not emit mermaid segment for empty fenced block", () => {
    // renderMarkdown 对空 chart 不发射 .gm-mermaid-block div → 段回退纯 html
    const segments = renderMarkdownSegmented("```mermaid\n\n```");
    expect(segments.every((s) => s.type === "html")).toBe(true);
  });

  it("keeps regular code blocks inside html segments", () => {
    const md = "text\n\n```python\nprint('hi')\n```";
    const segments = renderMarkdownSegmented(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("html");
    if (segments[0].type === "html") {
      expect(segments[0].html).toContain("language-python");
    }
  });
});

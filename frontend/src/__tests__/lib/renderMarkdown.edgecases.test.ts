/**
 * renderMarkdown 边界条件全量扫描测试。
 *
 * 覆盖所有可能导致渲染失败的边界场景：
 * - Mermaid base64 编解码含中文/特殊字符
 * - 表格变体（对齐、单列、空单元格）
 * - 空 mermaid/代码块
 * - 代码块无语言标注
 * - 图片 URL 特殊字符 & 安全策略
 * - 嵌套围栏代码块
 * - 混合内容场景
 * - <hr> void 元素段落边界（B138 扩展）
 *
 * Phase 66 B138 扩展排查。
 */

import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/renderMarkdown";

describe("renderMarkdown edge cases — Mermaid", () => {
  it("handles Chinese characters in mermaid node labels (base64 roundtrip)", () => {
    const html = renderMarkdown(
      '```mermaid\ngraph LR\nA["用户输入"] --> B["意图分类"]\n```',
    );
    expect(html).toContain('<div class="gm-mermaid-block"');
    expect(html).toContain("data-chart=");
    // Verify the base64 can be decoded back
    const match = html.match(/data-chart="([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded = decodeURIComponent(atob(match![1]));
    expect(decoded).toContain("用户输入");
    expect(decoded).toContain("意图分类");
  });

  it("handles special characters in mermaid definitions", () => {
    const html = renderMarkdown(
      '```mermaid\ngraph LR\nA["x<y & z>w"] --> B["test"]\n```',
    );
    expect(html).toContain('<div class="gm-mermaid-block"');
    expect(html).toContain("data-chart=");
    const match = html.match(/data-chart="([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded = decodeURIComponent(atob(match![1]));
    expect(decoded).toContain("x<y & z>w");
  });

  it("handles mermaid blocks with %% title directive", () => {
    const html = renderMarkdown(
      "```mermaid\n%% title: 记忆管线流程图\ngraph LR\nA-->B\n```",
    );
    expect(html).toContain('<div class="gm-mermaid-block"');
    expect(html).toContain('data-title="记忆管线流程图"');
    const match = html.match(/data-chart="([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded = decodeURIComponent(atob(match![1]));
    // The title line is preserved in the chart (mermaid.js treats %% as comments)
    expect(decoded).toContain("A-->B");
    expect(decoded).toContain("%% title:");
  });

  it("silently removes empty mermaid block (no chart to render)", () => {
    const html = renderMarkdown("```mermaid\n```");
    // Empty chart is falsy → block is removed (no placeholder div needed)
    // This prevents MermaidDiagram from trying to render nothing
    expect(html).not.toContain('<div class="gm-mermaid-block"');
    expect(html).not.toContain("```");
  });

  it("silently removes whitespace-only mermaid block", () => {
    const html = renderMarkdown("```mermaid\n   \n```");
    expect(html).not.toContain('<div class="gm-mermaid-block"');
    expect(html).not.toContain("```");
  });

  it("handles multiple mermaid blocks in same content", () => {
    const html = renderMarkdown(
      "```mermaid\ngraph LR\nA-->B\n```\n\n```mermaid\ngraph TD\nC-->D\n```",
    );
    const blocks = html.match(/gm-mermaid-block/g);
    expect(blocks).not.toBeNull();
    expect(blocks!.length).toBe(2);
  });

  it("extracts mermaid block before code block regex (mermaid is NOT a code block)", () => {
    const html = renderMarkdown("```mermaid\ngraph LR\nA-->B\n```");
    expect(html).toContain('<div class="gm-mermaid-block"');
    expect(html).not.toContain("<pre>");
  });
});

describe("renderMarkdown edge cases — Tables", () => {
  it("documents: table without leading pipe renders as text (current limitation)", () => {
    // Parser requires ^|...|$ — tables without leading | are not detected
    const html = renderMarkdown("Header | Value\n------ | ------\nfoo | bar");
    expect(html).not.toContain("<table>");
    // Content not lost
    expect(html).toContain("Header | Value");
  });

  it("renders table with mixed alignment separators", () => {
    const html = renderMarkdown("| A | B | C |\n| :-- | :--: | --: |\n| 1 | 2 | 3 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("handles single-column table", () => {
    const html = renderMarkdown("| Only |\n| - |\n| val |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Only</th>");
    expect(html).toContain("<td>val</td>");
  });

  it("handles table with empty cells", () => {
    const html = renderMarkdown("| A | B |\n| - | - |\n|  |  |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td></td>");
  });

  it("handles table with bold/italic in cells", () => {
    const html = renderMarkdown("| Col |\n| - |\n| **bold** and *italic* |");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("handles table with links in cells", () => {
    const html = renderMarkdown("| Link |\n| - |\n| [click](https://x.com) |");
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://x.com"');
  });

  it("renders two pipe-delimited rows without separator as table (parser behavior)", () => {
    // Two rows with | delimiters — the second row is not a separator
    // so both become <tr> rows (no <th> header)
    const html = renderMarkdown("| A | B |\n| 1 | 2 |");
    expect(html).toContain("<table>");
  });
});

describe("renderMarkdown edge cases — Code Blocks", () => {
  it("handles code block with no language tag", () => {
    const html = renderMarkdown("```\nplain code\nno language\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("plain code");
    // No lang label span for plaintext fallback
    expect(html).not.toContain("gm-code-lang-label");
  });

  it("handles code block with unsupported language", () => {
    const html = renderMarkdown("```brainfuck\n+++++[>+++++<-]>\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain('class="language-brainfuck"');
    expect(html).toContain("Brainfuck");
  });

  it("documents: inner ``` prematurely closes outer code block (markdown spec limitation)", () => {
    // To have backtick sequences in a code block, the outer fence must use
    // MORE backticks than any inner sequence. Our regex uses non-greedy
    // matching, so the first ``` closes the block. This is expected behavior.
    const html = renderMarkdown("```md\nUse ```code``` for inline\n```");
    // The inner ``` splits the block — expected for standard markdown parsers
    // Content is still present (split across two code blocks)
    expect(html).toContain("<pre>");
    expect(html).toContain("Use");
  });

  it("handles very long code blocks without performance issues", () => {
    const longCode = "console.log('line ' + i);\n".repeat(500);
    const html = renderMarkdown("```js\n" + longCode + "```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("console.log");
  });

  it("handles code block with only whitespace content", () => {
    const html = renderMarkdown("```\n   \n\t\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });

  it("restores code block exactly after HTML escaping (no double-escape)", () => {
    const html = renderMarkdown("```html\n<div class=\"test\">hello</div>\n```");
    expect(html).toContain("&lt;div class=");
    expect(html).toContain("&lt;/div&gt;");
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&amp;gt;");
  });
});

describe("renderMarkdown edge cases — Images & Links (URL escaping fix, B138)", () => {
  // jsdom serializes & in attribute values as &amp; — this is correct
  // HTML serialization. The real test is that URLs are NOT double-escaped
  // (i.e. no &amp;amp; in output).

  it("does NOT double-escape & in image URLs with query params", () => {
    const html = renderMarkdown("![img](https://example.com/pic.jpg?w=800&h=600)");
    expect(html).toContain("pic.jpg?w=800");
    expect(html).toContain("h=600");
    // Critical: no double-escape — &amp;amp; means the & was escaped twice
    expect(html).not.toContain("&amp;amp;");
  });

  it("does NOT double-escape & in link URLs", () => {
    const html = renderMarkdown("[link](https://example.com?a=1&b=2)");
    expect(html).toContain("a=1");
    expect(html).toContain("b=2");
    expect(html).not.toContain("&amp;amp;");
  });

  it("renders image with URL-encoded path", () => {
    const html = renderMarkdown("![img](https://example.com/path%20with%20spaces.jpg)");
    expect(html).toContain("path%20with%20spaces.jpg");
  });

  it("renders image with empty alt text", () => {
    const html = renderMarkdown("![](https://example.com/pic.jpg)");
    expect(html).toContain("example.com/pic.jpg");
    expect(html).toContain('alt=""');
  });

  it("blocks data: URI images", () => {
    const html = renderMarkdown("![inline](data:image/png;base64,iVBORw0KGgo=)");
    expect(html).not.toContain('<img');
    expect(html).toContain("inline");
  });

  it("renders image inside table cell", () => {
    const html = renderMarkdown("| Pic |\n| - |\n| ![icon](https://x.com/icon.png) |");
    expect(html).toContain("<table>");
    expect(html).toContain("x.com/icon.png");
  });

  it("renders multiple images on same line", () => {
    const html = renderMarkdown("![a](https://a.com/1.png) ![b](https://b.com/2.png)");
    const imgs = html.match(/<img /g);
    expect(imgs).not.toBeNull();
    expect(imgs!.length).toBe(2);
  });

  it("handles mailto: links", () => {
    const html = renderMarkdown("[email](mailto:test@example.com)");
    expect(html).toContain('href="mailto:test@example.com"');
  });

  it("handles anchor links (#fragment)", () => {
    const html = renderMarkdown("[go down](#section-1)");
    expect(html).toContain('href="#section-1"');
  });

  it("handles relative path links", () => {
    const html = renderMarkdown("[about](/about)");
    expect(html).toContain('href="/about"');
  });

  it("blocks data: protocol in links", () => {
    const html = renderMarkdown("[bad](data:text/html,<script>alert(1)</script>)");
    expect(html).not.toContain("data:");
  });
});

describe("renderMarkdown edge cases — Media URLs", () => {
  it("handles .webm video URL", () => {
    const html = renderMarkdown("https://example.com/video.webm");
    expect(html).toContain("<video controls");
  });

  it("handles .mov video URL", () => {
    const html = renderMarkdown("https://example.com/video.mov");
    expect(html).toContain("<video controls");
  });

  it("handles .wav audio URL", () => {
    const html = renderMarkdown("https://example.com/sound.wav");
    expect(html).toContain("<audio controls");
  });

  it("handles .m4a audio URL", () => {
    const html = renderMarkdown("https://example.com/podcast.m4a");
    expect(html).toContain("<audio controls");
  });

  it("handles Vimeo URL", () => {
    const html = renderMarkdown("https://vimeo.com/123456789");
    expect(html).toContain('<iframe class="gm-md-embed"');
    expect(html).toContain("player.vimeo.com/video/123456789");
  });

  it("does NOT convert non-media standalone URL to media element", () => {
    const html = renderMarkdown("https://example.com/page.html");
    expect(html).not.toContain("<video");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("https://example.com/page.html");
  });
});

describe("renderMarkdown edge cases — Blockquotes", () => {
  it("handles blockquote with all 6 Chinese variant labels", () => {
    const variants = ["关键洞察", "防护", "注意", "配置", "笔记", "总结"];
    const cssClasses = ["insight", "guard", "warning", "config", "note", "summary"];
    variants.forEach((label, i) => {
      const html = renderMarkdown(`> **${label}**：test content`);
      expect(html).toContain(`answer-bq--${cssClasses[i]}`);
      expect(html).toContain("<blockquote");
    });
  });

  it("handles multi-paragraph blockquotes", () => {
    const html = renderMarkdown("> first paragraph\n>\n> second paragraph");
    expect(html).toContain("<blockquote");
    expect(html).toContain("first paragraph");
    expect(html).toContain("second paragraph");
  });

  it("handles blockquote with code inside", () => {
    const html = renderMarkdown("> use `const` for constants");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<code>const</code>");
  });

  it("handles nested blockquote-like content (>>)", () => {
    const html = renderMarkdown(">> nested quote attempt");
    expect(html).toContain("&gt;&gt;");
  });
});

describe("renderMarkdown edge cases — Horizontal Rules (B138)", () => {
  it("handles <hr> not wrapped in <p>", () => {
    const html = renderMarkdown("text\n---\nmore text");
    expect(html).toContain("<hr>");
    expect(html).not.toMatch(/<p><hr>/);
    expect(html).not.toMatch(/<hr><\/p>/);
  });

  it("handles <hr> between paragraphs — no empty paragraphs (B138 regression)", () => {
    const html = renderMarkdown("paragraph one\n---\nparagraph two");
    expect(html).toContain("<hr>");
    expect(html).not.toContain("<p></p>");
    // Both paragraphs should be properly wrapped
    expect(html).toContain("paragraph one");
    expect(html).toContain("paragraph two");
  });

  it("handles <hr> at end of content", () => {
    const html = renderMarkdown("text\n---");
    expect(html).toContain("<hr>");
  });

  it("handles <hr> at start of content", () => {
    const html = renderMarkdown("---\ntext");
    expect(html).toContain("<hr>");
  });

  it("handles <hr> between multiple paragraphs (3+ sections)", () => {
    const html = renderMarkdown("one\n---\ntwo\n---\nthree");
    const hrs = html.match(/<hr>/g);
    expect(hrs).not.toBeNull();
    expect(hrs!.length).toBe(2);
    expect(html).not.toContain("<p></p>");
  });
});

describe("renderMarkdown edge cases — Lists", () => {
  it("handles list with blank lines between all items (loose list)", () => {
    const html = renderMarkdown("1. first\n\n2. second\n\n3. third");
    expect(html).toContain("<ol>");
    expect((html.match(/<ol>/g) || []).length).toBe(1);
  });

  it("handles deeply nested list (5+ levels)", () => {
    const html = renderMarkdown("- a\n  - b\n    - c\n      - d\n        - e");
    expect((html.match(/<ul>/g) || []).length).toBe(5);
  });

  it("handles mixed ordered/unordered at every level", () => {
    const html = renderMarkdown("1. first\n   - sub a\n     1. sub-sub 1\n   - sub b\n2. second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<ul>");
  });

  it("handles list item with indented continuation line", () => {
    const html = renderMarkdown("- item1a\n  item1b\n- item2");
    expect(html).toContain("<li>");
  });

  it("handles list with immediate sublist (no blank line)", () => {
    const html = renderMarkdown("- parent\n  - child");
    expect(html).toContain("<ul>");
    expect(html).toMatch(/<li>parent<ul>/);
  });
});

describe("renderMarkdown edge cases — DOMPurify defense-in-depth", () => {
  // NOTE: renderMarkdown's Step 1 entity-escapes all HTML before DOMPurify
  // sees it. Direct HTML injection like <script> becomes &lt;script&gt;
  // (safe text). These tests verify the defense-in-depth is working.

  it("entity-escapes raw HTML tags before DOMPurify (XSS defense layer 1)", () => {
    const html = renderMarkdown("<div><script>alert('xss')</script>text</div>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("entity-escapes event handlers before DOMPurify", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("entity-escapes style attributes before DOMPurify", () => {
    const html = renderMarkdown('<span style="color:red">text</span>');
    expect(html).toContain("&lt;span");
    expect(html).toContain("&lt;/span&gt;");
  });

  it("preserves allowed attributes on iframe embeds", () => {
    const html = renderMarkdown("https://www.youtube.com/watch?v=abc123");
    expect(html).toContain("allowfullscreen");
    expect(html).toContain("accelerometer");
  });

  it("preserves loading attribute on images", () => {
    const html = renderMarkdown("![cat](https://example.com/cat.jpg)");
    expect(html).toContain('loading="lazy"');
  });

  it("preserves data-chart and data-title attributes on mermaid div", () => {
    const html = renderMarkdown(
      '```mermaid\n%% title: 测试图\ngraph LR\nA-->B\n```',
    );
    expect(html).toContain("data-chart=");
    expect(html).toContain('data-title="测试图"');
  });
});

describe("renderMarkdown edge cases — Content with null/whitespace", () => {
  it("returns empty string for null input", () => {
    expect(renderMarkdown(null as unknown as string)).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    const html = renderMarkdown("   \n\t\n   ");
    expect(html).not.toContain("<p>");
  });
});

describe("renderMarkdown edge cases — Mixed content scenarios", () => {
  it("handles mermaid + code + table in same content", () => {
    const input = `# Overview

Here is a diagram:

\`\`\`mermaid
graph LR
A["输入"] --> B["输出"]
\`\`\`

Some code:

\`\`\`python
def hello():
    print("world")
\`\`\`

A table:

| Key | Value |
| - | - |
| foo | bar |
`;
    const html = renderMarkdown(input);
    expect(html).toContain('<div class="gm-mermaid-block"');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code class="language-python"');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>bar</td>');
  });

  it("handles content with ALL markdown features simultaneously", () => {
    const input = `# Main Title

## Section

**Bold** and *italic* and \`code\`.

![img](https://example.com/pic.jpg)

[link](https://example.com)

| A | B |
| - | - |
| 1 | 2 |

- list item
  - nested

1. ordered
2. list

> blockquote

---

\`\`\`js
const x = 1;
\`\`\`

\`\`\`mermaid
graph LR
A-->B
\`\`\`
`;
    const html = renderMarkdown(input);
    expect(html).toContain('<h1 id="main-title">Main Title</h1>');
    expect(html).toContain('<h2 id="section">Section</h2>');
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("example.com/pic.jpg");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<table>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<hr>");
    expect(html).toContain('<pre>');
    expect(html).toContain('<div class="gm-mermaid-block"');
  });
});

describe("renderMarkdown edge cases — extractMermaid regex alignment", () => {
  it("mermaid block with no space before newline", () => {
    const input = "```mermaid\ngraph LR\nA-->B\n```";
    const html = renderMarkdown(input);
    expect(html).toContain('<div class="gm-mermaid-block"');
  });

  it("mermaid block with space before newline (tolerant)", () => {
    // renderMarkdown's \s*\n handles trailing spaces; extractMermaid now does too
    const input = "```mermaid \ngraph LR\nA-->B\n```";
    const html = renderMarkdown(input);
    expect(html).toContain('<div class="gm-mermaid-block"');
  });

  it("mermaid block with CRLF line ending", () => {
    const input = "```mermaid\r\ngraph LR\r\nA-->B\r\n```";
    const html = renderMarkdown(input);
    expect(html).toContain('<div class="gm-mermaid-block"');
  });
});

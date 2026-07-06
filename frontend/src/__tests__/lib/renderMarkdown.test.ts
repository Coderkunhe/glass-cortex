import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/renderMarkdown";

describe("renderMarkdown", () => {
  it("renders plain text in p tags", () => {
    const html = renderMarkdown("你好");
    expect(html).toContain("<p>你好</p>");
  });

  it("renders **bold**", () => {
    const html = renderMarkdown("hello **world**!");
    expect(html).toContain("<strong>world</strong>");
  });

  it("renders *italic*", () => {
    const html = renderMarkdown("hello *world*!");
    expect(html).toContain("<em>world</em>");
  });

  it("renders `inline code`", () => {
    const html = renderMarkdown("use `const` here");
    expect(html).toContain("<code>const</code>");
  });

  it("renders ```code blocks```", () => {
    const html = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("emits class='language-xxx' on code blocks (Prism compatible)", () => {
    const html = renderMarkdown("```python\nprint(1)\n```");
    expect(html).toContain('class="language-python"');
  });

  it("renders unordered lists", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders ordered lists", () => {
    const html = renderMarkdown("1. first\n2. second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
  });

  it("does not nest <ul> inside <ol> (mixed list order)", () => {
    // Bug: 有序列表被 ol 包裹后，无序列表正则再次匹配 ol 内的 li，造成双包裹
    const html = renderMarkdown("1. ordered one\n2. ordered two\n\n- unordered one\n- unordered two");
    // 各自独立包裹，不嵌套
    expect(html).toContain("<ol>");
    expect(html).toContain("</ol>");
    expect(html).toContain("<ul>");
    expect(html).toContain("</ul>");
    // 不应出现 <ol> 内再包 <ul>
    expect(html).not.toMatch(/<ol>\s*<ul>/);
    expect(html).not.toMatch(/<\/ul>\s*<\/ol>/);
  });

  // ── Phase 66 B25: 列表渲染修复 — 双换行 + 中文格式 ──

  it("groups loose ordered list items separated by \\n\\n into one <ol>", () => {
    // 标准 markdown loose list：项之间双换行分隔
    const html = renderMarkdown("1. first\n\n2. second\n\n3. third");
    // 应只有一个 <ol>，包含三个 <li>
    const olMatches = html.match(/<ol>/g);
    expect(olMatches).not.toBeNull();
    expect(olMatches!.length).toBe(1);
    expect(html.match(/<\/ol>/g)!.length).toBe(1);
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("<li>third</li>");
  });

  it("groups loose unordered list items separated by \\n\\n into one <ul>", () => {
    const html = renderMarkdown("- one\n\n- two\n\n- three");
    const ulMatches = html.match(/<ul>/g);
    expect(ulMatches).not.toBeNull();
    expect(ulMatches!.length).toBe(1);
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("<li>three</li>");
  });

  it("renders ordered list with Chinese comma format (N、)", () => {
    const html = renderMarkdown("1、第一项\n2、第二项");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>第一项</li>");
    expect(html).toContain("<li>第二项</li>");
  });

  it("renders ordered list with parenthesis format (N))", () => {
    const html = renderMarkdown("1) first\n2) second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
  });

  it("renders ordered list with full-width dot (N．)", () => {
    const html = renderMarkdown("1．第一步\n2．第二步");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>第一步</li>");
    expect(html).toContain("<li>第二步</li>");
  });

  it("renders unordered list with asterisk marker (*)", () => {
    const html = renderMarkdown("* one\n* two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders unordered list with bullet marker (•)", () => {
    const html = renderMarkdown("• one\n• two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("handles bold text inside loose list items", () => {
    // Phase 66 B25: 截图所示场景 — 编号列表项有 \n\n 分隔 + **粗体**标题
    const html = renderMarkdown(
      "以下是七条原则：\n\n1. **类比先行**：先给一个生活化的类比。\n\n2. **概念映射**：把已知概念与技术术语建立桥梁。\n\n3. **场景带入**：用你而非用户。",
    );
    expect(html).toMatch(/<ol>/);
    // 应该只有一个 <ol>
    expect((html.match(/<ol>/g) || []).length).toBe(1);
    expect(html).toContain("<strong>类比先行</strong>");
    expect(html).toContain("<strong>概念映射</strong>");
    expect(html).toContain("<strong>场景带入</strong>");
    expect(html).toContain("<li>");
  });

  it("keeps separate ordered and unordered lists independent (loose)", () => {
    const html = renderMarkdown("1. ordered\n\n- unordered\n\n2. ordered again");
    // 不应把所有 <li> 混进同一个 ol/ul
    expect(html).toContain("<ol>");
    expect(html).toContain("<ul>");
    expect(html).not.toMatch(/<ol>.*<ul>.*<\/ul>.*<\/ol>/);
  });

  it("renders [links](url)", () => {
    const html = renderMarkdown("[click](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
  });

  it("blocks javascript: links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("renders h1-h6 headings", () => {
    expect(renderMarkdown("# h1")).toContain("<h1>h1</h1>");
    expect(renderMarkdown("## h2")).toContain("<h2>h2</h2>");
    expect(renderMarkdown("### h3")).toContain("<h3>h3</h3>");
    expect(renderMarkdown("#### h4")).toContain("<h4>h4</h4>");
    expect(renderMarkdown("##### h5")).toContain("<h5>h5</h5>");
    expect(renderMarkdown("###### h6")).toContain("<h6>h6</h6>");
  });

  it("does not treat 7+ hashes as heading", () => {
    const html = renderMarkdown("####### not a heading");
    // 7 hashes is not valid markdown heading — should stay as literal text
    expect(html).not.toContain("<h");
    expect(html).toContain("#######");
  });

  it("renders --- as hr", () => {
    const html = renderMarkdown("above\n---\nbelow");
    expect(html).toContain("<hr>");
  });

  it("returns empty string for undefined", () => {
    expect(renderMarkdown(undefined as unknown as string)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("sanitizes script tags", () => {
    const html = renderMarkdown("<script>alert('xss')</script>");
    // Script tags are HTML-escaped — raw tag must not appear
    expect(html).not.toContain("<script>");
    // "alert" appears inside safe &lt; entities — verify entities are present
    expect(html).toContain("&lt;script&gt;");
  });

  // ═══ 图片 — ![alt](url) ═══
  it("renders ![alt](url) as img tag", () => {
    const html = renderMarkdown("![cat](https://example.com/cat.jpg)");
    expect(html).toContain('<img src="https://example.com/cat.jpg"');
    expect(html).toContain('alt="cat"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="gm-md-img"');
  });

  it("blocks javascript: in image src", () => {
    const html = renderMarkdown("![xss](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('<img');
    expect(html).toContain("xss"); // alt text preserved, image blocked
  });

  it("renders image with http:// URLs", () => {
    const html = renderMarkdown("![logo](http://example.com/logo.png)");
    expect(html).toContain('<img src="http://example.com/logo.png"');
  });

  it("renders image with relative path", () => {
    const html = renderMarkdown("![icon](./icons/star.png)");
    expect(html).toContain('<img src="./icons/star.png"');
  });

  // ═══ 媒体 URL 检测 — 独立行 ═══
  it("detects standalone .mp4 URL as video element", () => {
    const html = renderMarkdown("https://example.com/video.mp4");
    expect(html).toContain("<video controls");
    expect(html).toContain('src="https://example.com/video.mp4"');
    expect(html).toContain('class="gm-md-video"');
  });

  it("detects standalone .mp3 URL as audio element", () => {
    const html = renderMarkdown("https://example.com/song.mp3");
    expect(html).toContain("<audio controls");
    expect(html).toContain('src="https://example.com/song.mp3"');
    expect(html).toContain('class="gm-md-audio"');
  });

  it("does not convert inline URL in paragraph text", () => {
    const html = renderMarkdown("Check out https://example.com/video.mp4 for more");
    // The URL is inside a paragraph with surrounding text, not standalone
    expect(html).not.toContain("<video");
    expect(html).toContain("https://example.com/video.mp4");
  });

  it("converts YouTube watch URL to iframe embed", () => {
    const html = renderMarkdown("https://www.youtube.com/watch?v=abc123");
    expect(html).toContain('<iframe class="gm-md-embed"');
    expect(html).toContain("youtube.com/embed/abc123");
    expect(html).toContain("allowfullscreen");
  });

  it("converts YouTube short URL to iframe embed", () => {
    const html = renderMarkdown("https://youtu.be/xyz789");
    expect(html).toContain('<iframe class="gm-md-embed"');
    expect(html).toContain("youtube.com/embed/xyz789");
  });

  // ═══ Mermaid 占位符 ═══
  it("preserves mermaid blocks as base64 placeholder divs", () => {
    const html = renderMarkdown("```mermaid\ngraph LR\nA-->B\n```");
    expect(html).toContain('<div class="gm-mermaid-block"');
    expect(html).toContain("data-chart=");
  });

  // ═══ 代码块边界条件 (Phase 66 L5: CRLF + 空格容错) ═══
  it("extracts <pre> from <p> when text precedes code block", () => {
    // Regression: "Here is code:\n```ts\nconst x = 1;\n```" — code block
    // after text on same line should not end up as <p>text<pre>...</pre></p>
    const html = renderMarkdown("Here is code:\n```ts\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
    // <pre> must NOT be preceded by text without a closing </p>
    // Pattern check: after text content and before <pre>, there must be a </p>
    const preIdx = html.indexOf("<pre");
    const beforePre = html.substring(0, preIdx);
    // The last tag before <pre> should be </p>, not raw text
    expect(beforePre).toMatch(/<\/p>\s*$/);
  });
  it("handles ```code blocks with CRLF line endings", () => {
    const html = renderMarkdown("```html\r\n<div>test</div>\r\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("&lt;div&gt;test&lt;/div&gt;");
    expect(html).not.toContain("```html"); // 裸标记不应出现
  });

  it("handles single-line ```code blocks (no newline after lang)", () => {
    const html = renderMarkdown('```python print("hello")```');
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain('class="language-python"');
    expect(html).toContain('print("hello")');
    expect(html).not.toContain("```python");
  });

  it("handles ```code blocks with trailing space after lang tag", () => {
    const html = renderMarkdown("```html \n<div>test</div>\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("&lt;div&gt;test&lt;/div&gt;");
    expect(html).not.toContain("```html");
  });

  it("handles mermaid blocks with CRLF line endings", () => {
    const html = renderMarkdown("```mermaid\r\ngraph LR\r\nA-->B\r\n```");
    expect(html).toContain('<div class="gm-mermaid-block"');
    expect(html).toContain("data-chart=");
    expect(html).not.toContain("```mermaid");
  });

  it("normalizes standalone CR (legacy Mac) to LF", () => {
    const html = renderMarkdown("```ts\ra = 1\r```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("a = 1");
    expect(html).not.toContain("```ts");
  });

  // ═══ 表格 ═══
  it("renders markdown tables", () => {
    const html = renderMarkdown("| A | B |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  // ═══ 嵌套列表 ═══
  it("renders 2-level nested unordered list", () => {
    const html = renderMarkdown("- parent\n  - child1\n  - child2");
    // parent <li> contains child <ul>
    expect(html).toMatch(/<li>parent<ul>/);
    expect(html).toContain("<li>child1</li>");
    expect(html).toContain("<li>child2</li>");
    // 两层 ul 闭合正确
    expect(html.match(/<ul>/g)?.length).toBe(2);
    expect(html.match(/<\/ul>/g)?.length).toBe(2);
  });

  it("renders 3-level deep nested list", () => {
    const html = renderMarkdown("- a\n  - b\n    - c");
    expect(html.match(/<ul>/g)?.length).toBe(3);
    expect(html.match(/<\/ul>/g)?.length).toBe(3);
    // a wraps b wraps c
    expect(html).toMatch(/<li>a<ul>/);
    expect(html).toMatch(/<li>b<ul>/);
  });

  it("renders mixed ordered/unordered nested lists", () => {
    const html = renderMarkdown("1. first\n   - sub a\n   - sub b\n2. second");
    // 外层 ol, 内层 ul
    expect(html).toContain("<ol>");
    expect(html).toContain("<ul>");
    // first <li> contains nested <ul>
    expect(html).toMatch(/<li>first<ul>/);
  });

  it("handles 4-space indent nested lists", () => {
    const html = renderMarkdown("- a\n    - b\n    - c\n- d");
    // 4-space indent should nest same as 2-space
    expect(html).toMatch(/<li>a<ul>/);
    expect(html).toContain("<li>d</li>");
    expect(html.match(/<ul>/g)?.length).toBe(2);
  });

  it("renders inline formatting inside nested list items", () => {
    const html = renderMarkdown("- **bold** parent\n  - `code` child\n  - *italic* child");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<em>italic</em>");
    // nested structure preserved
    expect(html).toMatch(/<li><strong>bold<\/strong> parent<ul>/);
  });

  it("renders flat list unchanged (no nesting = existing behavior)", () => {
    const html = renderMarkdown("- one\n- two\n- three");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("<li>three</li>");
    // 单个 <ul> 包裹所有 flat items
    expect(html.match(/<ul>/g)?.length).toBe(1);
  });

  // ═══ 列表前有引导文字 → <ol>/<ul> 不能卡在 <p> 内 ═══
  it("extracts <ol> from <p> when preceded by introductory text", () => {
    const html = renderMarkdown("以下是步骤：\n1. 第一步\n2. 第二步\n3. 第三步");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>第一步</li>");
    expect(html).toContain("<li>第二步</li>");
    expect(html).toContain("<li>第三步</li>");
    // 关键断言：<ol> 不能卡在 <p> 内
    expect(html).not.toMatch(/<p>[^<]*<ol>/);
  });

  it("extracts <ul> from <p> when preceded by introductory text", () => {
    const html = renderMarkdown("选项有：\n- 苹果\n- 香蕉");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>苹果</li>");
    expect(html).toContain("<li>香蕉</li>");
    expect(html).not.toMatch(/<p>[^<]*<ul>/);
  });

  // ═══ 带行内格式的列表项（**bold** 等）═══
  it("renders ordered list with **bold** inline formatting in items", () => {
    const html = renderMarkdown("1. **发现**：这是第一项\n2. **收集**：这是第二项\n3. **处理**：这是第三项");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li><strong>发现</strong>：这是第一项</li>");
    expect(html).toContain("<li><strong>收集</strong>：这是第二项</li>");
    expect(html).not.toMatch(/<p>[^<]*<ol>/);
  });

  it("renders unordered list with **bold** inline formatting in items", () => {
    const html = renderMarkdown("- **关键**：很重要\n- **次要**：一般般");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li><strong>关键</strong>：很重要</li>");
    expect(html).not.toMatch(/<p>[^<]*<ul>/);
  });

  // ═══ 完整场景：引导文字 + 带格式列表 ═══
  it("handles full scenario: intro text + ordered list with bold items", () => {
    const input = `这个处理过程可以拆分为四步：
1. **发现**：在回复的开头，我先明确用户请求中涉及的核心任务。
2. **收集**：接着我调用工具或读取文件来获取当前待处理的原始文案。
3. **处理**：基于引用的标准，我构建了一个包含核心步骤的解决链。
4. **验证**：我会用改写后的结果检查它是否满足原始要求。`;
    const html = renderMarkdown(input);
    expect(html).toContain("<ol>");
    expect(html).toContain("<strong>发现</strong>");
    expect(html).toContain("<strong>收集</strong>");
    expect(html).toContain("<strong>处理</strong>");
    expect(html).toContain("<strong>验证</strong>");
    // <ol> 不能卡在任何 <p> 内
    expect(html).not.toMatch(/<p>[^<]*<ol>/);
    // 引导文字应该在自己的 <p> 中
    expect(html).toContain("<p>这个处理过程可以拆分为四步：</p>");
    // <ol> 应该独立成块
    expect(html).toMatch(/<\/p><ol>/);
  });

  // ═══ 块级元素 sentinel 保护 — 列表正则不能打碎代码块 ═══
  it("does NOT corrupt code block content that looks like list items", () => {
    // Bug: <pre> 在列表处理前未受 sentinel 保护，代码块内 "1. code" 行
    // 被有序列表正则误匹配，导致 <pre> 内注入 <ol>/<li> 标签。
    const input = "```\n1. init\n2. build\n3. deploy\n```\n\nReal list:\n1. real item one\n2. real item two";
    const html = renderMarkdown(input);
    // 代码块必须保持完整
    const preMatch = html.match(/<pre[\s\S]*?<\/pre>/);
    expect(preMatch).not.toBeNull();
    expect(preMatch![0]).toContain("1. init");
    expect(preMatch![0]).toContain("2. build");
    expect(preMatch![0]).toContain("3. deploy");
    // 代码块内不能出现 <li> 或 <ol>
    expect(preMatch![0]).not.toContain("<li>");
    expect(preMatch![0]).not.toContain("<ol>");
    // 真正的列表正确渲染
    expect(html).toContain("<li>real item one</li>");
    expect(html).toContain("<li>real item two</li>");
  });

  it("does NOT corrupt code block when list-like content spans multiple lines", () => {
    // 代码块含多种模式：有序(1.) / 无序(-) / 中文格式(1、) — 全应保护
    const input = "```\n1. step one\n- bullet item\n2. step two\n```\n\n以上是示例代码。";
    const html = renderMarkdown(input);
    const preMatch = html.match(/<pre[\s\S]*?<\/pre>/);
    expect(preMatch).not.toBeNull();
    // 代码块内不应有任何列表标签
    expect(preMatch![0]).not.toContain("<li>");
    expect(preMatch![0]).not.toContain("<ol>");
    expect(preMatch![0]).not.toContain("<ul>");
    // 内容保持完整
    expect(preMatch![0]).toContain("1. step one");
    expect(preMatch![0]).toContain("- bullet item");
    expect(preMatch![0]).toContain("2. step two");
  });

  it("does NOT corrupt table cells containing number+dots", () => {
    // 表格内容在列表处理前也应受 sentinel 保护
    const input = "| Version | Status |\n| - | - |\n| 1.0 | stable |\n| 2.0 | beta |";
    const html = renderMarkdown(input);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1.0</td>");
    expect(html).not.toMatch(/<li>.*stable/);
  });

  it("does NOT corrupt blockquote lines containing number+dots", () => {
    // 引用块内容在列表处理前受 sentinel 保护
    const input = "> 1. First rule: be consistent\n> 2. Second rule: keep it simple";
    const html = renderMarkdown(input);
    expect(html).toContain("<blockquote");
    // 引用块内容不应被转成列表项
    expect(html).not.toContain("<li>First rule");
    expect(html).not.toContain("<li>Second rule");
  });

  // ═══ 同行多列表项分行 — AI 输出格式无约束 ═══
  it("splits same-line ordered list items (Chinese comma format)", () => {
    // Bug: "1、项目一 2、项目二 3、项目三" — 同行，正则只匹配行首第一个
    // 导致后续标记被吞入第一个 <li>，渲染为单一 item
    const html = renderMarkdown("1、项目一 2、项目二 3、项目三");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain("<li>项目二</li>");
    expect(html).toContain("<li>项目三</li>");
    const olCount = (html.match(/<ol>/g) || []).length;
    expect(olCount).toBe(1);
  });

  it("splits same-line ordered list items (standard dot format)", () => {
    const html = renderMarkdown("1. first 2. second 3. third");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("<li>third</li>");
  });

  it("splits same-line Chinese items WITHOUT spaces between them", () => {
    const html = renderMarkdown("1、项目一2、项目二3、项目三");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain("<li>项目二</li>");
    expect(html).toContain("<li>项目三</li>");
  });

  it("splits same-line items with intro text before the list", () => {
    const html = renderMarkdown("原因如下：1、项目一 2、项目二 3、项目三");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain("<li>项目二</li>");
    expect(html).toContain("<li>项目三</li>");
  });

  it("splits same-line unordered list items", () => {
    const html = renderMarkdown("- one * two - three");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("<li>three</li>");
  });

  it("does NOT split version numbers like 3.14 inside list items", () => {
    // 防御：版本号 "3.14" — \d+[.](?!\d) 不匹配（. 后是数字）
    const html = renderMarkdown("1. Download Python 3.12 first\n2. Install it");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>Download Python 3.12 first</li>");
    // 应只有 2 个 <li>，不应被版本号的 . 误 split
    expect((html.match(/<li>/g) || []).length).toBe(2);
  });

  it("does NOT split lines that do NOT start with a list marker", () => {
    // 同行含数字点号但行首不是列表标记 → 不应分行
    const html = renderMarkdown("Check version 1.0 and 2.0 for updates");
    expect(html).not.toContain("<ol>");
    expect(html).not.toContain("<li>");
  });

  it("handles bold text inside same-line split items", () => {
    const html = renderMarkdown("1. **发现**：描述 2. **收集**：描述 3. **处理**：描述");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li><strong>发现</strong>：描述</li>");
    expect(html).toContain("<li><strong>收集</strong>：描述</li>");
    expect(html).toContain("<li><strong>处理</strong>：描述</li>");
  });
});

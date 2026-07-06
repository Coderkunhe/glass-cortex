/**
 * 共享 Markdown→HTML 渲染引擎。
 *
 * Chat 页和 Learn 页共用同一套转换逻辑。Chat 消息通常短小（纯文本/
 * 粗体/行内代码/代码块/列表），Learn 内容更长（额外含脚注/表格/
 * 中文 blockquote 变体/Mermaid 图表）。
 *
 * 安全：输出经 DOMPurify 消毒，XSS 防御纵深。
 *
 * @module lib/renderMarkdown
 */

import DOMPurify from "dompurify";

/** 代码块语言名 → 显示名映射（小写 key → 首字母大写/专用名） */
const LANG_DISPLAY_NAMES: Record<string, string> = {
  javascript: "JavaScript", js: "JavaScript",
  typescript: "TypeScript", ts: "TypeScript",
  python: "Python", py: "Python",
  rust: "Rust", rs: "Rust",
  go: "Go", golang: "Go",
  java: "Java",
  cpp: "C++", "c++": "C++",
  c: "C",
  csharp: "C#", "c#": "C#",
  ruby: "Ruby", rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  r: "R",
  sql: "SQL",
  bash: "Bash", sh: "Shell", shell: "Shell",
  yaml: "YAML", yml: "YAML",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  xml: "XML",
  markdown: "Markdown", md: "Markdown",
  dockerfile: "Dockerfile", docker: "Docker",
  graphql: "GraphQL", gql: "GraphQL",
  toml: "TOML",
  ini: "INI",
  diff: "Diff",
  plaintext: "", // 空字符串 → 不渲染标签
};

/** 根据语言 slug 获取显示名（未映射的语言做首字母大写兜底） */
function getLangDisplay(lang: string): string {
  return LANG_DISPLAY_NAMES[lang] ?? (lang.charAt(0).toUpperCase() + lang.slice(1));
}

/**
 * DOMPurify 白名单配置，精确匹配 renderMarkdown 产出的 HTML 标签和属性。
 * 防御纵深：renderMarkdown 已做 HTML 转义和链接协议白名单，DOMPurify 作为
 * 第二层防线，拦截属性注入、事件处理器、mXSS 等绕过手段。
 */
export const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "pre", "code", "strong", "em", "a", "sup", "span",
    "table", "tr", "th", "td",
    "blockquote", "p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "hr",
    "div",
    "img", "video", "audio", "iframe", "source",
  ],
  ALLOWED_ATTR: [
    "class", "href", "target", "rel", "id",
    "data-chart", "data-title",
    "src", "alt", "loading", "controls", "preload",
    "allowfullscreen", "frameborder", "allow",
  ],
};

/**
 * 将简化 Markdown 转为 HTML。
 *
 * 支持语法：
 * - 纯文本段落（空行分隔）
 * - **粗体**、*斜体*、`行内代码`
 * - ```代码块```（带语言标注）
 * - ```mermaid``` 图表（base64 占位符，由调用方 hydration）
 * - # h1 ~ ###### h6 六级标题
 * - - 无序列表、1. 有序列表（支持嵌套缩进）
 * - [文字](url) 链接（协议白名单）
 * - --- 分隔线
 * - |表格|
 * - > blockquote（含六种中文标签变体：关键洞察/防护/注意/配置/笔记/总结）
 * - [^n] 脚注
 *
 * 输出经过 DOMPurify 消毒，确保 XSS 安全。
 */
export function renderMarkdown(md: string): string {
  // Guard: undefined/null/empty → empty string (handles malformed API responses)
  if (!md) return "";

  // ── Step -1: Normalize line endings — \r\n → \n (API may return CRLF) ──
  // 不归一化会导致代码块正则 /```(\w*)\n/ 在 CRLF 输入上失配，
  // 用户看到裸 ```html 标记。
  md = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // ── Step 0: Extract mermaid blocks before any HTML escaping ──
  const mermaidCharts: string[] = [];
  const mermaidTitles: (string | null)[] = [];
  let html = md.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_m, code) => {
    const idx = mermaidCharts.length;
    const trimmed = code.trim();
    const titleMatch = trimmed.match(/^%%\s*title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : null;
    mermaidCharts.push(trimmed);
    mermaidTitles.push(title);
    return `\x00MMD${idx}\x00`;
  });

  // ── Step 0b: Extract code blocks before escaping (fixes double-escaping) ──
  const codeBlocks: Array<{ lang: string; code: string }> = [];
  html = html.replace(/```(\w*)\s*\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "", code: code.trim() });
    return `\x00COD${idx}\x00`;
  });

  // ── Step 1: HTML entity escaping (sentinels are immune) ──
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // ── Step 2: Restore code blocks (escape content exactly once) ──
  html = html.replace(/\x00COD(\d+)\x00/g, (_m, idx) => {
    const block = codeBlocks[parseInt(idx, 10)];
    if (!block) return "";
    const escaped = block.code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // 归一化语言名：小写 + 空语言默认 plaintext（防御 AI 输出 HTML/Python 等大写变体）
    const lang = block.lang.toLowerCase() || "plaintext";
    // 语言可见标签（plaintext 不显示）
    const displayName = getLangDisplay(lang);
    const langLabel = displayName
      ? `<span class="gm-code-lang-label">${displayName}</span>`
      : "";
    return `<pre>${langLabel}<code class="language-${lang}">${escaped}</code></pre>`;
  });

  // 行内代码 `...`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 粗体 **...**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // 斜体 *...* (非贪婪，不跨行)
  html = html.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");

  // 图片 ![alt](url) — 必须在链接之前处理，复用协议白名单
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m: string, alt: string, url: string) => {
      const safe =
        url.startsWith("https://") ||
        url.startsWith("http://") ||
        url.startsWith("/") ||
        url.startsWith(".");
      if (!safe) return alt;
      return `<img src="${url}" alt="${alt}" loading="lazy" class="gm-md-img" />`;
    },
  );

  // 链接 [text](url) — 阻止 javascript:/data: 等危险协议
  // (?<!!) 防止匹配图片语法 ![alt](url)
  html = html.replace(
    /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g,
    (_m: string, text: string, url: string) => {
      const safe =
        url.startsWith("https://") ||
        url.startsWith("http://") ||
        url.startsWith("mailto:") ||
        url.startsWith("/") ||
        url.startsWith("#") ||
        url.startsWith(".");
      if (!safe) return text;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  );
  html = html.replace(
    /\[\^(\d+)\]:/g,
    '<sup id="fn$1-ref"><a href="#fn$1">[$1]</a></sup>'
  );
  html = html.replace(
    /\[\^(\d+)\]/g,
    '<sup id="fn$1-ref"><a href="#fn$1">[$1]</a></sup>'
  );

  // 表格
  html = html.replace(
    /((?:^\|.+\|$\n?)+)/gm,
    (tableBlock: string) => {
      const rows = tableBlock.trim().split("\n");
      if (rows.length < 2) return tableBlock;
      let tableHtml = "<table>";
      rows.forEach((row, i) => {
        const cells = row
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c: string) => c.trim());
        const tag = i === 1 && cells.every((c: string) => /^[-:]+$/.test(c)) ? "ignore" : i === 0 ? "th" : "td";
        if (tag === "ignore") return;
        tableHtml +=
          "<tr>" +
          cells.map((c: string) => `<${tag}>${c}</${tag}>`).join("") +
          "</tr>";
      });
      tableHtml += "</table>";
      return tableHtml;
    }
  );

  // Blockquote: > ... — detect bold label prefix for variant class
  const BQ_LABEL: Record<string, string> = {
    "关键洞察": "insight",
    "防护": "guard",
    "注意": "warning",
    "配置": "config",
    "笔记": "note",
    "总结": "summary",
  };
  html = html.replace(/^(?:&gt; .*(?:\n|$))+/gm, (block: string) => {
    const lines = block.trim().split("\n");
    let variant = "";
    const firstContent = lines[0].replace(/^&gt; /, "");
    const labelMatch = firstContent.match(/^<strong>(.+?)<\/strong>[:：]?\s*/);
    if (labelMatch && BQ_LABEL[labelMatch[1]]) {
      variant = ` answer-bq--${BQ_LABEL[labelMatch[1]]}`;
    }
    const content = lines
      .map((l) => l.replace(/^&gt; /, ""))
      .join("<br/>");
    return `<blockquote class="answer-bq${variant}"><p>${content}</p></blockquote>`;
  });

  // # ~ ###### 标题（全 6 级）
  html = html.replace(/^(#{1,6}) (.+)$/gm, (_m, hashes, text) => {
    const level = hashes.length;
    return `<h${level}>${text}</h${level}>`;
  });

  // ── 块级元素 sentinel 保护（列表处理前）──
  // 根因：列表正则 /^\d+[.、．)]/gm 对全量 HTML 做行级匹配，无法区分
  // <pre> 代码块内的 "1. code" 行与真正的列表项。将块级元素在列表
  // 处理前替换为 sentinel，避免代码块内容被列表正则打碎。
  // Phase 66 四度返工的列表渲染问题 — 此前每次只修正则边界条件，
  // 没有动管线架构（sentinel 保护时序错误是根本原因）。
  const preListBlocks: string[] = [];
  html = html.replace(/<(?:pre|table|blockquote)\b[\s\S]*?<\/(?:pre|table|blockquote)>/g, (match) => {
    const idx = preListBlocks.length;
    preListBlocks.push(match);
    return `\x00PLB${idx}\x00`;
  });

  // ── 同行多列表项分行（AI 输出格式不约束）──
  // 根因：AI 有时输出 "1、项目一  2、项目二  3、项目三"（同行），
  // /^\d+[.、．)]/gm 只匹配行首第一个 ^ 锚点，后续标记被吞入
  // 第一个 <li> 内容，渲染为"单一 item"异常。
  // 修复：逐行检测含 ≥2 个列表标记的行，在标记间边界处分行。
  // 防御：(?<!\d)...(?!\d) 排除 "3.14" 版本号。
  // 支持无空格中文格式（如 "1、项目一2、项目二"）。
  html = html.replace(/^.*$/gm, (line) => {
    const olMarkers = line.match(/(?<!\d)\d+[.、．)](?!\d)/g);
    if (olMarkers && olMarkers.length >= 2) {
      return line.replace(/(?<=\S)\s*(?=\d+[.、．)](?!\d))/g, "\n");
    }
    const ulMarkers = line.match(/(?<!\S)[-*•] \S/g);
    if (ulMarkers && ulMarkers.length >= 2) {
      return line.replace(/(?<=\S)\s*(?=[-*•] \S)/g, "\n");
    }
    return line;
  });

  // ── 嵌套列表（缩进感知，在 flat regex 之前处理）──
  // 匹配行首的可选空格 + (- 或 N.) + 内容。多行 /gm 无法跨行匹配块，
  // 因此先拆行检测连续列表块，只对含缩进（>0 leading spaces）的块用栈算法
  // 生成嵌套 HTML，并用 sentinel 保护；无缩进块留给下方 flat regex。
  const nestedListSentinels: string[] = [];
  // 支持标准 markdown (1. / - / *) + 中文格式 (1、/ 1) / 1． / •)
  // \s* 而非 \s+：中文顿号/全角句号后可能无空格
  const LIST_LINE_RE = /^(\s*)([-*•]|\d+[.、．)])\s*(.+)$/;
  const lines = html.split("\n");
  const out: string[] = [];
  for (let li = 0; li < lines.length; ) {
    if (!LIST_LINE_RE.test(lines[li])) {
      out.push(lines[li]);
      li++;
      continue;
    }
    // 收集连续列表行
    const block: string[] = [];
    while (li < lines.length && LIST_LINE_RE.test(lines[li])) {
      block.push(lines[li]);
      li++;
    }
    const hasNesting = block.some((l) => l.search(/\S/) > 0);
    if (!hasNesting) {
      out.push(...block); // 无嵌套，交给 flat regex
      continue;
    }
    // 栈式嵌套渲染
    const items = block.map((l) => {
      const indent = l.search(/\S/);
      const trimmed = l.trim();
      const ordered = /^\d+[.、．)]/.test(trimmed);
      const text = trimmed.replace(/^(\d+[.、．)]\s*|[-*•]\s+)/, "");
      return { indent, ordered, text };
    });
    const stack: { indent: number; tag: string }[] = [];
    let nestHtml = "";
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const tag = item.ordered ? "ol" : "ul";
      if (stack.length === 0) {
        nestHtml += `<${tag}><li>${item.text}`;
        stack.push({ indent: item.indent, tag });
      } else if (item.indent > stack[stack.length - 1].indent) {
        nestHtml += `<${tag}><li>${item.text}`;
        stack.push({ indent: item.indent, tag });
      } else if (item.indent === stack[stack.length - 1].indent) {
        nestHtml += `</li><li>${item.text}`;
      } else {
        while (stack.length > 0 && stack[stack.length - 1].indent > item.indent) {
          nestHtml += `</li></${stack.pop()!.tag}>`;
        }
        nestHtml += `</li><li>${item.text}`;
      }
    }
    while (stack.length > 0) {
      nestHtml += `</li></${stack.pop()!.tag}>`;
    }
    const sidx = nestedListSentinels.length;
    nestedListSentinels.push(nestHtml);
    out.push(`\x00LST${sidx}\x00`);
  }
  html = out.join("\n");

  // 有序列表 — 支持四种编号格式：1. (标准) / 1、 (中文顿号) / 1) (括号) / 1．(全角句号)
  // 标准 markdown 仅 `1. `，但 AI 常用中文格式输出编号列表。
  // \s* 而非空格：中文顿号/全角句号后通常不带空格（如 1、内容）。
  html = html.replace(/^\d+[.、．)]\s*(.+)$/gm, "<li>$1</li>");
  // 塌缩 </li> 之间的双换行 → 单换行，防止每个 item 被单独包装为 <ol>。
  // 根因：标准 markdown loose list 用 \n\n 分隔项，但分组正则只认 \n?。
  html = html.replace(/(<\/li>)\n\n+(?=\s*<li>)/g, "$1\n");
  // 将连续的 <li> 包装为 <ol>（用空行或块级标签作为边界）
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
    // 只对前面不是另一个 <li> 的连续块进行包装
    return `<ol>${match}</ol>`;
  });

  // 保护 <ol> 块 — 防止后续无序列表正则误匹配 ol 内的 <li>
  const olBlocks: string[] = [];
  html = html.replace(/<ol>[\s\S]*?<\/ol>/g, (match) => {
    const idx = olBlocks.length;
    olBlocks.push(match);
    return `\x00OL${idx}\x00`;
  });

  // 无序列表 — 支持三种标记：- / * / •（bullet）
  html = html.replace(/^[-*•] (.+)$/gm, "<li>$1</li>");
  // 塌缩双换行（与有序列表同理）
  html = html.replace(/(<\/li>)\n\n+(?=\s*<li>)/g, "$1\n");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // 还原 <ol> 块
  html = html.replace(/\x00OL(\d+)\x00/g, (_m, idx) => {
    return olBlocks[parseInt(idx, 10)] || "";
  });

  // 还原嵌套列表块（栈算法生成，sentinel 保护绕过 flat 处理）
  html = html.replace(/\x00LST(\d+)\x00/g, (_m, idx) => {
    return nestedListSentinels[parseInt(idx, 10)] || "";
  });

  // 还原列表前保护的块级元素（pre/table/blockquote）— 列表处理完成，安全还原
  html = html.replace(/\x00PLB(\d+)\x00/g, (_m, idx) => {
    return preListBlocks[parseInt(idx, 10)] || "";
  });

  // 分隔线
  html = html.replace(/^---$/gm, "<hr>");

  // 独立行媒体 URL → <video>/<audio>/<iframe>
  const VIDEO_EXT = /\.(mp4|webm|ogg|mov)(\?[^\s\n]*)?$/i;
  const AUDIO_EXT = /\.(mp3|wav|flac|aac|m4a)(\?[^\s\n]*)?$/i;
  html = html.replace(/^https?:\/\/\S+$/gim, (url: string) => {
    if (VIDEO_EXT.test(url)) {
      return `<video controls preload="metadata" src="${url}" class="gm-md-video"></video>`;
    }
    if (AUDIO_EXT.test(url)) {
      return `<audio controls preload="metadata" src="${url}" class="gm-md-audio"></audio>`;
    }
    // YouTube: /watch?v=ID 或 /youtu.be/ID
    const ytMatch =
      url.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/i) ||
      url.match(/^https?:\/\/youtu\.be\/([\w-]+)/i);
    if (ytMatch) {
      return `<iframe class="gm-md-embed" src="https://www.youtube.com/embed/${ytMatch[1]}" allowfullscreen frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    }
    // Vimeo: /vimeo.com/ID
    const vmMatch = url.match(/^https?:\/\/vimeo\.com\/(\d+)/i);
    if (vmMatch) {
      return `<iframe class="gm-md-embed" src="https://player.vimeo.com/video/${vmMatch[1]}" allowfullscreen frameborder="0" allow="autoplay; fullscreen; picture-in-picture"></iframe>`;
    }
    return url; // 非媒体 URL，保持原样
  });

  // ── 段落换行前保护 <pre> 块（防止 \n\n+ 匹配代码块内部空行）──
  // 根因：代码块恢复后的内容含原始换行，段落正则 /\n\n+/g 会匹配到
  // 代码块内部的空行（如两个函数之间的空行），注入 </p><p> 导致
  // <pre> 被拆成 <pre><code>前半段</code><p><code>后半段</code></p></pre>
  const preBlocks: string[] = [];
  html = html.replace(/<pre[\s\S]*?<\/pre>/g, (match) => {
    const idx = preBlocks.length;
    preBlocks.push(match);
    return `\x00PRE${idx}\x00`;
  });

  // ── 段落换行前：确保块级元素前有双换行 ──
  // 根因：文本行与 <ol>/<ul>/<pre>/<table> 等块元素间若仅单 \n 分隔，
  // 段落包装器 /\n\n+/g 不会拆分，导致块元素卡在 <p> 内。
  // 现有清理正则 /<p>(<ol...)/ 只匹配块元素紧邻 <p> 后，不处理 <p>text\n<ol>。
  // 修复：在所有块级开放标签前补插入 \n\n，确保段落正确拆分。
  html = html.replace(/([^\n])\n(<(?:ol|ul|table|pre|hr|h[1-6]|blockquote|div)[> ])/g, "$1\n\n$2");
  // 反向：确保块级闭合标签后也有双换行（防止后续文本粘在块元素同一 <p> 内）
  html = html.replace(/(<\/(?:ol|ul|table|pre|blockquote|div)>)\n([^\n])/g, "$1\n\n$2");

  // 段落：连续的非空行
  html = html.replace(/\n\n+/g, "</p><p>");
  html = "<p>" + html + "</p>";

  // 清理空段落
  html = html.replace(/<p>\s*<\/p>/g, "");
  // 清理段落中的块级元素（将块级元素从 <p> 中提取出来）
  html = html.replace(/<p>(<(?:table|pre|ul|ol|hr|h[1-6]|blockquote|div)[^>]*>)/g, "$1");
  html = html.replace(/(<\/(?:table|pre|ul|ol|hr|h[1-6]|blockquote|div)>)\s*<\/p>/g, "$1");

  // ── 还原 <pre> 块 ──
  html = html.replace(/\x00PRE(\d+)\x00/g, (_m, idx) => {
    return preBlocks[parseInt(idx, 10)] || "";
  });
  // 还原后的 <pre> 仍在 <p> 中，需再次提取
  html = html.replace(/<p>(<pre[^>]*>)/g, "$1");
  html = html.replace(/(<\/pre>)\s*<\/p>/g, "$1");
  // 修复：<pre> 前有文本内容时（char ≠ >），闭合前面的 <p>
  // 根因：代码块 sentinel 恢复后，若前有文本（如 "Here is code:\n<pre>..."），
  // <pre> 不紧邻 <p>，上述两个正则失配，导致 <pre> 留在 <p> 内产生布局异常
  html = html.replace(/([^>])(<pre)/g, "$1</p>$2");

  // ── Final: Replace mermaid sentinels with base64-encoded placeholders ──
  html = html.replace(/\x00MMD(\d+)\x00/g, (_m, idx) => {
    const i = parseInt(idx, 10);
    const chart = mermaidCharts[i];
    if (!chart) return "";
    const base64 = btoa(encodeURIComponent(chart));
    const titleAttr = mermaidTitles[i]
      ? ` data-title="${mermaidTitles[i]!.replace(/"/g, "&quot;")}"`
      : "";
    return `<div class="gm-mermaid-block" data-chart="${base64}"${titleAttr}></div>`;
  });

  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

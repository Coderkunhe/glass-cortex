/**
 * printPdf — 浏览器原生打印→PDF 工具。
 *
 * 将已渲染的 HTML 内容在新窗口中打开并触发浏览器打印功能。
 * 用户可通过系统打印对话框的"存储为 PDF"选项保存文件。
 * 零外部依赖，利用浏览器内置 PDF 引擎，像素级还原 markdown 渲染效果。
 *
 * @module lib/printPdf
 */

/** PDF 打印窗口基础样式（内联注入） */
const PRINT_CSS = `
  *, *::before, *::after {
    box-sizing: border-box;
  }
  :root {
    --font-geist-sans: system-ui, -apple-system, sans-serif;
    --font-geist-mono: ui-monospace, 'SF Mono', monospace;
  }
  html {
    font-size: 16px;
    -webkit-text-size-adjust: 100%;
  }
  body {
    font-family: var(--font-geist-sans);
    font-size: 1rem;
    line-height: 1.75;
    color: #1a1a2e;
    background: #ffffff;
    max-width: 210mm;
    margin: 0 auto;
    padding: 15mm 20mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Typography ── */
  h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5em 0 0.5em; color: #111; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.25em; }
  h2 { font-size: 1.4rem; font-weight: 600; margin: 1.25em 0 0.5em; color: #1f2937; }
  h3 { font-size: 1.15rem; font-weight: 600; margin: 1em 0 0.5em; color: #374151; }
  h4, h5, h6 { font-size: 1rem; font-weight: 600; margin: 0.75em 0 0.5em; }
  p { margin: 0.75em 0; }
  a { color: #2563eb; text-decoration: underline; }
  strong { font-weight: 600; }
  em { font-style: italic; }

  /* ── Code ── */
  code {
    font-family: var(--font-geist-mono);
    font-size: 0.875em;
    background: #f3f4f6;
    padding: 0.125em 0.375em;
    border-radius: 3px;
    color: #1f2937;
  }
  pre {
    background: #f9fafb !important;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 0.75em 1em;
    overflow-x: auto;
    margin: 1em 0;
    position: relative;
  }
  pre code {
    background: none;
    padding: 0;
    font-size: 0.8125rem;
    line-height: 1.6;
  }
  .gm-code-lang-label {
    display: block;
    font-family: var(--font-geist-mono);
    font-size: 0.6875rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25em;
  }

  /* ── Blockquote ── */
  blockquote {
    margin: 1em 0;
    padding: 0.5em 1em;
    border-left: 3px solid #d1d5db;
    background: #f9fafb;
    color: #374151;
  }
  blockquote p { margin: 0; }

  /* ── Tables ── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    font-size: 0.9375rem;
  }
  th, td {
    border: 1px solid #d1d5db;
    padding: 0.5em 0.75em;
    text-align: left;
  }
  th {
    background: #f3f4f6;
    font-weight: 600;
  }

  /* ── Lists ── */
  ul, ol { margin: 0.75em 0; padding-left: 1.5em; }
  li { margin: 0.25em 0; }

  /* ── Horizontal rule ── */
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }

  /* ── Images ── */
  img { max-width: 100%; height: auto; }

  /* ── Mermaid blocks (print as-is) ── */
  .gm-mermaid-block {
    margin: 1em 0;
    padding: 1em;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    text-align: center;
    page-break-inside: avoid;
  }
  .gm-mermaid-block svg {
    max-width: 100%;
    height: auto;
  }

  /* ── Page breaks ── */
  h1, h2, h3 { page-break-after: avoid; }
  pre, table, blockquote, .gm-mermaid-block { page-break-inside: avoid; }

  /* ── Print-specific ── */
  @media print {
    body {
      padding: 0;
      max-width: none;
    }
    @page {
      margin: 15mm 20mm;
    }
  }

  /* ── Search highlights — hide in print ── */
  .gm-search-mark {
    background: none !important;
    color: inherit !important;
  }
`;

/**
 * 将 HTML 内容作为 PDF 打印（打开系统打印对话框）。
 *
 * 打开一个新窗口，渲染 HTML 内容并注入打印样式，
 * 等待内容就绪后自动触发 window.print()。
 * 打印/取消后自动关闭窗口并 resolve。
 *
 * @param htmlContent - 已渲染的 HTML 内容（如 renderMarkdown 的输出）
 * @param title - 文档标题（显示在浏览器标题栏和 PDF 元数据中）
 * @returns Promise，打印对话框关闭后 resolve
 */
export function printPdf(htmlContent: string, title: string): Promise<void> {
  return new Promise((resolve) => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      // 弹窗被拦截 — 静默 resolve，打印按钮不报错
      resolve();
      return;
    }

    const doc = w.document;
    doc.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
${htmlContent}
</body>
</html>`);
    doc.close();

    // 等待图片/iframe 加载后触发打印
    w.addEventListener("load", () => {
      // 给 mermaid SVG 一个渲染帧的时间
      setTimeout(() => {
        w.print();
        // 监听打印完成/取消事件（主流浏览器均支持）
        w.addEventListener("afterprint", () => {
          w.close();
          resolve();
        }, { once: true });
      }, 300);
    });
  });
}

/** 基础 HTML 转义（防止 XSS） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

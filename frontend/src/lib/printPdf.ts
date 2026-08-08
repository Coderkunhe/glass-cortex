/**
 * downloadPdf — Markdown 文档直接 PDF 下载工具。
 *
 * 使用 html2canvas（DOM → canvas）+ jspdf（canvas → PDF 分页 → 下载），
 * 点击按钮即触发浏览器下载 .pdf 文件，无需弹出打印对话框。
 * 两个库均通过动态 import 按需加载，不影响首屏 bundle 体积。
 *
 * @module lib/printPdf
 */

/** PDF 渲染容器样式（白底黑字 A4 宽度） */
const CONTAINER_STYLE = `
  <style>
    .gm-pdf-root {
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 14px; line-height: 1.75;
      color: #1a1a2e; background: #ffffff;
      padding: 24px 32px; width: 754px;
    }
    .gm-pdf-root h1 { font-size: 1.75em; font-weight: 700; margin: 1.2em 0 0.4em; color: #111; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.2em; }
    .gm-pdf-root h2 { font-size: 1.4em; font-weight: 600; margin: 1em 0 0.4em; color: #1f2937; }
    .gm-pdf-root h3 { font-size: 1.15em; font-weight: 600; margin: 0.8em 0 0.3em; color: #374151; }
    .gm-pdf-root h4,.gm-pdf-root h5,.gm-pdf-root h6 { font-size: 1em; font-weight: 600; margin: 0.6em 0 0.3em; }
    .gm-pdf-root p { margin: 0.6em 0; }
    .gm-pdf-root a { color: #2563eb; text-decoration: underline; }
    .gm-pdf-root strong { font-weight: 600; }
    .gm-pdf-root em { font-style: italic; }
    .gm-pdf-root code { font-family: ui-monospace,"SF Mono",monospace; font-size: 0.875em; background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; color: #1f2937; }
    .gm-pdf-root pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.6em 0.8em; overflow-x: auto; margin: 0.8em 0; }
    .gm-pdf-root pre code { background: none; padding: 0; font-size: 0.8125em; line-height: 1.6; }
    .gm-pdf-root blockquote { margin: 0.8em 0; padding: 0.4em 0.8em; border-left: 3px solid #d1d5db; background: #f9fafb; color: #374151; }
    .gm-pdf-root blockquote p { margin: 0; }
    .gm-pdf-root table { width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 0.9375em; }
    .gm-pdf-root th,.gm-pdf-root td { border: 1px solid #d1d5db; padding: 0.4em 0.6em; text-align: left; }
    .gm-pdf-root th { background: #f3f4f6; font-weight: 600; }
    .gm-pdf-root ul,.gm-pdf-root ol { margin: 0.6em 0; padding-left: 1.5em; }
    .gm-pdf-root li { margin: 0.2em 0; }
    .gm-pdf-root hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.2em 0; }
    .gm-pdf-root img { max-width: 100%; height: auto; }
    .gm-pdf-root .gm-mermaid-block { margin: 0.8em 0; padding: 0.8em; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center; }
    .gm-pdf-root .gm-mermaid-block svg { max-width: 100%; height: auto; }
    .gm-pdf-root .gm-code-lang-label { display: block; font-family: ui-monospace,monospace; font-size: 0.6875em; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.2em; }
    .gm-pdf-root .gm-search-mark { background: none !important; color: inherit !important; }
    .gm-pdf-root .prose { font-size: inherit; }
  </style>
`;

/** A4 纵向 in pt (72dpi) */
const A4_W = 595.28;
const A4_H = 841.89;

/**
 * 将 HTML 内容渲染为 PDF 并触发浏览器下载。
 *
 * 创建隐藏 DOM 容器 → html2canvas 截图 → 跨 A4 页面分割 → jspdf 合成 → 下载。
 * 点击即下载，零用户额外操作。
 *
 * @param htmlContent - 已渲染的 HTML 内容（renderMarkdown 输出）
 * @param title - 文档标题，用于 PDF 文件名
 */
export async function downloadPdf(
  htmlContent: string,
  title: string,
): Promise<void> {
  // 1. 创建隐藏容器
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-9999px;top:0;z-index:-1;";
  container.innerHTML = `${CONTAINER_STYLE}<div class="gm-pdf-root">${htmlContent}</div>`;
  document.body.appendChild(container);

  try {
    // 2. 动态导入 html2canvas + jspdf（首屏 0 体积增量）
    const [html2canvasMod, jsPDFMod] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const html2canvas = html2canvasMod.default;
    const { jsPDF } = jsPDFMod;

    // 3. DOM → canvas
    const canvas = await html2canvas(
      container.querySelector(".gm-pdf-root")!,
      {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      },
    );

    // 4. canvas → 分页 PDF
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "pt", "a4");

    const pageW = A4_W;
    const pageH = A4_H;
    // canvas 尺寸按 scale 缩放：html2canvas scale=2 → canvas 像素是 CSS px 的 2 倍
    // jspdf addImage 默认按图片像素 1:1 映射到 pt，所以需要缩小
    const scaleRatio = pageW / canvas.width;
    const imgH = canvas.height * scaleRatio;

    let remaining = imgH;
    let pos = 0;

    pdf.addImage(imgData, "PNG", 0, pos, pageW, imgH);
    remaining -= pageH;

    while (remaining > 0) {
      pos -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, pos, pageW, imgH);
      remaining -= pageH;
    }

    // 5. 触发下载
    const filename = title.replace(/\.md$/, "");
    pdf.save(`${filename}.pdf`);
  } catch (err) {
    console.error("[downloadPdf] PDF 生成失败", err);
  } finally {
    // 6. 清理 DOM
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

// ── 向后兼容别名 ──
export { downloadPdf as printPdf };

"use client";

import { useEffect, useState, useId } from "react";
import mermaid from "mermaid";
import ErrorDisplay from "@/components/ui/ErrorDisplay";
import ImageViewer from "@/components/ui/ImageViewer";

// ── Emoji stripping ──

/**
 * Regex matching Emoji_Presentation characters + misc symbol ranges + variation
 * selectors + ZWJ, optionally followed by space.  Catches ~90% of emoji glyphs.
 */
const EMOJI_PRESENTATION_RE =
  /[\p{Emoji_Presentation}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}]+\s*/gu;

/**
 * Regex matching ANY Emoji-property character (including text-default emoji
 * like U+1F5D1 🗑, U+1F324 🌤, U+1F321 🌡).  Used as a second pass whose
 * replacer KEEPS the match when it is an ASCII-range character — #, *, 0-9,
 * ©, ®, ™ all have the Emoji property but are Mermaid syntax, not glyphs.
 */
const EMOJI_ANY_RE = /[\p{Emoji}][\u{FE0F}]?\s*/gu;

/** Strip emoji glyphs from a Mermaid chart definition, preserving ASCII syntax. */
function stripEmoji(chart: string): string {
  // Pass 1 — Emoji_Presentation + known symbol ranges (most emoji)
  chart = chart.replace(EMOJI_PRESENTATION_RE, "");
  // Pass 2 — remaining Emoji-property chars (text-default emoji);
  //          keep if ASCII (#, *, 0-9, ©, ®, ™ are Emoji but not glyphs)
  chart = chart.replace(EMOJI_ANY_RE, (match) => {
    if ((match.codePointAt(0) ?? 0) < 128) return match; // ASCII → keep
    return ""; // non-ASCII emoji → strip
  });
  return chart.replace(/  +/g, " ").trim();
}

/** MermaidDiagram 组件 props */
interface MermaidDiagramProps {
  /** 原始 Mermaid 图定义字符串（如 "graph LR\\nA-->B"） */
  chart: string;
  /** 标题，用作 aria-label 和图上方标题 */
  title: string;
  /** 可选描述，显示在图下方 */
  description?: string;
  /** 高度限制（px，默认 400），溢出滚动 */
  maxHeight?: number;
  /** 外层容器额外 class */
  className?: string;
}

/**
 * Mermaid 流程图渲染组件。
 *
 * 使用 npm 安装的 mermaid 库在客户端渲染 SVG 流程图。
 * 由父组件通过 next/dynamic 懒加载（ssr: false），不阻塞首屏。
 *
 * 监听 document.documentElement 的 data-theme 属性变化，
 * 自动切换 Mermaid 的 default / dark 主题。
 *
 * 渲染失败时展示原始 chart 字符串（debuggable），不抛错。
 */
export default function MermaidDiagram({
  chart,
  title,
  description,
  maxHeight = 0,
  className,
}: MermaidDiagramProps) {
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<unknown>(null);
  const [initializing, setInitializing] = useState(true);

  // Stable unique ID for mermaid.render target
  const reactId = useId();
  const mermaidId = `gm-md-${reactId.replace(/[^a-zA-Z0-9-]/g, "")}`;

  // Track dark theme via data-theme attribute
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark";
  const [isDarkTheme, setIsDarkTheme] = useState(isDark);

  // ── Lightbox state ──
  const [isLightboxOpen, setLightboxOpen] = useState(false);

  // Phase 66 B102 — 即时 tooltip 替代原生 title "点击查看大图" (C10)
  const [zoomTooltip, setZoomTooltip] = useState<{ x: number; y: number } | null>(null);

  // ── Theme MutationObserver ──
  useEffect(() => {
    const htmlEl = document.documentElement;
    const observer = new MutationObserver(() => {
      const dark = htmlEl.getAttribute("data-theme") === "dark";
      setIsDarkTheme(dark);
    });
    observer.observe(htmlEl, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // ── Mermaid render ──
  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        setInitializing(true);
        setRenderError(null);

        const isDark = isDarkTheme;
        const theme = isDark ? "dark" : "neutral";
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "strict",
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
          },
          ...(isDark && {
            themeVariables: {
              lineColor: "#64748b",
              textColor: "#e2e8f0",
              mainBkg: "#1e293b",
              nodeBorder: "#475569",
            },
          }),
        });

        const cleanChart = stripEmoji(chart);
        const { svg } = await mermaid.render(mermaidId, cleanChart);

        if (!cancelled) {
          setSvgHtml(svg);
          setInitializing(false);
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err);
          setSvgHtml(null);
          setInitializing(false);
        }
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [chart, isDarkTheme, mermaidId]);

  // ── Error state ──
  if (renderError) {
    return (
      <div className={className}>
        <style>{`
          .gm-mermaid-error {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--gm-space-2, 8px);
            padding: var(--gm-space-4, 16px);
            color: var(--gm-text-muted);
            background: var(--gm-surface-alt);
            border-radius: var(--gm-radius-sm, 4px);
            border: 1px solid var(--gm-border);
            font-size: 0.8125rem;
          }
          .gm-mermaid-error details {
            margin-top: var(--gm-space-2, 8px);
            width: 100%;
          }
          .gm-mermaid-error summary {
            cursor: pointer;
            color: var(--gm-text-secondary);
            font-size: 0.75rem;
          }
          .gm-mermaid-error pre {
            margin-top: var(--gm-space-1, 4px);
            padding: var(--gm-space-2, 8px);
            background: var(--gm-bg-deep, var(--gm-bg));
            border-radius: var(--gm-radius-xs, 2px);
            font-family: var(--font-mono, monospace);
            font-size: 0.65rem;
            overflow-x: auto;
            white-space: pre-wrap;
            color: var(--gm-text);
          }
        `}</style>
        <div className="gm-mermaid-error">
          <ErrorDisplay
            variant="card"
            error={renderError}
            heading={`流程图渲染失败：${title}`}
          />
        </div>
      </div>
    );
  }

  // ── Loading / rendering state ──
  if (initializing || !svgHtml) {
    return (
      <div className={className}>
        <style>{`
          .gm-mermaid-skeleton {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: var(--gm-space-2, 8px);
            min-height: 120px;
            background: var(--gm-surface-alt);
            border-radius: var(--gm-radius-sm, 4px);
            border: 1px solid var(--gm-border);
            animation: gm-md-pulse var(--gm-duration-hero) ease-in-out infinite;
          }
          @keyframes gm-md-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.7; }
          }
        `}</style>
        <div className="gm-mermaid-skeleton">
          <span
            className="text-gm-xs"
            style={{ color: "var(--gm-text-muted)" }}
          >
            正在渲染流程图...
          </span>
        </div>
      </div>
    );
  }

  // ── Success state ──
  return (
    <div className={className}>
      <style>{`
        .gm-mermaid-wrap {
          width: 100%;
          overflow: hidden;
          border-radius: var(--gm-radius-sm, 4px);
          background: var(--gm-surface-elevated);
          border: 1px solid var(--gm-border);
          padding: var(--gm-space-3, 12px);
        }
        /* 仅当 maxHeight 显式设置且内容溢出时才启用纵向滚动 */
        .gm-mermaid-wrap--scrollable {
          overflow-y: auto;
        }
        .gm-mermaid-wrap svg {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 0 auto;
        }
        /* 块大小统一 — 限制节点标签宽度，避免长文本节挤压短文本节 */
        .gm-mermaid-wrap svg .nodeLabel {
          max-width: 220px;
        }
        /* 暗色模式 — 流程图容器与 GM 设计 token 对齐 */
        [data-theme="dark"] .gm-mermaid-wrap {
          background: var(--gm-surface-elevated);
          border-color: var(--gm-border);
        }
        .gm-mermaid-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--gm-text);
          margin-top: var(--gm-space-2, 8px);
          text-align: center;
        }
        .gm-mermaid-desc {
          font-size: 0.75rem;
          color: var(--gm-text-muted);
          margin-top: var(--gm-space-2, 8px);
          line-height: 1.5;
          text-align: center;
        }
      `}</style>

      {/* SVG container — 仅在 maxHeight 显式设置时启用滚动容器。
          点击可打开 lightbox 查看大图 */}
      <div
        className={`gm-mermaid-wrap${maxHeight > 0 ? " gm-mermaid-wrap--scrollable" : ""}`}
        style={{
          ...(maxHeight > 0 ? { maxHeight: `${maxHeight}px` } : undefined),
          cursor: "zoom-in",
        }}
        aria-label={title}
        role="img"
        tabIndex={0}
        onMouseEnter={(e) => setZoomTooltip({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setZoomTooltip((prev) => (prev ? { x: e.clientX, y: e.clientY } : null))}
        onMouseLeave={() => setZoomTooltip(null)}
        onClick={() => setLightboxOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setLightboxOpen(true);
          }
        }}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />

      {/* Title — 图下方居中 */}
      <div className="gm-mermaid-title">{title}</div>

      {/* Description */}
      {description && (
        <div className="gm-mermaid-desc">{description}</div>
      )}

      {/* Lightbox — 仅在打开且有 SVG 内容时挂载，关闭时卸载以重置 zoom 状态 */}
      {isLightboxOpen && svgHtml && (
        <ImageViewer
          svgHtml={svgHtml}
          alt={title}
          isOpen={true}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* Phase 66 B102 — 即时 tooltip 替代原生 title "点击查看大图" (C10) */}
      {zoomTooltip && (
        <div
          className="fixed z-50 rounded-gm-sm border border-border-strong
                     bg-surface-elevated px-gm-2.5 py-gm-1.5
                     shadow-gm-md pointer-events-none"
          style={{ left: zoomTooltip.x + 12, top: zoomTooltip.y - 8 }}
        >
          <p className="text-gm-xs text-text whitespace-nowrap">点击查看大图</p>
        </div>
      )}
    </div>
  );
}

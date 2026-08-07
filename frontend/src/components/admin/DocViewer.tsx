"use client";

/**
 * DocViewer — 文档阅读器（含 TOC 侧栏导航 + Mermaid 水合）。
 *
 * 从 AdminShell 拆出为独立组件。
 * 功能：Markdown 渲染 → 代码高亮 → Mermaid 图表水合 → TOC 目录提取及
 * IntersectionObserver 激活追踪。
 *
 * 布局：h-full flex flex-col 承接 AdminShell main 的 overflow-hidden 高度链。
 * TOC 侧栏与正文各自 overflow-y-auto 独立滚动，互不干扰。
 *
 * @module components/admin/DocViewer
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { RiArrowLeftLine, RiFontSize } from "@remixicon/react";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import { useCodeHighlight } from "@/hooks/useCodeHighlight";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { DOC_FONT_SIZE_KEY } from "@/lib/constants";
import { fmtBytes } from "./utils";
import type { DocListItem, DocContentResponse } from "@/lib/api/types";

// ── 类型 ──────────────────────────────────────────────────────────────

/** 目录条目 */
interface TocHeading {
  id: string;
  text: string;
  level: number; // 1-3
}

// ── Props ─────────────────────────────────────────────────────────────

interface DocViewerProps {
  item: DocListItem;
  content: DocContentResponse | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
}

export default function DocViewer({
  item,
  content,
  loading,
  error,
  onBack,
}: DocViewerProps) {
  const docBodyRef = useRef<HTMLDivElement>(null);
  const mermaidRootsRef = useRef<Map<HTMLElement, ReturnType<typeof createRoot>>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  useCodeHighlight(docBodyRef, [content]);

  // ── 字号偏好 — 持久化到 localStorage，直接控制 prose 容器 font-size ──
  //     绕过 Tailwind v4 JIT 类名扫描问题：inline style 的 font-size 直接
  //     覆盖 prose 基值，不依赖 Tailwind 是否生成了 prose-sm/base/lg/xl。
  const [fontSize, setFontSize] = useLocalStorage<string>(
    DOC_FONT_SIZE_KEY,
    "md",
  );

  /** 字号 → rem 值静态映射（直接用于 inline style，不依赖 Tailwind 类名生成） */
  const FONT_SIZE_MAP: Record<string, string> = {
    sm: "0.875rem", // 14px — 等效 prose-sm
    md: "1rem", // 16px — 等效 prose-base
    lg: "1.125rem", // 18px — 等效 prose-lg
    xl: "1.25rem", // 20px — 等效 prose-xl
  };

  // ── TOC state ──
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // ── Hydrate mermaid blocks injected by renderMarkdown ──
  useEffect(() => {
    if (!docBodyRef.current) return;
    const containers = docBodyRef.current.querySelectorAll<HTMLDivElement>(
      ".gm-mermaid-block[data-chart]",
    );
    if (containers.length === 0) return;

    containers.forEach((container) => {
      const base64 = container.getAttribute("data-chart");
      const title = container.getAttribute("data-title") || "流程图";
      if (!base64) return; // 防御：data-chart 选择器已过滤，此行为安全网
      try {
        const chart = decodeURIComponent(atob(base64));
        let root = mermaidRootsRef.current.get(container);
        if (!root) {
          root = createRoot(container);
          mermaidRootsRef.current.set(container, root);
        }
        root.render(
          <MermaidDiagram chart={chart} title={title} maxHeight={0} />,
        );
        container.setAttribute("data-mermaid-hydrated", "true");
      } catch (err) {
        console.error("[mermaid-hydrate] DocViewer: 水合失败", { title, error: err });
        container.innerHTML =
          '<p class="text-gm-sm text-error">流程图加载失败</p>';
        mermaidRootsRef.current.delete(container);
      }
    });
    // Strict Mode: re-run reuses existing roots via ref (root.render() update),
    // avoids createRoot() error on already-rooted containers.

    const rootsMap = mermaidRootsRef.current;
    return () => {
      // 清理所有 mermaid root（组件卸载时 / content 切换时）
      rootsMap.forEach((root) => root.unmount());
      rootsMap.clear();
    };
  }, [content]);

  // ── TOC: 提取标题 + IntersectionObserver 激活追踪 ──
  useEffect(() => {
    if (!docBodyRef.current || !content) return;

    // 提取 h1/h2/h3 标题 — 重复 ID 去重在推入 TOC 前完成，
    // 确保 React state、DOM、activeId 匹配、scrollToHeading 全部使用
    // 去重后的唯一 ID。去重用元素引用 el.id = newId 直接改名，不依赖
    // querySelector（它总返回第一个匹配，会改错元素）。
    const headingEls = docBodyRef.current.querySelectorAll("h1, h2, h3");
    const toc: TocHeading[] = [];
    const seen = new Map<string, number>();
    headingEls.forEach((el) => {
      const id = el.getAttribute("id");
      const text = el.textContent || "";
      const level = parseInt(el.tagName.charAt(1), 10);
      if (!id || !text) return;
      const count = seen.get(id) ?? 0;
      if (count > 0) {
        const newId = `${id}-${count + 1}`;
        el.id = newId;
        toc.push({ id: newId, text, level });
      } else {
        toc.push({ id, text, level });
      }
      seen.set(id, count + 1);
    });
    setHeadings(toc);

    // IntersectionObserver: 激活当前可见标题（root = 正文滚动容器）
    if (observerRef.current) observerRef.current.disconnect();

    const scrollContainer = docBodyRef.current?.parentElement;
    const observer = new IntersectionObserver(
      (entries) => {
        // 找第一个进入视口的标题
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.getAttribute("id"));
        }
      },
      { root: scrollContainer ?? null, rootMargin: "0px 0px -75% 0px", threshold: 0 },
    );

    headingEls.forEach((el) => observer.observe(el));
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [content]);

  // ── TOC 点击 → 平滑滚动到标题 ──
  const scrollToHeading = useCallback((id: string) => {
    const el = docBodyRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  }, []);

  const hasToc = headings.length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
      {/* 文档头部 */}
      <div className="flex items-center gap-gm-3 px-gm-5 py-gm-3 border-b border-border bg-surface-lowered/50">
        <button
          onClick={onBack}
          className="rounded-gm-sm p-gm-1 text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
          aria-label="返回文档列表"
        >
          <RiArrowLeftLine className="text-gm-icon" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-gm-sm font-semibold text-text truncate">{item.name}</h2>
          <p className="text-gm-xs text-text-muted">
            {item.path} · {item.lines} 行 · {fmtBytes(item.size_bytes)}
          </p>
        </div>
        {/* 字号调节 */}
        <button
          onClick={() =>
            setFontSize((prev) =>
              prev === "sm" ? "md" : prev === "md" ? "lg" : prev === "lg" ? "xl" : "sm",
            )
          }
          className="rounded-gm-sm p-gm-1 text-text-muted hover:text-text hover:bg-surface-alt transition-colors shrink-0"
          aria-label={`字号：${fontSize === "sm" ? "小" : fontSize === "lg" ? "大" : fontSize === "xl" ? "特大" : "中"}`}
          title={`字号：${fontSize === "sm" ? "小" : fontSize === "lg" ? "大" : fontSize === "xl" ? "特大" : "中"}`}
        >
          <RiFontSize className="text-gm-icon" />
        </button>
      </div>

      {/* 文档内容区（TOC 侧栏 + 正文）— 各自独立滚动 */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* TOC 侧栏 */}
        {hasToc && !loading && !error && (
          <aside className="w-[var(--spacing-sidebar-w)] shrink-0 border-r border-border bg-surface-lowered/30 overflow-y-auto">
            <div className="p-gm-3">
              <p className="text-gm-xs font-semibold text-text-muted mb-gm-2 px-gm-1 sticky top-0 bg-surface-lowered/30 backdrop-blur py-gm-1 -mx-gm-1 px-gm-2 z-10">
                目录
              </p>
              <nav>
                <ul className="space-y-gm-0.5">
                  {headings.map((h) => {
                    const isActive = activeId === h.id;
                    const indent = h.level === 1 ? "pl-gm-2" : h.level === 2 ? "pl-gm-5" : "pl-gm-8";
                    return (
                      <li key={h.id}>
                        <button
                          onClick={() => scrollToHeading(h.id)}
                          className={`w-full text-left text-gm-sm py-gm-1 pr-gm-1 rounded-gm-xs transition-colors border-l-2 ${indent} ${
                            isActive
                              ? "border-primary text-primary bg-primary/8 font-medium"
                              : "border-transparent text-text-muted hover:text-text hover:bg-surface-alt/50"
                          }`}
                          title={h.text}
                        >
                          <span className="line-clamp-2">{h.text}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </aside>
        )}

        {/* 文档正文 — 独立纵向滚动 */}
        <div className="flex-1 min-w-0 p-gm-5 overflow-y-auto">
          {loading && (
            <div className="max-w-3xl mx-auto space-y-gm-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-4 rounded-gm-sm gm-skeleton-shimmer"
                  style={{ width: `${65 + (i * 7) % 30}%` }}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="text-center py-gm-8">
              <p className="text-gm-sm text-red-500">文档加载失败</p>
              <p className="text-gm-xs text-text-muted mt-gm-1">{error}</p>
            </div>
          )}

          {content && (
            <div
              ref={docBodyRef}
              style={{ fontSize: FONT_SIZE_MAP[fontSize] }}
              className="prose max-w-3xl mx-auto font-serif"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content.content) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

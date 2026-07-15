"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useRouter } from "next/navigation";
import { RiArrowLeftLine, RiStarLine, RiStarFill, RiFlaskLine, RiLinkM, RiArrowRightUpLine, RiNodeTree } from "@remixicon/react";
import type { Answer } from "@/lib/content/types";
import { getAnswerById } from "@/lib/content/questions";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { useCodeHighlight } from "@/hooks/useCodeHighlight";
import { formatReadingTime } from "@/lib/content/estimateReadingTime";
import SelectionToolbar from "@/components/learn/SelectionToolbar";
import { formatChapterTitle } from "@/lib/formatChapter";

/** 跨章关联类型 → 中文标签映射 */
const CONNECTION_TYPE_LABELS: Record<string, string> = {
  prerequisite: "前置知识",
  extension: "深入扩展",
  parallel: "平行对照",
  application: "应用场景",
  contrast: "对比参考",
};

/** 跨章关联类型 → Remixicon 图标映射 */
const CONNECTION_TYPE_ICONS: Record<string, React.ReactNode> = {
  prerequisite: <RiNodeTree className="w-gm-icon-sm h-gm-icon-sm" />,
  extension: <RiArrowRightUpLine className="w-gm-icon-sm h-gm-icon-sm" />,
  parallel: <RiLinkM className="w-gm-icon-sm h-gm-icon-sm" />,
  application: <RiFlaskLine className="w-gm-icon-sm h-gm-icon-sm" />,
  contrast: <RiNodeTree className="w-gm-icon-sm h-gm-icon-sm" />,
};

export interface AnswerCardProps {
  /** 要渲染的答案 */
  answer: Answer;
  /** 移动端返回问题列表的回调（可选） */
  onBack?: () => void;
  /** 沉浸阅读模式（启用 WeRead 风格排版） */
  immersive?: boolean;
  /** 是否已收藏 */
  isBookmarked?: boolean;
  /** 收藏切换回调 */
  onToggleBookmark?: () => void;
  /** 搜索关键词 — 非空时在正文中高亮匹配文本并滚动定位 */
  searchQuery?: string;
  /** 预估阅读时间（分钟），由父组件计算传入 */
  estimatedReadingTime?: number;
  /** 笔记划词高亮文本列表 — 已存笔记的 selectedText */
  noteHighlights?: string[];
  /** 划词选中回调 — 用户选中正文文本并点击"记笔记"时触发 */
  onAddNote?: (selectedText: string) => void;
  questionIndex?: { index: number; total: number };
}

/** 不高亮文本的 HTML 标签（这些标签内的文本不搜索高亮） */
const SKIP_HIGHLIGHT_TAGS = new Set([
  "mark", "code", "pre", "script", "style", "noscript", "textarea", "input",
]);

/** 高亮结果：firstMark 为第一个匹配的 <mark> 元素，cleanup 用于移除所有高亮 */
interface HighlightState {
  firstMark: HTMLElement | null;
  cleanup: () => void;
}

/**
 * 在容器 DOM 内对关键词进行高亮。
 * 遍历所有文本节点，将匹配的文本用 `<mark class="${className}">` 包裹。
 * 返回第一个匹配元素（用于滚动定位）和清理函数。
 */
function highlightInContainer(
  container: HTMLElement,
  query: string,
  className = "search-highlight",
): HighlightState {
  const lowerQuery = query.toLowerCase();
  const replaced: Array<{ parent: Node; oldNode: Text; fragment: DocumentFragment }> = [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = (node as Text).parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      if (SKIP_HIGHLIGHT_TAGS.has(el.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
      if (!node.textContent?.toLowerCase().includes(lowerQuery)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const text = textNode.textContent || "";
    const fragment = buildHighlightFragment(text, query, className);
    replaced.push({ parent: textNode.parentNode!, oldNode: textNode, fragment });
  }

  // 先找第一个 mark，再做 DOM 替换
  let firstMark: HTMLElement | null = null;
  for (const { parent, oldNode, fragment } of replaced) {
    if (!firstMark) firstMark = fragment.querySelector("mark");
    parent.replaceChild(fragment, oldNode);
  }

  return {
    firstMark,
    cleanup() {
      const selectorClass = className.split(" ")[0];
      const marks = container.querySelectorAll(`mark.${selectorClass}`);
      marks.forEach((mark) => {
        const p = mark.parentNode;
        if (p) {
          p.replaceChild(document.createTextNode(mark.textContent || ""), mark);
          p.normalize(); // 合并相邻文本节点
        }
      });
    },
  };
}

/**
 * 将文本中的关键词用 `<mark>` 标签包裹，返回 DocumentFragment。
 * 大小写不敏感匹配，保留原文大小写显示。
 */
function buildHighlightFragment(
  text: string,
  query: string,
  className: string,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let cursor = 0;

  let idx = lowerText.indexOf(lowerQuery, cursor);
  while (idx !== -1) {
    // 匹配前的文本
    if (idx > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, idx)));
    }
    // 高亮匹配段
    const mark = document.createElement("mark");
    const baseStyle =
      "text-current rounded-gm-xs px-gm-0_5";
    mark.className = `${className} ${baseStyle}`;
    mark.textContent = text.slice(idx, idx + query.length);
    fragment.appendChild(mark);

    cursor = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, cursor);
  }

  // 剩余文本
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

/**
 * 答案卡片组件。
 * 按三层渐进披露渲染内容：L0 一句话结论突出展示，
 * L1 正文区，L2/L3 深度扩展默认折叠可展开。
 * 不展示内部元数据（优先级、置信度、管线代号）。
 */
export default function AnswerCard({
  answer,
  onBack,
  immersive,
  isBookmarked,
  onToggleBookmark,
  searchQuery,
  estimatedReadingTime,
  noteHighlights,
  onAddNote,
  questionIndex,
}: AnswerCardProps) {
  const router = useRouter();
  const isStub = answer.l0 === "";
  const articleRef = useRef<HTMLElement>(null);
  // 容器 → React Root 映射，避免重复 createRoot
  const rootsRef = useRef<Map<HTMLElement, ReturnType<typeof createRoot>>>(
    new Map(),
  );

  // ── Hydrate mermaid blocks injected by renderMarkdown ──
  useEffect(() => {
    if (!articleRef.current) return;
    const containers = articleRef.current.querySelectorAll<HTMLDivElement>(
      ".gm-mermaid-block",
    );
    if (containers.length === 0) return;

    const activeContainers = new Set<HTMLElement>();
    containers.forEach((container) => {
      activeContainers.add(container);
      const base64 = container.getAttribute("data-chart");
      const title = container.getAttribute("data-title") || "流程图";
      if (!base64) return;
      try {
        const chart = decodeURIComponent(atob(base64));
        let root = rootsRef.current.get(container);
        if (!root) {
          root = createRoot(container);
          rootsRef.current.set(container, root);
        }
        root.render(
          <MermaidDiagram chart={chart} title={title} maxHeight={0} />,
        );
      } catch {
        container.innerHTML =
          '<p class="text-gm-sm text-error">流程图加载失败</p>';
        rootsRef.current.delete(container);
      }
    });

    // 卸载已不在 DOM 中的容器对应的根（延迟到 commit 阶段结束后）
    rootsRef.current.forEach((root, c) => {
      if (!activeContainers.has(c)) {
        const r = root;
        queueMicrotask(() => r.unmount());
        rootsRef.current.delete(c);
      }
    });

    // 组件卸载时清理所有残留 root，防止 createRoot 泄漏
    const roots = rootsRef.current;
    return () => {
      roots.forEach((root) => {
        queueMicrotask(() => root.unmount());
      });
      roots.clear();
    };
  }, [answer.l1, answer.l2, answer.l3]);

  // ── Prism 语法高亮 + 行号 + 复制按钮 ──
  useCodeHighlight(articleRef, [answer.l1, answer.l2, answer.l3]);

  // ── 搜索关键词高亮 + 自动滚动 ──
  const highlightStateRef = useRef<{
    cleanup: () => void;
    firstMark: HTMLElement | null;
  } | null>(null);

  useEffect(() => {
    // 清理上一次的高亮标记
    highlightStateRef.current?.cleanup();
    highlightStateRef.current = null;

    const trimmed = searchQuery?.trim();
    if (!trimmed || !articleRef.current) return;

    const result = highlightInContainer(
      articleRef.current,
      trimmed,
      "search-highlight bg-search-highlight",
    );
    highlightStateRef.current = result;

    // 滚动到第一个匹配位置
    if (result.firstMark) {
      // 延迟一帧让浏览器完成布局后再滚动
      requestAnimationFrame(() => {
        result.firstMark?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    return () => {
      result.cleanup();
      highlightStateRef.current = null;
    };
  }, [searchQuery, answer.id]);

  // ── 笔记划词高亮（B66）──
  const noteHighlightRef = useRef<{ cleanup: () => void } | null>(null);

  useEffect(() => {
    noteHighlightRef.current?.cleanup();
    noteHighlightRef.current = null;

    if (!noteHighlights || noteHighlights.length === 0 || !articleRef.current) return;

    const cleanups: Array<() => void> = [];
    for (const text of noteHighlights) {
      const trimmed = text.trim();
      if (trimmed.length < 3) continue; // 过短文本不高亮
      const result = highlightInContainer(
        articleRef.current,
        trimmed,
        "note-highlight bg-brand/10",
      );
      cleanups.push(result.cleanup);
    }

    noteHighlightRef.current = {
      cleanup() {
        cleanups.forEach((fn) => fn());
      },
    };

    return () => {
      noteHighlightRef.current?.cleanup();
      noteHighlightRef.current = null;
    };
  }, [noteHighlights, answer.id]);

  // Phase 66 B104 — 即时 tooltip 替代原生 title (T3)
  const [bookmarkTooltip, setBookmarkTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  if (isStub) {
    return (
      <article className="flex flex-col gap-gm-4">
        {onBack && (
          <button
            onClick={onBack}
            className="lg:hidden inline-flex items-center gap-gm-1 text-gm-sm text-text-secondary
                       hover:text-text transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98] rounded-gm-xs"
          >
            <RiArrowLeftLine className="w-gm-icon-md h-gm-icon-md" />
            返回列表
          </button>
        )}
        <div
          className="flex flex-col items-center justify-center gap-gm-3 py-gm-8 text-center
                      bg-surface-elevated border border-border rounded-gm-lg shadow-gm-sm"
        >
          <span className="text-gm-lg text-text-muted">
            内容即将推出
          </span>
          <p className="text-gm-sm text-text-muted max-w-md">
            「{answer.question}」的内容正在撰写中，预计近期上线。
            在此之前，欢迎浏览其他已完成的章节。
          </p>
        </div>
      </article>
    );
  }

  return (
    <>
    <article ref={articleRef} className={`flex flex-col gap-gm-6 ${immersive ? "answer-reading-mode" : ""}`}>
      {/* 移动端返回按钮 */}
      {onBack && (
        <button
          onClick={onBack}
          className="lg:hidden inline-flex items-center gap-gm-1 text-gm-sm text-text-secondary
                     hover:text-text transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98] rounded-gm-xs"
        >
          <RiArrowLeftLine className="w-gm-icon-md h-gm-icon-md" />
          返回列表
        </button>
      )}

      {/* 章节归属 + 问题标题 */}
      <div>
        {answer.chapterTitle && (
          <p className="text-gm-sm text-text-muted mb-gm-1">
            {formatChapterTitle(answer.chapterTitle)}
            {estimatedReadingTime !== undefined && estimatedReadingTime > 0 && (
              <>{' · '}{formatReadingTime(estimatedReadingTime)}</>
            )}
          </p>
        )}
        <h1 className="text-gm-xl font-semibold text-text leading-tight">
          {questionIndex && (
            <span className="text-text-muted mr-gm-1">{questionIndex.index}.</span>
          )}
          {answer.question}
        </h1>
      </div>

      {/* 收藏星标按钮 */}
      {onToggleBookmark && (
        <div className="flex justify-end">
          <button
            onClick={onToggleBookmark}
            className={`inline-flex items-center gap-gm-1 px-gm-1_5 py-gm-0_5 rounded-gm-md transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98] ${
              isBookmarked
                ? "text-warning-light hover:text-warning"
                : "text-text-muted hover:text-warning-light"
            }`}
            aria-label={isBookmarked ? "取消收藏" : "收藏"}
            onMouseEnter={(e) => setBookmarkTooltip({ x: e.clientX, y: e.clientY, text: isBookmarked ? "取消收藏" : "收藏" })}
            onMouseMove={(e) => setBookmarkTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => setBookmarkTooltip(null)}
          >
            {isBookmarked ? (
              <RiStarFill className="w-gm-icon-md h-gm-icon-md" />
            ) : (
              <RiStarLine className="w-gm-icon-md h-gm-icon-md" />
            )}
          </button>
        </div>
      )}

      {/* L0 — 一句话结论（玻璃态突出卡片） */}
      <div className="answer-l0-card">
        <p className="text-gm-base font-semibold text-text leading-relaxed">
          {answer.l0}
        </p>
      </div>

      {/* L1 — 核心解释（正文区） */}
      <div className="answer-l1-body">
        <h2>核心解释</h2>
        <div
          className="prose text-gm-base text-text leading-relaxed
                     [&_h3]:text-gm-lg [&_h3]:font-semibold [&_h3]:text-text [&_h3]:mt-gm-5 [&_h3]:mb-gm-3
                     [&_p]:mb-gm-3 [&_ul]:mb-gm-3 [&_li]:mb-gm-1_5
                     [&_strong]:text-text [&_a]:text-brand [&_a]:underline
                     [&_code]:text-gm-sm [&_code]:bg-bg-subtle [&_code]:px-gm-1 [&_code]:rounded-gm-xs
                     [&_table]:w-full [&_table]:text-gm-sm [&_td]:border [&_td]:border-border [&_td]:p-gm-2
                     [&_th]:border [&_th]:border-border [&_th]:p-gm-2 [&_th]:text-text-secondary"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.l1) }}
        />
      </div>

      {/* L2 — 深度探索（可折叠） */}
      {answer.l2 && (
        <CollapsibleSection
          variant="card"
          title="深度探索"
          headerClassName="answer-l2-header"
          contentClassName={
            "answer-fold-content prose text-gm-sm text-text leading-relaxed " +
            "[&_h3]:text-gm-lg [&_h3]:font-semibold [&_h3]:text-text [&_h3]:mt-gm-4 [&_h3]:mb-gm-2 " +
            "[&_p]:mb-gm-2 [&_ul]:mb-gm-2 [&_li]:mb-gm-1_5 " +
            "[&_strong]:text-text [&_a]:text-brand [&_a]:underline " +
            "[&_code]:text-gm-xs [&_code]:bg-bg-subtle [&_code]:px-gm-1 [&_code]:rounded-gm-xs " +
            "[&_pre]:bg-bg-subtle [&_pre]:p-gm-3 [&_pre]:rounded-gm-md [&_pre]:overflow-x-auto [&_pre]:text-gm-xs " +
            "[&_table]:w-full [&_table]:text-gm-xs [&_td]:border [&_td]:border-border [&_td]:p-gm-2 " +
            "[&_th]:border [&_th]:border-border [&_th]:p-gm-2 [&_th]:text-text-secondary"
          }
        >
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.l2) }} />
        </CollapsibleSection>
      )}

      {/* L3 — 前沿与未解（可折叠） */}
      {answer.l3 && (
        <CollapsibleSection
          variant="card"
          title="前沿与未解"
          headerClassName="answer-l3-header"
          contentClassName={
            "answer-fold-content prose text-gm-sm text-text leading-relaxed " +
            "[&_h3]:text-gm-lg [&_h3]:font-semibold [&_h3]:text-text [&_h3]:mt-gm-4 [&_h3]:mb-gm-2 " +
            "[&_p]:mb-gm-2 [&_ul]:mb-gm-2 [&_li]:mb-gm-1_5 " +
            "[&_strong]:text-text [&_a]:text-brand [&_a]:underline " +
            "[&_code]:text-gm-xs [&_code]:bg-bg-subtle [&_code]:px-gm-1 [&_code]:rounded-gm-xs"
          }
        >
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.l3) }} />
        </CollapsibleSection>
      )}

      {/* ── Phase 49 Batch 3: 跨章关联 ── */}
      {answer.crossChapterConnections && answer.crossChapterConnections.length > 0 && (
        <div className="border border-border rounded-gm-lg p-gm-4">
          <h3 className="text-gm-sm font-semibold text-text-secondary uppercase tracking-wider mb-gm-3">
            <RiLinkM className="inline-block w-gm-icon-sm h-gm-icon-sm mr-gm-1 -mt-gm-0_5" />
            跨章关联
          </h3>
          <div className="flex flex-col gap-gm-2">
            {answer.crossChapterConnections.map((conn, i) => {
              const typeLabel = CONNECTION_TYPE_LABELS[conn.type] || conn.type;
              const typeIcon = CONNECTION_TYPE_ICONS[conn.type];
              return (
                <button
                  key={i}
                  onClick={() => router.push(`/learn?q=${encodeURIComponent(conn.questionId)}`)}
                  className="flex items-start gap-gm-2 px-gm-3 py-gm-2 rounded-gm-md
                             bg-surface-elevated hover:bg-surface-hover transition-all
                             text-left w-full group focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
                >
                  <span className="mt-gm-0_5 flex-shrink-0 text-brand/70 group-hover:text-brand transition-colors">
                    {typeIcon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-gm-1_5 mb-gm-0_5">
                      <span className="text-gm-xs font-medium text-brand uppercase tracking-wider">
                        {typeLabel}
                      </span>
                      <span className="text-gm-xs text-text-muted">
                        · {getAnswerById(conn.questionId)?.question || conn.questionId}
                      </span>
                    </div>
                    <p className="text-gm-sm text-text leading-relaxed">
                      {conn.relationship}
                    </p>
                  </div>
                  <RiArrowRightUpLine className="w-gm-icon-sm h-gm-icon-sm flex-shrink-0 mt-gm-1
                    text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Phase 43 Batch 2: Learn→Lab 桥接按钮 ── */}
      {/* Phase 47 Batch 7: 移动端隐藏 — 移动端仅三页，Lab 不在其中 */}
      {answer.labLinks && answer.labLinks.length > 0 && (
        <div className="hidden lg:block">
          <hr className="border-border" />
          <div className="flex flex-wrap gap-gm-3">
            {answer.labLinks.map((link, i) => (
              <button
                key={i}
                onClick={() => router.push(`/lab?tab=${link.tab}`)}
                className="inline-flex items-center gap-gm-1_5 px-gm-3 py-gm-1_5
                           rounded-gm-md border border-brand/40 text-brand
                           hover:bg-brand/5 transition-all text-gm-sm font-medium
                           focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
              >
                <RiFlaskLine className="w-gm-icon-md h-gm-icon-md" />
                {link.label || "在实验室中探索"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── B66: 划词浮动工具栏 ── */}
      {onAddNote && (
        <SelectionToolbar
          containerRef={articleRef as React.RefObject<HTMLElement | null>}
          onAddNote={onAddNote}
        />
      )}
    </article>
    {bookmarkTooltip && (
      <div className="fixed z-50 rounded-gm-sm border border-border-strong bg-surface-elevated px-gm-2.5 py-gm-1.5 shadow-gm-md pointer-events-none"
           style={{ left: bookmarkTooltip.x + 12, top: bookmarkTooltip.y - 8 }}>
        <p className="text-gm-xs text-text whitespace-nowrap">{bookmarkTooltip.text}</p>
      </div>
    )}
    </>
  );
}

// renderMarkdown and PURIFY_CONFIG are now in @/lib/renderMarkdown (shared with ChatMessage).

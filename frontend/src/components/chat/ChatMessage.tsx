/**
 * ChatMessage — 单条聊天消息气泡组件。
 *
 * 渲染用户/助理消息气泡，用户消息关联意图标签（IntentPill），
 * 助理消息支持展开洋葱面板、消息旅程、对话历史和四支柱面板。
 *
 * @module components/chat/ChatMessage
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Message } from "@/hooks/useChat";
import type { ApiTrace, IntentResult, RoutingInfo } from "@/lib/api/types";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { formatRelativeTime } from "@/lib/formatTime";
import { useCodeHighlight } from "@/hooks/useCodeHighlight";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import OnionPanel from "./OnionPanel";
import IntentPill from "./IntentPill";
import JourneyCards from "./JourneyCards";
import JourneyHistoryBrowser from "./JourneyHistoryBrowser";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { useDrawer } from "./DrawerContext";

/**
 * 单条聊天消息气泡。
 *
 * 用户消息：右对齐品牌色气泡 + 意图标签（可点击打开深度抽屉）。
 * 助理消息：左对齐边框气泡 + 洋葱面板/消息旅程/对话历史展开按钮。
 */
function ChatMessage({
  message,
  userIntent,
  userTrace,
  userRouting,
  episodeCount,
}: {
  message: Message;
  /** 用户消息关联的意图（从对应助理响应的 intent 字段关联） */
  userIntent?: IntentResult;
  /** 用户消息关联的 API trace（从对应助理响应关联，用于打开深度抽屉） */
  userTrace?: ApiTrace | null;
  /** Phase 66 B43 — 用户消息关联的路由决策（用于 IntentPill complexity 显示） */
  userRouting?: RoutingInfo | null;
  /** Phase 66 B44 — 对话历史条数（用于按钮数据感知，R26） */
  episodeCount?: number;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasResponse = isAssistant && message.response != null;
  const response = hasResponse ? message.response! : null;
  /** 互斥展开面板 — "journey" | "history" | "onion" | null */
  const [expandedPanel, setExpandedPanel] = useState<"journey" | "history" | "onion" | null>(null);
  const peeled = expandedPanel === "onion";
  const journeyOpen = expandedPanel === "journey";
  const historyOpen = expandedPanel === "history";
  const { openDrawer } = useDrawer();
  const contentRef = useRef<HTMLSpanElement>(null);
  const mermaidRootsRef = useRef<Map<HTMLElement, ReturnType<typeof createRoot>>>(new Map());

  // ── Hydrate mermaid blocks injected by renderMarkdown ──
  useEffect(() => {
    if (!contentRef.current) return;
    const containers = contentRef.current.querySelectorAll<HTMLDivElement>(
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
        let root = mermaidRootsRef.current.get(container);
        if (!root) {
          root = createRoot(container);
          mermaidRootsRef.current.set(container, root);
        }
        root.render(
          <MermaidDiagram chart={chart} title={title} maxHeight={0} />,
        );
      } catch {
        container.innerHTML =
          '<p class="text-gm-sm text-error">流程图加载失败</p>';
        mermaidRootsRef.current.delete(container);
      }
    });

    // 卸载已不在 DOM 中的容器
    mermaidRootsRef.current.forEach((root, c) => {
      if (!activeContainers.has(c)) {
        root.unmount();
        mermaidRootsRef.current.delete(c);
      }
    });
  }, [message.content]);

  // ── Prism 语法高亮 + 行号 + 复制按钮 ──
  useCodeHighlight(contentRef, [message.content]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-gm-4 animate-gm-slide-in`}>
      <div className={`${isUser ? "max-w-[80%] sm:max-w-[70%]" : "max-w-[88%] sm:max-w-[80%]"}`}>
        {/* 用户消息上方：意图标签（可点击打开深度抽屉） */}
        {isUser && userIntent && (
          <div className="mb-gm-1 flex justify-end">
            <IntentPill
              category={userIntent.category}
              confidence={userIntent.confidence}
              rationale={userIntent.rationale}
              complexity={userRouting?.complexity}
              onClick={userTrace ? () => openDrawer(userTrace, message.id) : undefined}
            />
          </div>
        )}

        {/* 消息气泡 */}
        <div
          className={`rounded-gm-lg px-gm-4 py-gm-3 shadow-gm-sm ${
            isUser
              ? "bg-brand text-text-inverse rounded-br-gm-xs"
              : "bg-surface-elevated text-text border border-border rounded-bl-gm-xs"
          }`}
        >
          <span
            ref={contentRef}
            className={`chat-prose text-gm-base ${isUser ? "text-text-inverse" : "text-text"}`}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(message.content || ""),
            }}
          />
        </div>

        {/* 时间戳 — 气泡下方小字 */}
        <div
          className={`mt-gm-1 text-gm-xs text-text-muted select-none ${
            isUser ? "text-right" : "text-left"
          }`}
          aria-label={`发送时间: ${new Date(message.createdAt).toLocaleTimeString()}`}
        >
          {formatRelativeTime(message.createdAt)}
        </div>

        {/* 折叠面板——仅助理消息且存在 response 时显示 */}
        {hasResponse && (
          <>
            {/* ── 一行按钮栏（去图标、纯文字、小字号）── */}
            <div className="mt-gm-2 flex flex-wrap items-center gap-x-gm-2 gap-y-gm-1">
              <button
                type="button"
                onClick={() => setExpandedPanel(expandedPanel === "journey" ? null : "journey")}
                className={`text-gm-xs transition-colors cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs ${journeyOpen ? "text-brand font-medium" : "text-text-muted hover:text-brand"}`}
                aria-expanded={journeyOpen}
              >
                消息旅程
              </button>
              <span className="text-text-muted text-gm-xs select-none opacity-40">·</span>
              <button
                type="button"
                onClick={() => setExpandedPanel(expandedPanel === "history" ? null : "history")}
                className={`text-gm-xs transition-colors cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs ${
                  episodeCount === 0
                    ? "text-text-muted/40 cursor-not-allowed"
                    : historyOpen
                      ? "text-brand font-medium"
                      : "text-text-muted hover:text-brand"
                }`}
                aria-expanded={historyOpen}
                disabled={episodeCount === 0}
              >
                对话历史
                {episodeCount != null && episodeCount > 0 && (
                  <span className="ml-gm-1 text-gm-2xs text-text-muted">
                    {episodeCount}
                  </span>
                )}
              </button>
              <span className="text-text-muted text-gm-xs select-none opacity-40">·</span>
              <button
                type="button"
                onClick={() => setExpandedPanel(expandedPanel === "onion" ? null : "onion")}
                className={`text-gm-xs transition-colors cursor-pointer active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs ${peeled ? "text-brand font-medium" : "text-text-muted hover:text-brand"}`}
                aria-expanded={peeled}
              >
                洋葱面板
              </button>
            </div>

            {/* ── 展开内容区（面板在按钮行下方独立渲染）── */}
            {journeyOpen && (
              <div className="mt-gm-2">
                <ErrorBoundary fallbackVariant="inline">
                  <JourneyCards response={response!} onCollapse={() => setExpandedPanel(null)} />
                </ErrorBoundary>
              </div>
            )}
            {historyOpen && (
              <div className="mt-gm-2">
                <ErrorBoundary fallbackVariant="inline">
                  <JourneyHistoryBrowser onCollapse={() => setExpandedPanel(null)} />
                </ErrorBoundary>
              </div>
            )}
            {peeled && (
              <div className="mt-gm-2">
                <ErrorBoundary fallbackVariant="inline">
                  <OnionPanel response={response!} onCollapse={() => setExpandedPanel(null)} />
                </ErrorBoundary>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;

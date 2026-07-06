"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { RiCloseLine } from "@remixicon/react";
import { getTerm } from "@/lib/glossary";

interface ExplainPopoverProps {
  /** 术语 id，对应 glossary.ts 中的 GlossaryTerm.id */
  termId: string;
  /** 触发元素（点击打开 popover） */
  children: React.ReactNode;
}

/**
 * 术语详解 Popover。
 *
 * 点击触发元素后在屏幕中央弹出详情卡片，包含完整术语定义和相关术语导航。
 * Portal 渲染到 document.body，避免 z-index 冲突。
 *
 * 内容：标题 + 分类 badge + 长定义（多段落）+ 相关术语 pills（点击切换）
 * 关闭：关闭按钮 / 点击 backdrop / Escape 键
 */
export default function ExplainPopover({
  termId,
  children,
}: ExplainPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentTermId, setCurrentTermId] = useState(termId);

  // 打开时同步外部 termId（通过 setTimeout 避免同步 setState 触发 React 19 警告）
  useEffect(() => {
    const id = setTimeout(() => setCurrentTermId(termId), 0);
    return () => clearTimeout(id);
  }, [termId]);

  const term = getTerm(currentTermId);

  const open = useCallback(() => {
    setCurrentTermId(termId);
    setIsOpen(true);
  }, [termId]);

  const close = useCallback(() => setIsOpen(false), []);

  // Escape 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, close]);

  // 打开时禁止 body 滚动
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  const paragraphs = term
    ? term.longDef.split("\n\n").filter(Boolean)
    : [];

  const popover = isOpen && (
    <div
      className="fixed inset-0 flex items-center justify-center p-gm-4"
      style={{
        zIndex: "var(--gm-z-nav)",
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(4px)",
        animation: "gm-fade-in 200ms ease",
      }}
      onClick={(e) => {
        // 只响应 backdrop 点击，不响应 card 内部点击
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={term ? `${term.term} — 术语详解` : "术语详解"}
    >
      <div
        className="gm-popover-card flex max-h-[80vh] w-full max-w-[min(480px,calc(100vw-2rem))] flex-col overflow-hidden"
        style={{
          background: "var(--gm-surface)",
          border: "1px solid var(--gm-border)",
          borderRadius: "var(--gm-radius-lg, 12px)",
          boxShadow: "var(--gm-shadow-lg, 0 8px 32px rgba(0,0,0,0.18))",
          animation: "gm-popover-in var(--gm-duration-base) var(--gm-ease)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-gm-3 p-gm-4 pb-gm-2"
          style={{ borderBottom: "1px solid var(--gm-border)" }}
        >
          <div className="min-w-0 flex-1">
            {term ? (
              <>
                <h3
                  className="text-gm-base font-semibold"
                  style={{ color: "var(--gm-text)" }}
                >
                  {term.term}
                </h3>
                <p className="text-gm-xs mt-gm-0_5" style={{ color: "var(--gm-text-muted)" }}>
                  {term.category} · 术语详解
                </p>
              </>
            ) : (
              <h3 className="text-gm-base font-semibold" style={{ color: "var(--gm-text)" }}>
                术语未收录
              </h3>
            )}
          </div>
          <button
            onClick={close}
            className="shrink-0 rounded-gm-sm p-gm-1 text-text-muted hover:bg-surface-alt transition-colors"
            aria-label="关闭"
          >
            <RiCloseLine className="text-gm-icon" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-gm-4 pt-gm-3">
          {term ? (
            <>
              {paragraphs.map((para, i) => (
                <p
                  key={i}
                  className="text-gm-sm mb-gm-3"
                  style={{
                    color: "var(--gm-text-secondary)",
                    lineHeight: "var(--gm-leading-relaxed, 1.7)",
                  }}
                >
                  {para}
                </p>
              ))}

              {/* Related terms */}
              {term.relatedTerms.length > 0 && (
                <div className="mt-gm-4 pt-gm-3" style={{ borderTop: "1px solid var(--gm-border)" }}>
                  <p className="text-gm-xs mb-gm-2" style={{ color: "var(--gm-text-muted)" }}>
                    相关术语
                  </p>
                  <div className="flex flex-wrap gap-gm-2">
                    {term.relatedTerms.map((relId) => {
                      const relTerm = getTerm(relId);
                      return (
                        <button
                          key={relId}
                          onClick={() => setCurrentTermId(relId)}
                          className="gm-popover-related-pill rounded-gm-full px-gm-3 py-gm-1 text-gm-xs transition-colors"
                          style={{
                            background:
                              currentTermId === relId
                                ? "var(--gm-brand)"
                                : "var(--gm-surface-alt)",
                            color:
                              currentTermId === relId
                                ? "var(--gm-text-on-brand)"
                                : "var(--gm-text-secondary)",
                            border: "none",
                          }}
                        >
                          {relTerm ? relTerm.term : relId}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-gm-sm" style={{ color: "var(--gm-text-muted)" }}>
              该术语定义暂未收录。请尝试搜索其他术语。
            </p>
          )}
        </div>
      </div>

      {/* Inline keyframes for popover card entrance */}
      <style>{`
        @keyframes gm-popover-in {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );

  return (
    <>
      {/* Trigger */}
      <span
        onClick={open}
        className="gm-popover-trigger inline cursor-pointer"
        style={{
          textDecoration: "underline",
          textDecorationStyle: "dashed",
          textDecorationColor: "var(--gm-brand)",
          textUnderlineOffset: "3px",
          color: "var(--gm-brand)",
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        {children}
      </span>

      {/* Portal popover */}
      {typeof document !== "undefined" && createPortal(popover, document.body)}
    </>
  );
}

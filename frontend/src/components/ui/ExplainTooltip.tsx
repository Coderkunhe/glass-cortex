"use client";

import { useFloating, shift, flip, offset } from "@floating-ui/react";
import { getTerm } from "@/lib/glossary";

interface ExplainTooltipProps {
  /** 术语 id，对应 glossary.ts 中的 GlossaryTerm.id */
  termId: string;
  /** 被包裹的文本内容（显示为虚线下划线样式） */
  children: React.ReactNode;
}

/**
 * 内联术语解释 Tooltip。
 *
 * 使用 @floating-ui/react 的 `shift()` + `flip()` middleware 确保气泡在视口
 * 内不溢出——替代旧版纯 CSS `left:50%; translateX(-50%)` 居中定位。
 * hover 时在术语上方弹出解释气泡，视口边缘自动移位/翻转。
 * 术语未找到时静默降级——只渲染 children，无 tooltip 行为。
 *
 * 设计：虚线下划线 cue 用户可 hover，hover 时气泡从上方滑入。
 * 移动端通过长按触发浏览器原生 :hover 行为。
 */
export default function ExplainTooltip({ termId, children }: ExplainTooltipProps) {
  const term = getTerm(termId);

  // @floating-ui/react — 视口边界检测定位
  // (destructured as `fRefs` to avoid react-hooks/refs false-positive
  //  on callback refs that aren't React ref values)
  const { refs: fRefs, floatingStyles } = useFloating({
    placement: "top",
    middleware: [
      offset(8),
      shift({ padding: 8 }),
      flip({ padding: 8 }),
    ],
  });

  // 术语未找到 → 静默降级，裸渲染 children
  if (!term) {
    return <>{children}</>;
  }

  return (
    <>
      {/* 组件级 CSS — 作用域限制在本组件实例 */}
      <style>{`
        .gm-tooltip-wrap {
          position: relative;
          display: inline;
          cursor: help;
          text-decoration: underline;
          text-decoration-style: dotted;
          text-decoration-color: var(--gm-text-muted);
          text-underline-offset: 3px;
        }

        .gm-tooltip-wrap:hover .gm-tooltip-bubble {
          opacity: 1;
          visibility: visible;
        }

        .gm-tooltip-bubble {
          /* position / left / top 由 @floating-ui/react 内联 style 管理，
             覆盖旧版 CSS left:50%;translateX(-50%) 静态居中 */
          max-width: 280px;
          width: max-content;
          padding: var(--gm-space-2, 8px) var(--gm-space-3, 12px);
          background: var(--gm-surface-elevated);
          border: 1px solid var(--gm-border);
          border-radius: var(--gm-radius-sm, 6px);
          box-shadow: var(--gm-shadow-md, 0 4px 12px rgba(0,0,0,0.12));
          font-size: var(--gm-text-xs, 12px);
          line-height: var(--gm-leading-relaxed, 1.6);
          color: var(--gm-text);
          white-space: normal;
          opacity: 0;
          visibility: hidden;
          transition: opacity var(--gm-duration-fast, 150ms) ease,
                      visibility var(--gm-duration-fast, 150ms) ease;
          pointer-events: none;
          z-index: var(--gm-z-overlay);
        }

        /* 气泡下方的三角箭头 */
        .gm-tooltip-bubble::after {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-top-color: var(--gm-border);
        }

        /* 三角内部填充 */
        .gm-tooltip-bubble::before {
          content: "";
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%) translateY(-1px);
          border: 5px solid transparent;
          border-top-color: var(--gm-surface-elevated);
          z-index: var(--gm-z-content);
        }

        .gm-tooltip-category {
          display: inline-block;
          font-size: var(--gm-text-2xs, 10px);
          color: var(--gm-text-muted);
          margin-bottom: 4px;
        }

        .gm-tooltip-term {
          font-weight: 600;
          color: var(--gm-text);
          margin-bottom: 4px;
        }

        .gm-tooltip-def {
          color: var(--gm-text-secondary);
        }
      `}</style>

      <span
        className="gm-tooltip-wrap"
        ref={
          // eslint-disable-next-line react-hooks/refs
          fRefs.setReference
        }
      >
        {children}
        <span
          className="gm-tooltip-bubble"
          role="tooltip"
          ref={
            // eslint-disable-next-line react-hooks/refs
            fRefs.setFloating
          }
          style={floatingStyles}
        >
          <div className="gm-tooltip-category">{term.category} · {term.term}</div>
          <div className="gm-tooltip-def">{term.shortDef}</div>
        </span>
      </span>
    </>
  );
}

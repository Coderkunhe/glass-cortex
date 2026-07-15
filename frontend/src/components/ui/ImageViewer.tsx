"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

/** ImageViewer 组件 props */
interface ImageViewerProps {
  /** 图片 URL 或 data URI（如 SVG data URI）。svgHtml 提供时可选 */
  src?: string;
  /**
   * 原始 SVG HTML 字符串。
   *
   * 提供时通过 iframe srcDoc 渲染 SVG，实现样式隔离，
   * 绕过 `<img>` 标签的安全沙箱限制（如 foreignObject 不渲染），
   * 同时避免 SVG 内部 CSS 与页面样式冲突导致 zoom 失效。
   * 适用于 Mermaid 等生成含 foreignObject 的 SVG 场景。
   */
  svgHtml?: string;
  /** 无障碍替代文本，用作 aria-label */
  alt: string;
  /** 受控显示状态 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 图片预览 Lightbox 组件。
 *
 * 点击缩略图/流程图后以全屏叠加层展示大图，支持：
 * - 点击遮罩关闭
 * - Escape 键关闭
 * - 关闭按钮（右上角 ✕）
 * - Body 滚动锁定（防止背景滚动）
 * - 淡入动画
 *
 * **SVG 模式（svgHtml prop）**：
 * - 通过 iframe + srcDoc 渲染 SVG，提供完整的样式隔离
 * - Zoom 使用 CSS `transform: scale()` 而非修改元素尺寸，
 *   避免 CSS 特异性冲突和 layout thrashing
 * - 透明 overlay 层捕获所有 pointer/wheel 事件，
 *   iframe 设 `pointer-events: none` 仅负责显示
 * - 滚轮缩放（1x–5x），缩放中心跟随光标
 * - 点击关闭 lightbox（单击即关闭，不 toggle zoom）
 * - 放大后拖拽平移
 *
 * **图片模式（src prop）**：
 * - 传统 `<img>` 标签，无 zoom/pan 交互
 */
export default function ImageViewer({
  src,
  svgHtml,
  alt,
  isOpen,
  onClose,
}: ImageViewerProps) {
  // ── Zoom & pan state ──
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Refs — 避免 useCallback 闭包过期
  const scaleRef = useRef(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    hasDragged: false,
  });

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // ── Build iframe srcdoc ──
  // 将 SVG 嵌入最小 HTML 文档，body 使用 flex 居中，
  // SVG 自适应视口（max-width/max-height: 100%）
  const srcdoc = svgHtml
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:transparent}
svg{max-width:100%;max-height:100%;height:auto;width:auto}
</style></head><body>${svgHtml}</body></html>`
    : undefined;

  // ── Wheel → zoom toward cursor ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    // 光标在 viewport 中的坐标
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const oldScale = scaleRef.current;
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    const newScale = Math.max(1, Math.min(5, oldScale + delta));
    if (newScale === oldScale) return;

    // 保持光标下的内容点不动
    const ratio = newScale / oldScale;
    setPan((prev) => ({
      x: cx * (1 - ratio) + prev.x * ratio,
      y: cy * (1 - ratio) + prev.y * ratio,
    }));
    setScale(newScale);
  }, []);

  // ── Click → close lightbox ──
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 拖拽过的 click 不触发关闭
    if (dragState.current.hasDragged) {
      dragState.current.hasDragged = false;
      return;
    }
    onClose();
  }, [onClose]);

  // ── Pointer down → start drag（仅在 zoomed 态） ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scaleRef.current <= 1) return;
    e.preventDefault();
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      hasDragged: false,
    };
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pan]);

  // ── Pointer move → pan ──
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.active) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragState.current.hasDragged = true;
    }
    setPan({
      x: dragState.current.startPanX + dx,
      y: dragState.current.startPanY + dy,
    });
  }, []);

  // ── Pointer up → end drag ──
  const handlePointerUp = useCallback(() => {
    dragState.current.active = false;
    setIsDragging(false);
  }, []);

  // ── Escape key handler ──
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Body scroll lock ──
  useEffect(() => {
    if (!isOpen) return;
    const savedBodyOverflow = document.body.style.overflow;
    const savedBodyPaddingRight = document.body.style.paddingRight;
    const savedHtmlOverflow = document.documentElement.style.overflow;
    const scrollbarW =
      window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarW > 0) {
      document.body.style.paddingRight = `${scrollbarW}px`;
    }

    return () => {
      document.body.style.overflow = savedBodyOverflow;
      document.body.style.paddingRight = savedBodyPaddingRight;
      document.documentElement.style.overflow = savedHtmlOverflow;
    };
  }, [isOpen]);

  // ── 关闭状态不渲染 ──
  if (!isOpen) return null;

  const lightbox = (
    <div
      ref={viewportRef}
      className="gm-image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <style>{`
        .gm-image-viewer {
          position: fixed;
          inset: 0;
          z-index: var(--gm-z-notify);
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(4px);
          animation: gm-iv-fade-in var(--gm-duration-base) ease-out;
        }
        @keyframes gm-iv-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .gm-iv-close {
          position: fixed;
          top: 1rem;
          right: 1rem;
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
          font-size: 1.25rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
          z-index: calc(var(--gm-z-notify) + 1);
          line-height: 1;
        }
        .gm-iv-close:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        /* ── SVG iframe 模式 ── */
        .gm-iv-svg-layer {
          position: relative;
          width: 100vw;
          height: 100vh;
          /* transform-origin: 0 0 — translate + scale 从左上角计算 */
          transform-origin: 0 0;
          border-radius: 0;
          /* overflow 移除：放大后不裁剪平移/缩放内容 */
          animation: gm-iv-zoom-in var(--gm-duration-base) ease-out;
        }
        @keyframes gm-iv-zoom-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .gm-iv-svg-iframe {
          width: 100%;
          height: 100%;
          border: none;
          background: var(--gm-bg, #fff);
          /* iframe 不接收指针事件 — overlay 层捕获所有交互 */
          pointer-events: none;
        }
        .gm-iv-svg-overlay {
          position: absolute;
          inset: 0;
          z-index: var(--gm-z-content);
          cursor: pointer;
          background: transparent;
          /* 阻止浏览器在 overlay 上的默认 touch 行为 */
          touch-action: none;
        }
        .gm-iv-svg-overlay--zoomed {
          cursor: grab;
        }
        .gm-iv-svg-overlay--dragging {
          cursor: grabbing;
        }

        /* ── 图片模式 ── */
        .gm-iv-img {
          max-width: 100vw;
          max-height: 100vh;
          object-fit: contain;
          border-radius: var(--gm-radius-sm, 4px);
          background: var(--gm-bg, #fff);
          padding: var(--gm-space-4, 16px);
          cursor: default;
          animation: gm-iv-zoom-in var(--gm-duration-base) ease-out;
        }
      `}</style>

      {/* 关闭按钮 */}
      <button
        className="gm-iv-close focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="关闭预览"
        type="button"
      >
        ✕
      </button>

      {/* 内容区域 */}
      {svgHtml && srcdoc ? (
        /* SVG 模式 — iframe + transform zoom */
        <div
          className="gm-iv-svg-layer"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          }}
        >
          <iframe
            className="gm-iv-svg-iframe"
            srcDoc={srcdoc}
            title={alt}
          />
          <div
            className={
              "gm-iv-svg-overlay"
              + (scale > 1 ? " gm-iv-svg-overlay--zoomed" : "")
              + (isDragging ? " gm-iv-svg-overlay--dragging" : "")
            }
            onClick={handleContentClick}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>
      ) : (
        /* 图片模式 — 传统 <img> */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          className="gm-iv-img"
          src={src}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );

  // Portal to document.body — 脱离父容器 stacking context / overflow 限制，
  // 确保 lightbox 在所有容器之上（z-index 只在 root stacking context 有效）
  if (typeof document !== "undefined") {
    return createPortal(lightbox, document.body);
  }
  // SSR 回退 (实际不会到达 — isOpen 仅在客户端为 true)
  return lightbox;
}

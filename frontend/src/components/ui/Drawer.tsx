"use client";

import { useState, useEffect, useRef } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useScrollLock } from "./ScrollLockContext";

/**
 * Drawer — 统一的右侧滑入抽屉组件。
 *
 * 封装了三个抽屉共享的动画状态机（mounted + phase + double-rAF）、
 * 遮罩层和抽屉面板外壳。ProcessDrawer / ProjectMapDrawer / TagDetailDrawer
 * 现在只需关注内容渲染，将 isOpen/onClose/children 传入即可。
 *
 * 所有动画值走 CSS 自定义属性（--gm-drawer-*），暗模式遮罩通过
 * data-theme 主题块自动适配，不再内联硬编码 rgba。
 *
 * 打开时自动锁定 body 滚动（引用计数，支持多 Drawer 并存），
 * 关闭时恢复。消除背景页面滚动条与抽屉内滚动条并存的双滚动条问题。
 */
export interface DrawerProps {
  /** 抽屉是否应可见 */
  isOpen: boolean;
  /** 关闭回调（遮罩点击 / Escape 键触发） */
  onClose: () => void;
  /** 抽屉内容（header + body），由调用方完全控制 */
  children: React.ReactNode;
  /** 面板最大宽度 (px)，默认使用 CSS token --gm-drawer-width (480px) */
  maxWidth?: number;
  /** 入场/退场动画时长 (ms)，默认使用 CSS token --gm-duration-drawer (420ms) */
  duration?: number;
  /** 无障碍标签，会渲染到 role="dialog" 的 aria-label */
  ariaLabel?: string;
  /** 滑入方向。"right"（默认）从右侧滑入；"left" 从左侧滑入（移动端侧边栏） */
  position?: "left" | "right";
}

export default function Drawer({
  isOpen,
  onClose,
  children,
  maxWidth,
  duration,
  ariaLabel = "对话框",
  position = "right",
}: DrawerProps) {
  // ── 动画状态机： mounted (DOM 是否存在) + phase (动画阶段) ──
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<"entering" | "open" | "exiting">(
    "entering",
  );

  // ── 入场：isOpen true → mount → paint 初始 transform → transition 到 open ──
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        setMounted(true);
        // 双层 rAF 确保浏览器 paint 了 translateX(100%) 后再触发 transition
        requestAnimationFrame(() => setPhase("open"));
      });
    }
  }, [isOpen]);

  // ── 退场：isOpen false + 已 mount → exiting → 动画结束后 unmount ──
  useEffect(() => {
    if (!isOpen && mounted) {
      let timer: ReturnType<typeof setTimeout>;
      requestAnimationFrame(() => {
        setPhase("exiting");
        const dur = duration ?? 420;
        timer = setTimeout(() => {
          setMounted(false);
          setPhase("entering");
        }, dur);
      });
      return () => clearTimeout(timer);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- mounted guarded internally

  // ── Escape 键 ──
  useEffect(() => {
    if (!mounted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mounted, onClose]);

  // ── Body scroll lock（通过 ScrollLockContext 引用计数，支持多 Drawer 并存）──
  const { register } = useScrollLock();
  useEffect(() => {
    if (!mounted) return;
    const release = register();
    return release;
  }, [mounted, register]);

  // ── 派生样式变量 ──
  const effectivelyOpen = phase === "open";
  const willEnter = phase === "entering";
  const isLeft = position === "left";
  const offScreenTransform = isLeft ? "translateX(-100%)" : "translateX(100%)";
  const edgeClass = isLeft ? "left-0" : "right-0";

  // ── 焦点陷阱 (WCAG 2.1 SC 2.4.3) ──
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, {
    enabled: mounted && effectivelyOpen,
  });

  // ── 定制值覆写 CSS token ──
  const panelMaxWidth = maxWidth != null ? `${maxWidth}px` : "var(--gm-drawer-width)";
  const animDuration = (duration ?? 420);

  if (!mounted) return null;

  return (
    <>
      {/* ── 遮罩层 ── */}
      <div
        className="fixed inset-0"
        style={{
          zIndex: "var(--gm-z-float)",
          background: effectivelyOpen
            ? "var(--gm-drawer-backdrop)"
            : "rgba(0,0,0,0)",
          backdropFilter: effectivelyOpen
            ? "blur(var(--gm-drawer-backdrop-blur))"
            : "blur(0px)",
          WebkitBackdropFilter: effectivelyOpen
            ? "blur(var(--gm-drawer-backdrop-blur))"
            : "blur(0px)",
          transition: [
            `background ${animDuration}ms var(--gm-ease)`,
            `backdrop-filter ${animDuration}ms var(--gm-ease)`,
            `-webkit-backdrop-filter ${animDuration}ms var(--gm-ease)`,
          ].join(", "),
          pointerEvents: effectivelyOpen ? "auto" : "none",
        }}
        onClick={onClose}
        aria-hidden={!effectivelyOpen}
      />

      {/* ── 抽屉面板 ── */}
      <div
        ref={panelRef}
        className={`fixed ${edgeClass} top-0 flex w-full flex-col overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{
          zIndex: "var(--gm-z-nav)",
          height: "100dvh",
          maxWidth: panelMaxWidth,
          overflow: "hidden",
          background: "var(--gm-surface)",
          transform:
            willEnter || !effectivelyOpen
              ? offScreenTransform
              : "translateX(0)",
          transition: `transform ${animDuration}ms var(--gm-ease)`,
          boxShadow: "var(--gm-shadow-drawer)",
        }}
      >
        {children}
      </div>
    </>
  );
}

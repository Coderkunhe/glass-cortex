"use client";

import { useEffect, useRef } from "react";

/**
 * 可聚焦元素选择器。
 * 覆盖原生可聚焦元素 + 显式 tabindex（排除 tabindex="-1"）。
 */
const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), textarea:not([disabled]), " +
  "input:not([disabled]), select:not([disabled]), " +
  '[tabindex]:not([tabindex="-1"])';

/**
 * useFocusTrap 选项。
 */
export interface UseFocusTrapOptions {
  /**
   * 焦点陷阱是否激活。默认 true。
   * 动画阶段可设为 false 避免聚焦屏幕外元素。
   */
  enabled?: boolean;
  /**
   * 挂载时自动聚焦容器内第一个可聚焦元素。默认 true。
   */
  initialFocus?: boolean;
  /**
   * 卸载时恢复挂载前聚焦的元素。默认 true。
   */
  restoreFocus?: boolean;
  /**
   * 优先聚焦的选择器（如 "[autofocus]"），匹配则聚焦该元素。
   */
  autoFocusSelector?: string;
}

/**
 * useFocusTrap — 焦点陷阱 hook。
 *
 * 在容器元素内循环 Tab/Shift+Tab 焦点，防止键盘用户逃逸到背景页面。
 * WCAG 2.1 SC 2.4.3 Focus Order 合规。
 *
 * 每次按键重新查询可聚焦元素，支持动态增删的交互组件。
 * 容器内无可聚焦元素时，聚焦容器自身以保证 Escape 键仍可用。
 *
 * @param containerRef — 陷阱容器（Dialog / Drawer 面板）的 ref
 * @param options — 可选配置
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions = {},
): void {
  const {
    enabled = true,
    initialFocus = true,
    restoreFocus = true,
    autoFocusSelector,
  } = options;

  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ── 挂载/卸载：聚焦与恢复 ──
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // 保存当前焦点，供卸载时恢复
    if (restoreFocus && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    // 延迟聚焦 — 等 DOM 稳定（动画/条件渲染后的重排）
    const timer = setTimeout(() => {
      if (!initialFocus) return;

      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      // 优先聚焦 autoFocusSelector
      if (autoFocusSelector) {
        const preferred = currentContainer.querySelector<HTMLElement>(autoFocusSelector);
        if (preferred) {
          preferred.focus();
          return;
        }
      }

      // 其次聚焦第一个可聚焦元素
      const focusable = currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        // 无元素时聚焦容器自身（保证 Escape 仍可用）
        currentContainer.setAttribute("tabindex", "-1");
        currentContainer.focus({ preventScroll: true });
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      // 恢复焦点
      if (restoreFocus && previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 键盘陷阱：Tab / Shift+Tab 循环 ──
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) {
        // 无元素 — 阻止 Tab 逃逸，焦点留在容器上
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab — 从第一个元素往回跳到最后一个
        if (document.activeElement === first || document.activeElement === container) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab — 从最后一个元素往前跳到第一个
        if (document.activeElement === last || document.activeElement === container) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, containerRef]);
}

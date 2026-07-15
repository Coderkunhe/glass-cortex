"use client";

import { useEffect, useRef } from "react";
import { RiCloseLine, RiLoader4Line, RiAlertLine } from "@remixicon/react";
import ErrorDisplay from "@/components/ui/ErrorDisplay";

/**
 * ConfirmModal — 可复用的确认对话框组件。
 *
 * 替换浏览器原生 `window.confirm()`，提供统一的视觉风格、
 * 可定制的 danger 变体、loading/error 状态处理。
 * 视觉对标 ProfileModal：居中卡片 + backdrop blur + 圆角阴影。
 */
export interface ConfirmModalProps {
  /** 是否显示弹窗 */
  isOpen: boolean;
  /** 关闭回调（取消/遮罩/Esc 触发） */
  onClose: () => void;
  /** 确认回调 */
  onConfirm: () => void | Promise<void>;
  /** 弹窗标题 */
  title: string;
  /** 弹窗正文 */
  message: string;
  /** 确认按钮文案，默认 "确认删除" */
  confirmLabel?: string;
  /** 变体：danger（红色确认按钮）或 default */
  variant?: "danger" | "default";
  /** 确认操作进行中，禁用所有关闭入口 */
  isLoading?: boolean;
  /** 错误信息（字符串或 Error 对象），显示在按钮上方 */
  error?: string | Error | null;
}

/**
 * 居中确认对话框。
 *
 * 打开时自动聚焦确认按钮，Esc/遮罩/X 按钮均可关闭。
 * loading 期间所有关闭入口禁用，防止重复提交。
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "确认删除",
  variant = "default",
  isLoading = false,
  error = null,
}: ConfirmModalProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // 打开时自动聚焦确认按钮
  useEffect(() => {
    if (isOpen) {
      // 等一帧让 DOM 就位再聚焦
      const id = requestAnimationFrame(() => confirmBtnRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const isDanger = variant === "danger";

  // danger: 红色确认按钮样式; default: 品牌色
  const confirmBtnClass = isDanger
    ? "bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger/50"
    : "bg-brand text-text-inverse hover:bg-brand/90 focus-visible:ring-brand/50";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: "var(--gm-z-nav)" }}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
        onClick={() => {
          if (!isLoading) onClose();
        }}
        data-testid="confirm-modal-backdrop"
      />

      {/* 对话框 */}
      <div
        className="relative z-10 w-full max-w-sm mx-gm-4
                   bg-surface border border-border rounded-gm-lg
                   shadow-gm-lg animate-gm-fade-in"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between
                     px-gm-5 py-gm-4 border-b border-border"
        >
          <div className="flex items-center gap-gm-2">
            {isDanger && (
              <RiAlertLine className="w-5 h-5 text-danger" />
            )}
            <h2 className="text-gm-base font-semibold text-text">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-gm-1 rounded-gm-sm text-text-muted
                       hover:text-text hover:bg-surface-lowered
                       transition-colors disabled:opacity-40
                       focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
            aria-label="关闭"
          >
            <RiCloseLine className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-gm-5 py-gm-4">
          {/* 错误提示 */}
          {error && (
            <div className="mb-gm-3">
              <ErrorDisplay variant="inline" error={error} />
            </div>
          )}

          <p className="text-gm-sm text-text-secondary leading-relaxed">
            {message}
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-gm-2
                     px-gm-5 py-gm-4 border-t border-border"
        >
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-gm-sm px-gm-4 py-gm-2
                       text-gm-sm text-text-secondary
                       hover:text-text hover:bg-surface-lowered
                       transition-colors disabled:opacity-40
                       focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                       active:scale-[0.98]"
          >
            取消
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            disabled={isLoading}
            className={`rounded-gm-sm px-gm-4 py-gm-2
                       text-gm-sm font-medium
                       disabled:opacity-40 transition-colors
                       flex items-center gap-gm-1_5
                       focus-visible:ring-2 focus-visible:ring-offset-1
                       focus-visible:outline-none
                       ${confirmBtnClass}`}
          >
            {isLoading ? (
              <>
                <RiLoader4Line className="w-4 h-4 animate-spin" />
                处理中…
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

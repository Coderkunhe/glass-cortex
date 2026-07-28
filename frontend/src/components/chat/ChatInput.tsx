/**
 * ChatInput — 聊天输入区组件。
 *
 * 提供自动调高 textarea、Enter 发送/Shift+Enter 换行、发送中停止按钮。
 * 内部管理输入值和 textarea 高度自适应。
 *
 * @module components/chat/ChatInput
 */

"use client";

import { RiLoader4Line, RiSendPlaneFill, RiStopFill } from "@remixicon/react";
import { useState, useRef, useEffect, type KeyboardEvent } from "react";

/** ChatInput 组件的 props 契约 */
interface ChatInputProps {
  /** 用户提交消息时的回调 */
  onSend: (message: string) => void;
  /** 是否禁用输入（发送中为 true） */
  disabled?: boolean;
  /** 停止生成回调 — 提供后发送中显示停止按钮 */
  onAbort?: () => void;
  /** B136 — 流式输出是否启用 */
  streamEnabled?: boolean;
  /** B136 — 切换流式开关回调 */
  onToggleStream?: () => void;
}

const MAX_TEXTAREA_HEIGHT_PX = 200;

/** Chat input area with auto-resizing textarea, Enter-to-send, and disabled state. */
export default function ChatInput({ onSend, disabled = false, onAbort, streamEnabled = true, onToggleStream }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevHeightRef = useRef(0);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX);
    if (newHeight !== prevHeightRef.current) {
      prevHeightRef.current = newHeight;
      el.style.height = `${newHeight}px`;
    }
  }, [value]);

  /** Validates input, sends the message, and clears the textarea. */
  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  };

  /** Enter 发送，Shift+Enter 换行。与 ChatGPT/Claude 等主流 AI 聊天应用一致。 */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-gm-2 p-gm-2 sm:p-gm-3 border-t border-border bg-surface">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
        disabled={disabled}
        rows={2}
        aria-label="输入消息"
        className="flex-1 resize-none rounded-gm-md border border-border
                   bg-surface-elevated px-gm-2 sm:px-gm-3 py-gm-2
                   text-gm-sm sm:text-gm-base text-text placeholder:text-text-muted
                   hover:border-text-muted
                   focus:outline-none focus:ring-2 focus:ring-brand/50
                   disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {/* B136 — 流式开关：pill toggle，发送中禁用 */}
      {onToggleStream && (
        <label
          className={`shrink-0 inline-flex items-center gap-gm-2 cursor-pointer select-none
                     rounded-gm-full px-gm-2 py-gm-1_5
                     transition-colors
                     focus-within:ring-2 focus-within:ring-brand/50 focus-within:outline-none
                     ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-surface-alt"}`}
        >
          <span className="text-gm-xs text-text-muted font-medium">流式</span>
          {/* pill track */}
          <span
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors
                       ${streamEnabled ? "bg-brand" : "bg-text-muted/30"}`}
          >
            {/* knob */}
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-gm-sm transition-transform
                         ${streamEnabled ? "translate-x-[18px]" : "translate-x-[3px]"}`}
            />
          </span>
          <input
            type="checkbox"
            checked={streamEnabled}
            onChange={onToggleStream}
            disabled={disabled}
            className="sr-only"
            aria-label="流式输出开关"
          />
        </label>
      )}
      {disabled && onAbort ? (
        /* 发送中 → 显示停止按钮 */
        <button
          type="button"
          onClick={onAbort}
          className="shrink-0 rounded-gm-md bg-danger px-gm-4 py-gm-2
                     text-gm-sm text-white font-medium
                     hover:bg-danger-hover active:scale-[0.98]
                     focus-visible:ring-2 focus-visible:ring-danger/50 focus-visible:outline-none
                     transition-colors flex items-center gap-gm-1"
        >
          <RiStopFill />
          停止
        </button>
      ) : (
        /* 空闲态 → 发送按钮 */
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="shrink-0 rounded-gm-md bg-brand px-gm-4 py-gm-2
                     text-gm-sm text-text-inverse font-medium
                     hover:bg-brand-600 active:scale-[0.98]
                     focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                     disabled:opacity-50 disabled:cursor-wait transition-colors
                     flex items-center gap-gm-1"
        >
          {disabled ? (
            <>
              <RiLoader4Line className="animate-spin" />
              发送中…
            </>
          ) : (
            <>
              <RiSendPlaneFill />
              发送
            </>
          )}
        </button>
      )}
    </div>
  );
}

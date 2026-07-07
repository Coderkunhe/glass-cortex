"use client";

import { useState, useEffect, useRef } from "react";
import {
  RiCloseLine,
  RiLoader4Line,
  RiUserAddLine,
} from "@remixicon/react";
import ErrorDisplay from "@/components/ui/ErrorDisplay";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  creating: boolean;
  error: Error | string | null;
  onClearError: () => void;
}

/** 新建 Profile 模态窗 — 居中弹出，含名称输入 + 创建/取消操作。 */
export default function ProfileModal({
  isOpen,
  onClose,
  onCreate,
  creating,
  error,
  onClearError,
}: ProfileModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时自动聚焦 + 清空。setTimeout(…, 0) 在此处是合法的聚焦时序管理——
  // 不是取数反模式（对标 B89 / B108 消除模式），而是避免 React 同步 setState 警告 +
  // 等一帧让 DOM 就位后再聚焦 input。
  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => {
        setName("");
        onClearError();
        // 等一帧让 DOM 就位再聚焦
        requestAnimationFrame(() => inputRef.current?.focus());
      }, 0);
      return () => clearTimeout(id);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, creating, onClose]);

  if (!isOpen) return null;

  const trimmed = name.trim();

  const handleSubmit = async () => {
    if (!trimmed || creating) return;
    await onCreate(trimmed);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: "var(--gm-z-nav)" }}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
        onClick={() => {
          if (!creating) onClose();
        }}
      />

      {/* 对话框 */}
      <div
        className="relative z-10 w-full max-w-sm mx-gm-4
                   bg-surface border border-border rounded-gm-lg
                   shadow-gm-lg animate-gm-fade-in"
        role="dialog"
        aria-modal="true"
        aria-label="新建 Profile"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between
                     px-gm-5 py-gm-4 border-b border-border"
        >
          <div className="flex items-center gap-gm-2">
            <RiUserAddLine className="w-5 h-5 text-brand" />
            <h2 className="text-gm-base font-semibold text-text">
              新建 Profile
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="p-gm-1 rounded-gm-sm text-text-muted
                       hover:text-text hover:bg-surface-lowered
                       transition-colors disabled:opacity-40"
          >
            <RiCloseLine className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-gm-5 py-gm-4">
          {/* 错误提示 — 使用统一 ErrorDisplay */}
          {error && (
            <div className="mb-gm-3">
              <ErrorDisplay variant="inline" error={error} />
            </div>
          )}

          {/* 名称输入 */}
          <label className="block text-gm-sm font-medium text-text-secondary mb-gm-1_5">
            名称
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="输入 profile 名称…"
            disabled={creating}
            className="w-full rounded-gm-sm bg-surface-elevated
                       border border-border px-gm-3 py-gm-2
                       text-gm-sm text-text placeholder:text-text-muted
                       focus:outline-none focus:border-brand
                       disabled:opacity-50 transition-colors"
          />
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-gm-2
                     px-gm-5 py-gm-4 border-t border-border"
        >
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-gm-sm px-gm-4 py-gm-2
                       text-gm-sm text-text-secondary
                       hover:text-text hover:bg-surface-lowered
                       transition-colors disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={creating || !trimmed}
            className="rounded-gm-sm bg-brand px-gm-4 py-gm-2
                       text-gm-sm font-medium text-text-inverse
                       hover:bg-brand/90 disabled:opacity-40
                       transition-colors flex items-center gap-gm-1_5"
          >
            {creating ? (
              <>
                <RiLoader4Line className="w-4 h-4 animate-spin" />
                创建中…
              </>
            ) : (
              "创建"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

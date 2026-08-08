"use client";

/**
 * PasswordGate — Admin 面板密码门禁。
 *
 * 密码从 NEXT_PUBLIC_ADMIN_PASSWORD 环境变量读取，默认 Coder@9527。
 * 认证通过后调用 onSuccess，认证状态由调用方（AdminShell）通过 sessionStorage 管理。
 *
 * @module components/admin/PasswordGate
 */

import { useState, useCallback } from "react";
import { RiLockLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";

/** 默认密码（环境变量未设置时） */
const DEFAULT_PASSWORD = "Coder@9527";

/** 获取配置的 Admin 密码 */
function getAdminPassword(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ADMIN_PASSWORD) {
    return process.env.NEXT_PUBLIC_ADMIN_PASSWORD;
  }
  return DEFAULT_PASSWORD;
}

export default function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [shaking, setShaking] = useState(false);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (input === getAdminPassword()) {
      onSuccess();
    } else {
      setError(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  }, [input, onSuccess]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-lowered">
      <div className={`w-full max-w-sm mx-gm-4 rounded-gm-xl bg-surface-elevated border border-border shadow-gm-lg p-gm-8 ${shaking ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
        {/* Logo + 标题 */}
        <div className="text-center mb-gm-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-gm-xl bg-brand-50 mb-gm-3">
            <RiLockLine className="text-gm-xl text-brand" />
          </div>
          <h1 className="text-gm-lg font-semibold text-text">AI 工程协作管理面板</h1>
          <p className="text-gm-xs text-text-muted mt-gm-1">请输入管理密码以继续</p>
        </div>

        {/* 密码表单 */}
        <form onSubmit={handleSubmit} className="space-y-gm-3">
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              placeholder="输入密码"
              autoFocus
              className={`w-full rounded-gm-md border bg-surface-lowered px-gm-4 py-gm-2 pr-gm-10 text-gm-sm text-text placeholder:text-text-muted/50 outline-none transition-colors focus:ring-2 focus:ring-brand/40 ${
                error ? "border-red-500 bg-red-50/30" : "border-border focus:border-brand"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-gm-2 top-1/2 -translate-y-1/2 p-gm-1 text-text-muted hover:text-text-secondary transition-colors"
              aria-label={showPw ? "隐藏密码" : "显示密码"}
            >
              {showPw ? <RiEyeOffLine className="text-gm-icon" /> : <RiEyeLine className="text-gm-icon" />}
            </button>
          </div>
          {error && (
            <p className="text-gm-xs text-red-500 animate-[fadeIn_0.2s_ease-in-out]">密码错误，请重试</p>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-full rounded-gm-md bg-brand text-white text-gm-sm font-medium py-gm-2 transition-all hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            进入工程
          </button>
        </form>
      </div>

      {/* 抖动关键帧 */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(4px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

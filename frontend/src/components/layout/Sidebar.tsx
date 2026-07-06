"use client";

import { useState, useEffect, useCallback } from "react";
import ErrorDisplay from "@/components/ui/ErrorDisplay";
import {
  RiAlertLine,
  RiRefreshLine,
  RiCheckLine,
  RiCloseLine,
} from "@remixicon/react";
import { useParamState, useSessionStats } from "@/components/chat/ChatParamsContext";
import ParamSliders from "@/components/chat/ParamSliders";
import ProfileCard from "@/components/shared/ProfileCard";
import SessionHarvest from "@/components/chat/SessionHarvest";
import SidebarReflectionCard from "@/components/layout/SidebarReflectionCard";
import SessionTokenGauge from "@/components/layout/SessionTokenGauge";
import ModelRoutingCard from "@/components/layout/ModelRoutingCard";
import ParamReplay from "@/components/chat/ParamReplay";
import { api } from "@/lib/api/client";

/**
 * 全局侧边栏——会话收获 + 认知参数 + 参数推演 + 重置 + Profile + 系统状态。
 * 大屏显示，小屏隐藏。
 * Batch 162：集成 SessionHarvest、ParamReplay、一键重置流程。
 */
export default function Sidebar() {
  const { l2, l3, l5, l6, setL2, setL3, setL5, setL6, resetToDefaults } =
    useParamState();
  const { stats } = useSessionStats();

  // 衰减触发 — 本地状态，不入 Context
  const [decayStatus, setDecayStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [decayMessage, setDecayMessage] = useState<unknown>("");

  // 重置流程 — 本地状态机 (162.3)
  const [resetPhase, setResetPhase] = useState<
    "idle" | "confirm" | "loading" | "success" | "error"
  >("idle");
  const [resetError, setResetError] = useState<unknown>("");

  const handleTriggerDecay = useCallback(async () => {
    setDecayStatus("loading");
    try {
      const result = await api.triggerDecay({ lambda_override: l6.lambda });
      setDecayStatus("success");
      setDecayMessage(`已衰减 ${result.items_decayed} 条记忆`);
    } catch (err) {
      setDecayStatus("error");
      setDecayMessage(err);
    }
  }, [l6.lambda]);

  // 重置流程回调 (162.3)
  const handleReset = useCallback(async () => {
    setResetPhase("loading");
    setResetError("");
    try {
      await api.resetSession();
      setResetPhase("success");
      resetToDefaults();
    } catch (err) {
      setResetPhase("error");
      setResetError(err);
    }
  }, [resetToDefaults]);

  // 会话时长 — 每秒刷新
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - stats.sessionStart) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [stats.sessionStart]);

  const durMin = Math.floor(elapsed / 60);
  const durSec = elapsed % 60;
  const durStr =
    elapsed < 60 ? `${elapsed}秒` : `${durMin}分${durSec}秒`;

  return (
    <aside
      className="flex flex-col h-full
                 border-r border-border
                 bg-surface-lowered
                 p-gm-4 gap-gm-3 overflow-y-auto"
    >
      {/* ════════════════════════════════════════════
          层1 身份 — 你是谁
          ════════════════════════════════════════════ */}
      <ProfileCard />

      <hr className="border-border my-0" />

      {/* ════════════════════════════════════════════
          层2 状态 — 会话进行得怎样了
          ════════════════════════════════════════════ */}
      {/* ── L1 会话统计 ── */}
      <div className="shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3">
        <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium mb-gm-2">
          本次会话
        </p>
        <div className="grid grid-cols-2 gap-gm-2 mb-gm-2">
          <div className="text-center rounded-gm-xs bg-surface-lowered p-gm-2">
            <p className="text-gm-xl font-bold text-text tabular-nums">
              {stats.messageCount}
            </p>
            <p className="text-gm-xs text-text-muted">消息数</p>
          </div>
          <div className="text-center rounded-gm-xs bg-surface-lowered p-gm-2">
            <p className="text-gm-xl font-bold text-text tabular-nums">
              {stats.memoryCount}
            </p>
            <p className="text-gm-xs text-text-muted">本次召回</p>
          </div>
        </div>
        <p className="text-gm-xs text-text-muted text-center">
          ⏱ 会话时长：{durStr}
        </p>
      </div>

      {/* ── 会话 Token 油表 (Phase 38 Batch 6) ── */}
      <SessionTokenGauge />

      <hr className="border-border my-0" />

      {/* ════════════════════════════════════════════
          层3 认知 — 模型怎么想
          ════════════════════════════════════════════ */}
      {/* ── 模型路由 (Phase 55 Batch 4) ── */}
      <ModelRoutingCard />

      {/* ── 规划反思 (Phase 37 Batch 7) ── */}
      <SidebarReflectionCard />

      <hr className="border-border my-0" />

      {/* ════════════════════════════════════════════
          层4 收获 — 这次学到了什么
          ════════════════════════════════════════════ */}
      {/* ── 会话收获 + 记忆召回 (162.1 + 162.2) ── */}
      <SessionHarvest />

      <hr className="border-border my-0" />

      {/* ════════════════════════════════════════════
          层5 调节 — 我能调什么参数
          ════════════════════════════════════════════ */}
      {/* ── L2 + L3 认知参数 ── */}
      <div className="shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3">
        <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium mb-gm-1">
          认知参数
        </p>
        <ParamSliders
          l2={l2} l3={l3} l5={l5} l6={l6}
          onL2Change={setL2} onL3Change={setL3}
          onL5Change={setL5} onL6Change={setL6}
          onTriggerDecay={handleTriggerDecay}
        />
        {decayStatus === "success" && (
          <p className="text-gm-xs mt-gm-2 text-center text-success">
            {String(decayMessage)}
          </p>
        )}
        {decayStatus === "loading" && (
          <p className="text-gm-xs mt-gm-2 text-center text-text-muted">
            触发中...
          </p>
        )}
        {decayStatus === "error" && (
          <div className="mt-gm-2">
            <ErrorDisplay variant="inline" error={decayMessage} />
          </div>
        )}
      </div>

      {/* ── 参数推演 (162.4) —— 基于当前参数值的投影 ── */}
      <ParamReplay />

      <hr className="border-border my-0" />

      {/* ════════════════════════════════════════════
          层6 管理 — 危险操作，谨慎
          ════════════════════════════════════════════ */}
      {/* ── 一键重置 (162.3) —— 2-phase 确认 + API 调用 ── */}
      <div className="shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3">
        <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium mb-gm-2">
          重置数据
        </p>

        {/* idle：常规按钮 */}
        {resetPhase === "idle" && (
          <button
            type="button"
            onClick={() => setResetPhase("confirm")}
            className="w-full flex items-center justify-center gap-gm-2
                       rounded-gm-xs bg-danger/10 hover:bg-danger/20
                       border border-danger/30
                       px-gm-3 py-gm-1_5 text-gm-xs font-medium
                       text-danger transition-colors
                       focus-visible:ring-2 focus-visible:ring-danger/50 focus-visible:outline-none"
          >
            <RiAlertLine size={14} />
            清空所有数据
          </button>
        )}

        {/* confirm：二次确认 */}
        {resetPhase === "confirm" && (
          <div className="text-center">
            <p className="text-gm-xs text-danger font-semibold mb-gm-2">
              确认清空？此操作不可撤销
            </p>
            <div className="flex gap-gm-2">
              <button
                type="button"
                onClick={handleReset}
                className="flex-1 rounded-gm-xs bg-danger hover:bg-danger/80
                           px-gm-2 py-gm-1_5 text-gm-xs font-semibold
                           text-text-inverse transition-colors
                           focus-visible:ring-2 focus-visible:ring-danger/50 focus-visible:outline-none"
              >
                确认重置
              </button>
              <button
                type="button"
                onClick={() => setResetPhase("idle")}
                className="flex-1 rounded-gm-xs bg-surface-lowered
                           hover:bg-surface border border-border
                           px-gm-2 py-gm-1_5 text-gm-xs
                           text-text-secondary transition-colors
                           focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* loading */}
        {resetPhase === "loading" && (
          <div className="flex items-center justify-center gap-gm-2 text-text-muted">
            <RiRefreshLine size={14} className="animate-spin" />
            <span className="text-gm-xs">重置中…</span>
          </div>
        )}

        {/* success */}
        {resetPhase === "success" && (
          <div className="flex items-center gap-gm-2 text-success">
            <RiCheckLine size={14} />
            <span className="text-gm-xs">已重置 — 所有数据已清空</span>
            <button
              type="button"
              onClick={() => setResetPhase("idle")}
              className="ml-auto text-text-muted hover:text-text transition-colors
                         focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
              aria-label="关闭"
            >
              <RiCloseLine size={12} />
            </button>
          </div>
        )}

        {/* error */}
        {resetPhase === "error" && (
          <div className="space-y-gm-2">
            <ErrorDisplay variant="inline" error={resetError} />
            <button
              type="button"
              onClick={() => setResetPhase("idle")}
              className="w-full rounded-gm-xs bg-surface-lowered
                         hover:bg-surface border border-border
                         px-gm-2 py-gm-1_5 text-gm-xs
                         text-text-secondary transition-colors
                         focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
            >
              关闭
            </button>
          </div>
        )}
      </div>

      <hr className="border-border my-0" />

      {/* ════════════════════════════════════════════
          层7 系统 — 基础设施健康
          ════════════════════════════════════════════ */}
      {/* ── 系统状态 ── */}
      <div className="mt-auto shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3">
        <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium mb-gm-2">
          系统状态
        </p>
        {/* API 连接指示灯 */}
        <div className="flex items-center gap-gm-2">
          <span
            className="inline-block w-2 h-2 rounded-full bg-success shadow-[0_0_8px_var(--gm-success-glow)]"
          />
          <span className="text-gm-sm text-text-secondary">DeepSeek API</span>
          <span className="ml-auto text-gm-xs text-text-muted">已连接</span>
        </div>
      </div>
    </aside>
  );
}

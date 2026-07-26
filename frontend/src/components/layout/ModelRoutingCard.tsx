"use client";

/**
 * ModelRoutingCard — Sidebar 模型路由状态卡片（Phase 55 Batch 4）。
 *
 * 展示最近一次聊天响应的路由决策：哪个模型被选中、为什么、
 * 是否触发回退。同时提供模型手动 override 下拉选择器。
 *
 * @module components/layout/ModelRoutingCard
 */

import { useModelRouting } from "@/components/chat/ChatParamsContext";
import {
  RiRobot2Line,
  RiArrowGoBackLine,
  RiCheckLine,
  RiRouteLine,
} from "@remixicon/react";
import { L5_MODEL_OPTIONS } from "@/lib/chatParams";

/** 模型显示名称映射 */
const MODEL_LABELS: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

/** 复杂度显示标签 */
const COMPLEXITY_LABELS: Record<string, string> = {
  simple: "简单任务",
  complex: "复杂任务",
};

/**
 * 路由状态卡片——Sidebar 中使用。
 * 读取 ChatParamsContext 中的 lastRouting 和 routingOverrideModel。
 */
export default function ModelRoutingCard() {
  const { lastRouting, routingOverrideModel, setRoutingOverrideModel } =
    useModelRouting();

  const hasRouting = lastRouting !== null;
  const isOverride = routingOverrideModel !== null;
  const effectiveModel = isOverride
    ? routingOverrideModel
    : hasRouting
      ? lastRouting.model
      : null;

  return (
    <div className="shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3">
      <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium mb-gm-2">
        模型路由
      </p>

      {/* ── 当前生效模型 ── */}
      <div className="flex items-center gap-gm-2 mb-gm-2">
        <RiRobot2Line size={14} className="text-brand shrink-0" />
        <span className="text-gm-sm font-medium text-text truncate">
          {effectiveModel
            ? (MODEL_LABELS[effectiveModel] ?? effectiveModel)
            : "等待首条消息"}
        </span>
        {isOverride && (
          <span className="text-gm-xs text-amber bg-amber/10 px-gm-1.5 py-px rounded-gm-xs shrink-0">
            手动
          </span>
        )}
        {hasRouting && !isOverride && (
          <span className="text-gm-xs text-brand bg-brand/10 px-gm-1.5 py-px rounded-gm-xs shrink-0">
            自动
          </span>
        )}
      </div>

      {/* ── 路由理由 ── */}
      {hasRouting && !isOverride && (
        <p className="text-gm-xs text-text-secondary leading-relaxed mb-gm-2">
          {lastRouting.reason}
          {lastRouting.complexity && (
            <span className="ml-gm-1 inline-block text-gm-xs text-text-muted bg-surface-lowered px-gm-1 rounded-gm-xs">
              {COMPLEXITY_LABELS[lastRouting.complexity] ?? lastRouting.complexity}
            </span>
          )}
        </p>
      )}

      {/* ── 回退指示 ── */}
      {hasRouting && lastRouting.fallback_triggered && (
        <div className="flex items-center gap-gm-1.5 mb-gm-2 text-gm-xs text-amber">
          <RiArrowGoBackLine size={12} />
          <span>
            主模型失败，已回退到{" "}
            {MODEL_LABELS[lastRouting.model] ?? lastRouting.model}
          </span>
        </div>
      )}

      {hasRouting && !lastRouting.fallback_triggered && lastRouting.attempts === 1 && (
        <div className="flex items-center gap-gm-1.5 mb-gm-2 text-gm-xs text-success">
          <RiCheckLine size={12} />
          <span>主模型响应正常</span>
        </div>
      )}

      {/* ── 无路由信息 ── */}
      {!hasRouting && !isOverride && (
        <div className="flex items-center gap-gm-1.5 mb-gm-2 text-gm-xs text-text-muted">
          <RiRouteLine size={12} />
          <span>路由未启用或等待首条消息</span>
        </div>
      )}

      {/* ── 模型手动 override 下拉 ── */}
      <div className="border-t border-border pt-gm-2 mt-gm-1">
        <label className="text-gm-xs text-text-muted block mb-gm-1">
          覆盖模型
        </label>
        <select
          value={routingOverrideModel ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setRoutingOverrideModel(val || null);
          }}
          className="w-full rounded-gm-xs bg-surface-lowered border border-border
                     px-gm-2 py-gm-1 text-gm-xs text-text
                     focus:outline-none focus:ring-1 focus:ring-brand
                     appearance-none cursor-pointer"
        >
          <option value="">自动路由（默认）</option>
          {L5_MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m] ?? m}
            </option>
          ))}
        </select>
        {isOverride && (
          <p className="text-gm-xs text-text-muted mt-gm-1">
            使用 {MODEL_LABELS[routingOverrideModel!] ?? routingOverrideModel}
            ，绕过自动路由
          </p>
        )}
      </div>
    </div>
  );
}

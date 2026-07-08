/**
 * SessionTokenGauge — 会话级 Token 油表（Sidebar 触点）。
 *
 * 油表隐喻：圆环 gauge 显示本次会话累计 token / 预算上限（默认 100k），
 * 绿（<60%）→ 黄（60-85%）→ 红（>85%）渐变。下方 KV 行展示输入/输出比、
 * 估算金额、avg per turn。
 *
 * 数据来源：`stats.sessionTokens`（由 ChatPanel 从各轮 `api_trace.token_breakdown`
 * 聚合后经 `setSessionTokens` 推入 ChatParamsContext——镜像 `setMemoryCount` 范式）。
 * 不读 `api.getTokens()`：该端点是进程级累计，非会话级。源头是 `messages` ⇒
 * 清空聊天自然归零（无独立累加器，避免失同步）。
 *
 * 无 token 消耗时渲染静默占位，保持 Sidebar 卡片槽位稳定。
 *
 * @module components/layout/SessionTokenGauge
 */

"use client";

import { useState } from "react";
import type { TokenBreakdown } from "@/components/chat/TokenCostBadge";
import { formatCost } from "@/components/chat/TokenCostBadge";
import { useSessionStats } from "@/components/chat/ChatParamsContext";

/** 会话 token 预算上限——油表满刻度（100k token）。 */
const SESSION_TOKEN_BUDGET = 100_000;

/** 圆环周长（r=40, viewBox 100×100）。 */
const RING_CIRCUMFERENCE = 2 * Math.PI * 40;

/** 三调用点——镜像 api/routers/chat.py 注入结构。 */
const CALL_POINTS = ["chat", "intent", "fact_extraction"] as const;

/** 会话聚合结果。 */
export interface SessionTokenAggregate {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  cost: number;
  hasPricing: boolean;
  turns: number;
}

/**
 * aggregateBreakdowns — 跨多轮 token_breakdown 聚合会话累计。
 *
 * 各轮的 chat/intent/fact_extraction 三调用点分别累加 prompt_tokens/completion_tokens；
 * `pricing` 取最新一份（后端 config 派生，全会话稳定）。轮数仅计有实际 token 的轮。
 * 纯函数，供 ChatPanel 派生 + 本组件测试复用。
 */
export function aggregateBreakdowns(breakdowns: TokenBreakdown[]): SessionTokenAggregate {
  let totalInput = 0;
  let totalOutput = 0;
  let turns = 0;
  let pricing: TokenBreakdown["pricing"] | undefined;

  for (const b of breakdowns) {
    if (!b) continue;
    let turnHasTokens = false;
    for (const key of CALL_POINTS) {
      const entry = b[key];
      if (entry) {
        const p = entry.prompt_tokens || 0;
        const c = entry.completion_tokens || 0;
        totalInput += p;
        totalOutput += c;
        if (p > 0 || c > 0) turnHasTokens = true;
      }
    }
    if (turnHasTokens) turns++;
    if (b.pricing) pricing = b.pricing;
  }

  const totalTokens = totalInput + totalOutput;
  const hasPricing =
    !!pricing && (pricing.input_per_1m > 0 || pricing.output_per_1m > 0);
  let cost = 0;
  if (hasPricing && pricing) {
    cost =
      (totalInput * pricing.input_per_1m +
        totalOutput * pricing.output_per_1m) /
      1_000_000;
  }
  return { totalInput, totalOutput, totalTokens, cost, hasPricing, turns };
}

/**
 * 按 pct 选油表环色：<60% 绿、60-85% 黄、>85% 红。
 * 返回 CSS var 字符串，inline 应用以适配动态阈值。
 */
function ringColorVar(pct: number): string {
  if (pct < 0.6) return "var(--gm-success)";
  if (pct < 0.85) return "var(--gm-warning)";
  return "var(--gm-danger)";
}

/** 紧凑格式化 token 数：<1k 原值，>=10k 整数 k，否则 1 位小数 k。 */
function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  const k = n / 1000;
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}

/** 油表 variant（供测试断言颜色档位）。 */
function variantOf(pct: number): "success" | "warning" | "danger" {
  if (pct < 0.6) return "success";
  if (pct < 0.85) return "warning";
  return "danger";
}

/**
 * SessionTokenGauge — 从 ChatParamsContext 读取会话 token 累计并渲染油表。
 *
 * 无 props：自取 `stats.sessionTokens`，与 Sidebar 其它会话级卡片同源。
 */
export default function SessionTokenGauge() {
  const { stats } = useSessionStats();
  const { input, output, turns, cost, hasPricing } = stats.sessionTokens;
  const total = input + output;

  // ── 即时 tooltip state — 替代原生 title 1-2s 延迟 ──
  const [pricingTip, setPricingTip] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // 空态：尚无 token 消耗——静默占位，保持卡片槽位稳定
  if (total === 0) {
    return (
      <div
        className="shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3"
        data-testid="session-token-gauge"
        data-variant="empty"
      >
        <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium mb-gm-2">
          会话 Token
        </p>
        <p
          className="text-gm-xs text-text-muted text-center py-gm-1"
          data-testid="session-token-gauge-empty"
        >
          尚无 token 消耗
        </p>
      </div>
    );
  }

  const pct = Math.min(total / SESSION_TOKEN_BUDGET, 1);
  const pctPct = Math.round(pct * 100);
  const dash = pct * RING_CIRCUMFERENCE;
  const colorVar = ringColorVar(pct);
  const variant = variantOf(pct);
  const avgPerTurn = turns > 0 ? Math.round(total / turns) : total;

  return (
    <div
      className="shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3"
      data-testid="session-token-gauge"
      data-variant={variant}
    >
      <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium mb-gm-2">
        会话 Token
      </p>

      {/* ── 油表圆环 ── */}
      <div className="relative mx-auto mb-gm-2" style={{ width: 96, height: 96 }}>
        <svg
          width={96}
          height={96}
          viewBox="0 0 100 100"
          data-testid="session-token-gauge-ring"
        >
          {/* 轨道 */}
          <circle
            cx={50}
            cy={50}
            r={40}
            fill="none"
            stroke="var(--gm-border)"
            strokeWidth={8}
          />
          {/* 进度（从顶部起，顺时针） */}
          <circle
            cx={50}
            cy={50}
            r={40}
            fill="none"
            stroke={colorVar}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${RING_CIRCUMFERENCE}`}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p
            className="text-gm-sm font-bold tabular-nums leading-none"
            style={{ color: colorVar }}
            data-testid="session-token-gauge-total"
          >
            {formatTokens(total)}
          </p>
          <p className="text-gm-xs text-text-muted tabular-nums leading-tight">
            / {formatTokens(SESSION_TOKEN_BUDGET)} · {pctPct}%
          </p>
        </div>
      </div>

      {/* ── KV 行 ── */}
      <div className="grid grid-cols-2 gap-gm-1_5 text-gm-xs">
        <div
          className="flex items-center justify-between rounded-gm-xs bg-surface-lowered px-gm-2 py-gm-1"
          data-testid="session-token-gauge-io"
        >
          <span className="text-text-muted">输入</span>
          <span className="tabular-nums text-text-secondary">
            {formatTokens(input)}
          </span>
        </div>
        <div className="flex items-center justify-between rounded-gm-xs bg-surface-lowered px-gm-2 py-gm-1">
          <span className="text-text-muted">输出</span>
          <span className="tabular-nums text-text-secondary">
            {formatTokens(output)}
          </span>
        </div>
        <div
          className="flex items-center justify-between rounded-gm-xs bg-surface-lowered px-gm-2 py-gm-1"
          data-testid="session-token-gauge-cost"
        >
          <span className="text-text-muted">
            估算
            {!hasPricing && total > 0 && (
              <span
                className="ml-gm-1 text-gm-2xs text-warning cursor-help"
                onMouseEnter={(e) =>
                  setPricingTip({ x: e.clientX, y: e.clientY })
                }
                onMouseMove={(e) =>
                  setPricingTip((prev) =>
                    prev ? { x: e.clientX, y: e.clientY } : null,
                  )
                }
                onMouseLeave={() => setPricingTip(null)}
              >
                ⚠
              </span>
            )}
          </span>
          <span className="tabular-nums text-text-secondary">
            {formatCost(cost)}
          </span>
        </div>
        <div
          className="flex items-center justify-between rounded-gm-xs bg-surface-lowered px-gm-2 py-gm-1"
          data-testid="session-token-gauge-avg"
        >
          <span className="text-text-muted">每轮</span>
          <span className="tabular-nums text-text-secondary">
            {formatTokens(avgPerTurn)}
          </span>
        </div>
      </div>

      {/* turns 暴露给测试 */}
      <span className="hidden" data-testid="session-token-gauge-turns">
        {turns}
      </span>

      {/* 即时 tooltip — 替代原生 title 延迟 */}
      {pricingTip && (
        <div
          className="fixed z-50 pointer-events-none rounded-gm-sm bg-gray-900 px-gm-2 py-gm-1 text-gm-xs text-white shadow-gm-md dark:bg-gray-100 dark:text-gray-900"
          style={{
            left: pricingTip.x + 12,
            top: pricingTip.y - 8,
          }}
        >
          无有效定价数据，成本为 0
        </div>
      )}
    </div>
  );
}

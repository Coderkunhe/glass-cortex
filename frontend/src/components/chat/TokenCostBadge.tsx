/**
 * TokenCostBadge — 单条消息的实际 Token 成本标签。
 *
 * 从 api_trace.token_breakdown（Phase 38 Batch 1 注入的 extras 字段）读取
 * 各调用点（chat / intent / fact_extraction）的实际 token 消耗，
 * 按配置的输入/输出定价计算本轮估算成本并以内联 pill 展示。
 *
 * 无 token_breakdown 或 token 总量为零时静默返回 null（不渲染空壳）。
 *
 * @module components/chat/TokenCostBadge
 */

"use client";

import { useState } from "react";
import { fmtTokens } from "@/lib/formatNum";

/** 单调用点的 token 用量（镜像 api/routers/chat.py 注入结构） */
interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

/** api_trace.token_breakdown 的类型（Phase 38 Batch 1 注入） */
export interface TokenBreakdown {
  chat?: TokenUsage;
  intent?: TokenUsage;
  fact_extraction?: TokenUsage;
  pricing?: {
    input_per_1m: number;
    output_per_1m: number;
  };
}

/**
 * 汇总所有调用点的输入/输出 token，计算总成本和总 token 数。
 *
 * 各调用点独立存在（intent / fact_extraction 可选），
 * 分别累加 prompt_tokens 和 completion_tokens 后按定价折算。
 */
function computeCost(breakdown: TokenBreakdown): {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  cost: number;
  hasPricing: boolean;
} {
  let totalInput = 0;
  let totalOutput = 0;

  for (const key of ["chat", "intent", "fact_extraction"] as const) {
    const entry = breakdown[key];
    if (entry) {
      totalInput += entry.prompt_tokens || 0;
      totalOutput += entry.completion_tokens || 0;
    }
  }

  const totalTokens = totalInput + totalOutput;
  const pricing = breakdown.pricing;
  const hasPricing = !!pricing && (pricing.input_per_1m > 0 || pricing.output_per_1m > 0);

  let cost = 0;
  if (hasPricing && pricing) {
    cost =
      (totalInput * pricing.input_per_1m +
        totalOutput * pricing.output_per_1m) /
      1_000_000;
  }

  return { totalInput, totalOutput, totalTokens, cost, hasPricing };
}

/**
 * 格式化金额字符串。
 *
 * 策略：
 * - cost = 0 → "¥0"
 * - cost < 0.001 → "≈¥0.0003"（4 位小数，确保极小值可见）
 * - cost < 0.01 → "≈¥0.002"（3 位小数）
 * - cost ≥ 0.01 → "≈¥0.05"（2 位小数）
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "¥0";
  if (cost < 0.001) return `≈¥${cost.toFixed(4)}`;
  if (cost < 0.01) return `≈¥${cost.toFixed(3)}`;
  return `≈¥${cost.toFixed(2)}`;
}

export default function TokenCostBadge({
  tokenBreakdown,
}: {
  tokenBreakdown?: TokenBreakdown;
}) {
  // ── 即时 tooltip state — 替代原生 title 1-2s 延迟 ──
  // 必须在所有 early return 之前声明，满足 Rules of Hooks
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  if (!tokenBreakdown) return null;

  const { totalInput, totalOutput, totalTokens, cost, hasPricing } =
    computeCost(tokenBreakdown);

  // 零 token 不渲染（空壳无意义）
  if (totalTokens === 0) return null;

  const tooltipLines: string[] = [];
  if (hasPricing) {
    tooltipLines.push(`输入 ${totalInput.toLocaleString()} · 输出 ${totalOutput.toLocaleString()} token`);
    tooltipLines.push(`合计 ${totalTokens.toLocaleString()} token · 估算成本 ${formatCost(cost)}`);
  } else {
    tooltipLines.push(`输入 ${totalInput.toLocaleString()} · 输出 ${totalOutput.toLocaleString()} token`);
    tooltipLines.push(`合计 ${totalTokens.toLocaleString()} token`);
  }

  const tooltipText = tooltipLines.join("\n");

  return (
    <>
      <span
        role="status"
        aria-label="Token 成本"
        className="inline-flex items-center gap-gm-1 text-gm-xs text-text-muted select-none"
        data-testid="token-cost-badge"
        onMouseEnter={(e) =>
          setTooltip({ x: e.clientX, y: e.clientY, text: tooltipText })
        }
        onMouseMove={(e) =>
          setTooltip((prev) =>
            prev ? { ...prev, x: e.clientX, y: e.clientY } : null,
          )
        }
        onMouseLeave={() => setTooltip(null)}
      >
        {hasPricing && (
          <span className="tabular-nums" data-testid="token-cost-amount">
            {formatCost(cost)}
          </span>
        )}
        <span className="tabular-nums" data-testid="token-cost-count">
          {fmtTokens(totalTokens)} token
        </span>
      </span>

      {/* 即时 tooltip — 替代原生 title 延迟 */}
      {tooltip && (
        <div
          className="fixed z-50 rounded-gm-sm border border-border-strong
                     bg-surface-elevated px-gm-2.5 py-gm-1.5
                     shadow-gm-md pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 8,
          }}
        >
          {tooltip.text.split("\n").map((line, i) => (
            <p key={i} className="text-gm-xs text-text whitespace-nowrap">
              {line}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

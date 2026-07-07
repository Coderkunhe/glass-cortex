"use client";

import { useState } from "react";
import type { ContextMeta } from "@/lib/api/types";

interface ContextHealthBadgeProps {
  meta: ContextMeta;
}

/** 根据用量比返回健康等级 */
function healthLevel(usagePct: number): { label: string; color: string; advice: string } {
  if (usagePct < 50) {
    return {
      label: "充裕",
      color: "bg-success",
      advice: "上下文空间充足，可放心扩展对话。",
    };
  }
  if (usagePct < 80) {
    return {
      label: "适中",
      color: "bg-warning",
      advice: "上下文使用过半，注意控制对话长度或调高窗口。",
    };
  }
  return {
    label: "紧张",
    color: "bg-danger",
    advice: "上下文接近满载，推荐启用溢出策略或增大窗口。",
  };
}

/** 上下文健康状态徽章 — 紧凑指示灯 + hover tooltip。
 *
 * 从 context_meta.usage_pct 推导健康等级，
 * 绿色(<50%) / 黄色(50-80%) / 红色(>80%)。
 */
export default function ContextHealthBadge({ meta }: ContextHealthBadgeProps) {
  const { usage_pct } = meta;
  const { label, color, advice } = healthLevel(usage_pct);

  // ── 即时 tooltip state — 替代原生 title 1-2s 延迟 ──
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const tooltipText = `${label}（${usage_pct}%）— ${advice}`;

  return (
    <>
      <span
        role="status"
        aria-label="上下文健康状态"
        className="inline-flex items-center gap-gm-1 cursor-help"
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
        <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
        <span className="text-gm-xs text-text-muted">{label}</span>
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
          <p className="text-gm-xs text-text whitespace-nowrap">
            {tooltip.text}
          </p>
        </div>
      )}
    </>
  );
}

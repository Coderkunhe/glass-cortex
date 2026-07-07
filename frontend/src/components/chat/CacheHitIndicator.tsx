/**
 * CacheHitIndicator — 语义缓存命中指示器。
 *
 * 当 ChatResponse.from_cache === true 时显示绿色闪电图标 +
 * "缓存命中 · 相似度 97%" 文案，让用户感知响应来源（绕过 LLM 全管线）。
 *
 * @module components/chat/CacheHitIndicator
 */

"use client";

import { useState } from "react";

export default function CacheHitIndicator({
  similarity,
}: {
  similarity: number;
}) {
  const pct = Math.round(similarity * 100);

  // ── 即时 tooltip state — 替代原生 title 1-2s 延迟 ──
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const tooltipText = `语义缓存命中 — 与历史查询的相似度为 ${pct}%`;

  return (
    <>
      <span
        role="status"
        aria-label="缓存命中指示器"
        className="inline-flex items-center gap-gm-1 text-gm-xs text-success select-none"
        data-testid="cache-hit-indicator"
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
        <i
          className="ri-flashlight-line text-gm-icon"
        />
        <span>缓存命中 · 相似度 {pct}%</span>
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

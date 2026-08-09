/**
 * L5TimelineDetail — L5 拉通时间线钻取面板。
 *
 * 纯展示组件 — 数据由父组件 HealthPanel 通过 props 传入。
 * 垂直线性时间轴展示 L5 审查历史（从 requirements-log.md 提取）。
 *
 * @module components/admin/L5TimelineDetail
 */

import { RiCheckDoubleLine, RiArrowRightLine } from "@remixicon/react";
import type { L5HistoryEntry } from "@/lib/api/types";

// ── Props ──────────────────────────────────────────────────────────────

interface L5TimelineDetailProps {
  history: L5HistoryEntry[] | undefined;
}

// ═══════════════════════════════════════════════════════════════════════
// L5TimelineDetail
// ═══════════════════════════════════════════════════════════════════════

export default function L5TimelineDetail({ history }: L5TimelineDetailProps) {
  // ── 加载态：history === undefined（父组件仍在请求数据）──
  if (history === undefined) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-6">
        <div className="space-y-gm-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-gm-3">
              <div className="w-3 h-3 mt-0.5 rounded-full gm-skeleton-shimmer shrink-0" />
              <div className="flex-1 space-y-gm-1.5">
                <div className="w-24 h-3 rounded-gm-sm gm-skeleton-shimmer" />
                <div className="w-48 h-4 rounded-gm-sm gm-skeleton-shimmer" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── 空态 ──
  if (history.length === 0) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <RiCheckDoubleLine size={28} className="mx-auto text-text-muted mb-gm-3" />
        <p className="text-gm-sm text-text-muted">
          暂无 L5 拉通记录
        </p>
        <p className="text-gm-xs text-text-muted mt-gm-1">
          首个 Batch 完成后，L5 拉通自检将在此显示
        </p>
      </div>
    );
  }

  // ── 数据态：时间轴 ──
  // 最近 3 条使用 brand 实心圆点，更早的用 gray 空心圆点
  const recentCutoff = 3;

  return (
    <div
      className="rounded-gm-lg bg-surface-elevated border border-border p-gm-6"
      data-testid="l5-timeline"
    >
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-gm-4">
        <h3 className="text-gm-base font-semibold text-text">
          L5 拉通时间线
        </h3>
        <span className="text-gm-xs text-text-muted">
          {history.length} 次审查
        </span>
      </div>

      {/* 时间轴列表 — max-h-80 滚动 */}
      <div className="max-h-80 overflow-y-auto">
        <div className="relative pl-gm-6">
          {/* 竖线 */}
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border-strong" />

          <div className="space-y-gm-4">
            {history.map((entry, idx) => {
              const isRecent = idx < recentCutoff;
              return (
                <div key={`${entry.date}-${entry.phase}-${idx}`} className="relative">
                  {/* 圆点 — 绝对定位在竖线上 */}
                  <div
                    className={`absolute left-[-21px] top-1 w-3 h-3 rounded-full border-2 shrink-0 ${
                      isRecent
                        ? "bg-brand border-brand"
                        : "bg-surface-elevated border-border-strong"
                    }`}
                  />

                  {/* 内容 */}
                  <div className="min-w-0">
                    {/* 日期 + Phase/Batch badge */}
                    <div className="flex items-center gap-gm-2 flex-wrap mb-gm-0.5">
                      <span className="text-gm-xs text-text-muted font-mono">
                        {entry.date}
                      </span>
                      <span className="text-gm-2xs font-mono bg-surface-lowered border border-border rounded-gm-xs px-gm-1.5 py-px text-text-secondary">
                        Phase {entry.phase}
                      </span>
                      <span className="text-gm-2xs font-mono bg-brand-50/30 text-brand rounded-gm-xs px-gm-1.5 py-px">
                        {entry.covered}
                      </span>
                    </div>

                    {/* 标签文字 */}
                    <p className="text-gm-sm text-text flex items-center gap-gm-1">
                      <RiArrowRightLine
                        size={12}
                        className="text-text-muted shrink-0"
                      />
                      {entry.label}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

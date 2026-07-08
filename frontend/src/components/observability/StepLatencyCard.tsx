"use client";

import { RiTimerLine } from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import DataState from "@/components/ui/DataState";
import { api } from "@/lib/api/client";
import { useFetchData } from "@/hooks/useFetchData";
import { STEP_LABELS } from "@/lib/labels";
import { fmtMs } from "@/lib/formatTime";
import { latencyColor } from "./_utils";

/**
 * 步骤延迟指标卡片。
 * 挂载时自动调用 GET /metrics/steps，展示各 pipeline 步骤的延迟分布：
 * 调用次数、平均/最小/最大耗时，颜色编码延迟等级。
 */
export default function StepLatencyCard() {
  const { state, data, error, refresh } = useFetchData(
    () => api.getSteps(),
    [],
    { isEmpty: (r) => Object.keys(r.steps).length === 0 },
  );

  const sortedSteps =
    data && Object.keys(data.steps).length > 0
      ? Object.entries(data.steps).sort((a, b) => b[1].avg_ms - a[1].avg_ms)
      : [];

  return (
    <div className="rounded-gm-sm border border-border bg-surface-elevated shadow-gm-xs overflow-hidden">
      {/* Accent bar */}
      <div className="h-gm-accent-bar w-full bg-accent" />

      <div className="p-gm-4">
        {/* Header */}
        <div className="flex items-center gap-gm-2 mb-gm-3">
          <RiTimerLine className="w-4 h-4 text-accent shrink-0" />
          <h4 className="text-gm-sm font-semibold text-text">步骤延迟</h4>
          {state === "success" && (
            <RefreshButton onClick={refresh} className="ml-auto" />
          )}
        </div>

        <DataState
          state={state}
          error={error}
          onRetry={refresh}
          loadingMessage="加载中…"
          emptyIcon={RiTimerLine}
          emptyMessage="暂无步骤延迟数据"
          isEmpty={state === "idle" || (state === "success" && sortedSteps.length === 0)}
        >
          {data && sortedSteps.length > 0 && (
            <div className="space-y-gm-1_5">
              {sortedSteps.map(([stepName, stats]) => {
                const label = STEP_LABELS[stepName] || stepName;
                return (
                  <div
                    key={stepName}
                    className="flex items-center gap-gm-2 py-gm-1 border-b border-border/30 last:border-0"
                  >
                    {/* 步骤名 */}
                    <span className="text-gm-xs text-text-secondary min-w-0 truncate flex-1">
                      {label}
                    </span>

                    {/* 调用次数 */}
                    <span className="text-gm-xs text-text-muted tabular-nums w-10 text-right shrink-0">
                      ×{stats.count}
                    </span>

                    {/* 平均延迟 */}
                    <span className={`text-gm-xs font-medium tabular-nums w-14 text-right shrink-0 ${latencyColor(stats.avg_ms)}`}>
                      {fmtMs(stats.avg_ms)}
                    </span>

                    {/* 最小–最大范围 */}
                    <span className="text-gm-xs text-text-muted/60 tabular-nums w-20 text-right shrink-0 hidden sm:block">
                      {fmtMs(stats.min_ms)}–{fmtMs(stats.max_ms)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </DataState>
      </div>
    </div>
  );
}

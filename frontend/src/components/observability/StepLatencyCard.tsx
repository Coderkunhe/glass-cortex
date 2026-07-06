"use client";

import { useState, useCallback, useEffect } from "react";
import { RiTimerLine } from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import DataState from "@/components/ui/DataState";
import { api } from "@/lib/api/client";
import type { StepSummary, FetchState } from "@/lib/api/types";

/** 步骤名 → 显示名映射 */
const STEP_LABELS: Record<string, string> = {
  chat: "聊天引擎",
  chat_engine: "聊天引擎",
  intent_classify: "意图分类",
  fact_extraction: "事实抽取",
  recall: "语义召回",
  store: "记忆存储",
  planner: "Planner",
};

/** 延迟着色：<50ms 绿, 50-200ms 橙, >200ms 红 */
function latencyColor(ms: number): string {
  if (ms < 50) return "text-success";
  if (ms <= 200) return "text-warning";
  return "text-danger";
}

/** 格式化毫秒 */
function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * 步骤延迟指标卡片。
 * 挂载时自动调用 GET /metrics/steps，展示各 pipeline 步骤的延迟分布：
 * 调用次数、平均/最小/最大耗时，颜色编码延迟等级。
 */
export default function StepLatencyCard() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<StepSummary | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  const fetchSteps = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getSteps();
      setData(result);
      setState(Object.keys(result.steps).length > 0 ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取步骤延迟数据失败"));
      setState("error");
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchSteps(), 0);
    return () => clearTimeout(id);
  }, [fetchSteps]);

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
            <RefreshButton onClick={fetchSteps} className="ml-auto" />
          )}
        </div>

        <DataState
          state={state}
          error={error}
          onRetry={fetchSteps}
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

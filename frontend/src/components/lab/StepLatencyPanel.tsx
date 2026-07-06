"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  RiTimerLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
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

/** 格式化毫秒数 */
function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * 管线步骤延迟分析面板。
 * 自动获取步骤耗时数据，按 avg_ms 降序展示，最慢步骤高亮。
 */
export default function StepLatencyPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<StepSummary | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  const fetchSteps = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getSteps();
      setData(result);
      const hasData = Object.keys(result.steps).length > 0;
      setState(hasData ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取步骤数据失败"));
      setState("error");
    }
  }, []);

  // auto-fetch on mount
  useEffect(() => {
    const id = setTimeout(() => fetchSteps(), 0);
    return () => clearTimeout(id);
  }, [fetchSteps]);


  // 按 avg_ms 降序排列步骤
  const sortedSteps = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.steps).sort(
      (a, b) => b[1].avg_ms - a[1].avg_ms,
    );
  }, [data]);

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiTimerLine className="w-5 h-5 text-accent shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">
          管线步骤延迟分析
        </h3>
        <span className="text-gm-xs text-text-muted">
          各步骤耗时统计，按平均延迟降序
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchSteps} className="ml-auto" />
        )}
      </div>

      <DataState
        state={state}
        error={error}
        onRetry={fetchSteps}
        loadingMessage="加载步骤数据…"
        loadingIconClassName="text-accent"
        emptyIcon={RiTimerLine}
        emptyMessage="暂无步骤数据，执行一次管线操作后回来查看"
        isEmpty={
          state === "idle" ||
        (state === "success" && sortedSteps.length === 0)
        }
      >
      {/* Success */}
      {state === "success" && sortedSteps.length > 0 && (
        <div className="border-t border-border pt-gm-4">
          <table className="w-full text-gm-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="text-left py-gm-1.5 font-medium">步骤</th>
                <th className="text-right py-gm-1.5 font-medium tabular-nums">
                  调用次数
                </th>
                <th className="text-right py-gm-1.5 font-medium tabular-nums">
                  平均
                </th>
                <th className="text-right py-gm-1.5 font-medium tabular-nums">
                  最快
                </th>
                <th className="text-right py-gm-1.5 font-medium tabular-nums">
                  最慢
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSteps.map(([stepName, stats], index) => {
                const label =
                  STEP_LABELS[stepName] || stepName;
                const isSlowest = index === 0 && sortedSteps.length > 1;
                return (
                  <tr
                    key={stepName}
                    className={`border-b border-border/40 ${
                      isSlowest
                        ? "bg-warning/5 border-l-2 border-l-warning"
                        : ""
                    }`}
                    role="row"
                  >
                    <td className="py-gm-1.5 font-medium text-text-secondary">
                      <span className="flex items-center gap-gm-1">
                        {label}
                        {isSlowest && (
                          <span className="text-gm-xs text-warning bg-warning/10 px-gm-1 rounded-gm-xs">
                            最慢
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-gm-1.5 text-right tabular-nums text-text-muted">
                      {stats.count}
                    </td>
                    <td className="py-gm-1.5 text-right tabular-nums text-text font-medium">
                      {fmtMs(stats.avg_ms)}
                    </td>
                    <td className="py-gm-1.5 text-right tabular-nums text-text-muted">
                      {fmtMs(stats.min_ms)}
                    </td>
                    <td className="py-gm-1.5 text-right tabular-nums text-text-muted">
                      {fmtMs(stats.max_ms)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </DataState>
    </section>
  );
}

"use client";

import { useState, useCallback, useEffect } from "react";
import {
  RiDashboardLine,
  RiLightbulbFlashLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import type { TokenSummary, FetchState } from "@/lib/api/types";
import {
  CALL_POINT_LABELS,
  CALL_POINT_COLORS,
  DEFAULT_CALL_POINT_COLORS,
} from "@/lib/labels";
import { fmtNum } from "@/lib/formatNum";

/** 找到 Token 消耗最高的调用点，返回其 label 和占比 */
function getDominantCallPoint(
  byCallPoint: Record<string, { total_tokens: number }>,
  totalTokens: number,
): { label: string; pct: number } | null {
  const entries = Object.entries(byCallPoint);
  if (entries.length === 0 || totalTokens === 0) return null;
  const [topKey, topUsage] = entries.reduce((a, b) =>
    a[1].total_tokens > b[1].total_tokens ? a : b,
  );
  return {
    label: CALL_POINT_LABELS[topKey] || topKey,
    pct: Math.round((topUsage.total_tokens / totalTokens) * 100),
  };
}

/**
 * Token 用量仪表盘面板。
 * 自动获取 Token 用量数据，按调用点展示 prompt/completion 分段柱状条和总计。
 */
export default function TokenDashboardPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<TokenSummary | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  const fetchTokens = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getTokens();
      setData(result);
      setState(result.total_tokens > 0 ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取 Token 数据失败"));
      setState("error");
    }
  }, []);

  // auto-fetch on mount
  useEffect(() => {
    const id = setTimeout(() => fetchTokens(), 0);
    return () => clearTimeout(id);
  }, [fetchTokens]);

  // 按 total_tokens 降序排列调用点
  const sortedCallPoints =
    data && Object.keys(data.by_call_point).length > 0
      ? Object.entries(data.by_call_point).sort(
          (a, b) => b[1].total_tokens - a[1].total_tokens,
        )
      : [];

  const maxTokens =
    sortedCallPoints.length > 0 ? sortedCallPoints[0][1].total_tokens : 1;

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiDashboardLine className="w-5 h-5 text-brand shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">
          Token 用量仪表盘
        </h3>
        <span className="text-gm-xs text-text-muted">
          按调用点查看 Token 消耗分布
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchTokens} className="ml-auto" />
        )}
      </div>

      <DataState
        state={state}
        error={error}
        onRetry={fetchTokens}
        loadingMessage="加载 Token 数据…"
        loadingIconClassName="text-brand"
        emptyIcon={RiDashboardLine}
        emptyMessage="暂无 Token 数据，发起一次聊天后回来查看"
        isEmpty={
          state === "idle" ||
          (state === "success" && sortedCallPoints.length === 0)
        }
      >
        {data && sortedCallPoints.length > 0 && (
          <div className="border-t border-border pt-gm-4 space-y-gm-4">
          {/* Grand total */}
          <div className="text-center pb-gm-2">
            <p className="text-gm-xs text-text-muted mb-gm-1">总计消耗</p>
            <p className="text-gm-3xl font-bold text-brand tabular-nums">
              {fmtNum(data.total_tokens)}
            </p>
            <p className="text-gm-xs text-text-muted mt-gm-1">
              输入 {fmtNum(data.total_prompt_tokens)} · 输出{" "}
              {fmtNum(data.total_completion_tokens)}
            </p>
            {(() => {
              const dominant = getDominantCallPoint(
                data.by_call_point,
                data.total_tokens,
              );
              return dominant ? (
                <p className="text-gm-xs text-text-muted/70 italic mt-gm-1 flex items-center justify-center gap-gm-1">
                  <RiLightbulbFlashLine className="w-3.5 h-3.5 shrink-0" />
                  主要消耗来自 {dominant.label}（{dominant.pct}%），查看对应面板了解优化空间
                </p>
              ) : null;
            })()}
          </div>

          {/* Per-call-point bars */}
          {sortedCallPoints.map(([callPoint, usage]) => {
            const colors = CALL_POINT_COLORS[callPoint] || DEFAULT_CALL_POINT_COLORS;
            const promptPct =
              maxTokens > 0 ? (usage.prompt_tokens / maxTokens) * 100 : 0;
            const completionPct =
              maxTokens > 0 ? (usage.completion_tokens / maxTokens) * 100 : 0;
            const label = CALL_POINT_LABELS[callPoint] || callPoint;

            return (
              <div key={callPoint}>
                <div className="flex items-center justify-between mb-gm-1">
                  <span className="text-gm-xs font-medium text-text-secondary truncate max-w-[40%]">
                    {label}
                  </span>
                  <span className="text-gm-xs text-text-muted tabular-nums">
                    {fmtNum(usage.total_tokens)} tokens
                  </span>
                </div>
                <div className="flex h-5 rounded-gm-xs overflow-hidden bg-surface-alt">
                  {/* prompt 段 */}
                  <div
                    className={`${colors.prompt} transition-all`}
                    style={{ width: `${Math.max(promptPct, 2)}%` }}
                    title={`输入: ${fmtNum(usage.prompt_tokens)} tokens`}
                  />
                  {/* completion 段 */}
                  <div
                    className={`${colors.completion} transition-all`}
                    style={{ width: `${Math.max(completionPct, 2)}%` }}
                    title={`输出: ${fmtNum(usage.completion_tokens)} tokens`}
                  />
                </div>
                <div className="flex gap-gm-3 mt-gm-0.5">
                  <span className="text-gm-xs text-text-muted/70">
                    输入 {fmtNum(usage.prompt_tokens)}
                  </span>
                  <span className="text-gm-xs text-text-muted/70">
                    输出 {fmtNum(usage.completion_tokens)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </DataState>
    </section>
  );
}

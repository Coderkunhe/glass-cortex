"use client";

import { useState, useCallback, useEffect } from "react";
import { RiCoinLine } from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import DataState from "@/components/ui/DataState";
import { api } from "@/lib/api/client";
import type { TokenSummary, FetchState } from "@/lib/api/types";
import {
  CALL_POINT_LABELS,
  CALL_POINT_COLORS,
  DEFAULT_CALL_POINT_COLORS,
} from "@/lib/labels";
import { fmtNum } from "@/lib/formatNum";

/**
 * Token 指标卡片。
 * 挂载时自动调用 GET /metrics/tokens，展示 session 级 Token 消耗摘要：
 * 总计 + 按调用点的 prompt/completion 分段柱状条。
 */
export default function TokenMetricsCard() {
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

  useEffect(() => {
    const id = setTimeout(() => fetchTokens(), 0);
    return () => clearTimeout(id);
  }, [fetchTokens]);

  const sortedCallPoints =
    data && Object.keys(data.by_call_point).length > 0
      ? Object.entries(data.by_call_point).sort(
          (a, b) => b[1].total_tokens - a[1].total_tokens,
        )
      : [];

  const maxTokens =
    sortedCallPoints.length > 0 ? sortedCallPoints[0][1].total_tokens : 1;

  return (
    <div className="rounded-gm-sm border border-border bg-surface-elevated shadow-gm-xs overflow-hidden">
      {/* Accent bar */}
      <div className="h-gm-accent-bar w-full bg-brand" />

      <div className="p-gm-4">
        {/* Header */}
        <div className="flex items-center gap-gm-2 mb-gm-3">
          <RiCoinLine className="w-4 h-4 text-brand shrink-0" />
          <h4 className="text-gm-sm font-semibold text-text">Token 消耗</h4>
          {state === "success" && (
            <RefreshButton onClick={fetchTokens} className="ml-auto" />
          )}
        </div>

        <DataState
          state={state}
          error={error}
          onRetry={fetchTokens}
          loadingMessage="加载中…"
          emptyIcon={RiCoinLine}
          emptyMessage="暂无 Token 数据"
          isEmpty={state === "idle" || (state === "success" && sortedCallPoints.length === 0)}
        >
          {data && sortedCallPoints.length > 0 && (
            <div className="space-y-gm-3">
              {/* Total */}
              <div className="text-center">
                <p className="text-2xl font-bold text-brand tabular-nums">
                  {fmtNum(data.total_tokens)}
                </p>
                <p className="text-gm-xs text-text-muted">
                  输入 {fmtNum(data.total_prompt_tokens)} · 输出 {fmtNum(data.total_completion_tokens)}
                </p>
              </div>

              {/* Per-call-point bars */}
              <div className="space-y-gm-2">
                {sortedCallPoints.slice(0, 5).map(([callPoint, usage]) => {
                  const colors = CALL_POINT_COLORS[callPoint] || DEFAULT_CALL_POINT_COLORS;
                  const promptPct = maxTokens > 0 ? (usage.prompt_tokens / maxTokens) * 100 : 0;
                  const completionPct = maxTokens > 0 ? (usage.completion_tokens / maxTokens) * 100 : 0;
                  const label = CALL_POINT_LABELS[callPoint] || callPoint;

                  return (
                    <div key={callPoint}>
                      <div className="flex items-center justify-between mb-gm-0.5">
                        <span className="text-gm-xs text-text-secondary truncate max-w-[50%]">
                          {label}
                        </span>
                        <span className="text-gm-xs text-text-muted tabular-nums">
                          {fmtNum(usage.total_tokens)}
                        </span>
                      </div>
                      <div className="flex h-3 rounded-gm-xs overflow-hidden bg-surface-alt">
                        <div
                          className={`${colors.prompt} transition-all`}
                          style={{ width: `${Math.max(promptPct, 1)}%` }}
                          title={`输入: ${fmtNum(usage.prompt_tokens)}`}
                        />
                        <div
                          className={`${colors.completion} transition-all`}
                          style={{ width: `${Math.max(completionPct, 1)}%` }}
                          title={`输出: ${fmtNum(usage.completion_tokens)}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DataState>
      </div>
    </div>
  );
}

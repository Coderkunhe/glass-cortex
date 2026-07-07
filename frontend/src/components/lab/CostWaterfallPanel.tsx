"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RiFundsLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import type { CostWaterfallResponse, FetchState } from "@/lib/api/types";
import { fmtTokens } from "@/lib/formatNum";

/** Time range presets for the quick-select pills (B96 E4). */
type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";

interface TimeRangeOption {
  key: TimeRange;
  label: string;
}

const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { key: "1h", label: "1 小时" },
  { key: "24h", label: "24 小时" },
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "all", label: "全部" },
];

/** Compute since/until epoch seconds from a TimeRange key (B96 E4). */
function timeRangeToEpoch(range: TimeRange): { since?: number; until?: number } {
  if (range === "all") return {};
  const now = Math.floor(Date.now() / 1000);
  const until = now;
  let since: number;
  switch (range) {
    case "1h":
      since = now - 3600;
      break;
    case "24h":
      since = now - 86400;
      break;
    case "7d":
      since = now - 604800;
      break;
    case "30d":
      since = now - 2592000;
      break;
    default:
      return {};
  }
  return { since, until };
}

export default function CostWaterfallPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<CostWaterfallResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);
  const [viewMode, setViewMode] = useState<"waterfall" | "call_point">("waterfall");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

  const fetchWaterfall = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const params: { by?: string; since?: number; until?: number } = {};
      if (viewMode === "call_point") params.by = "call_point";
      // B96 E4: time range filter
      const range = timeRangeToEpoch(timeRange);
      if (range.since !== undefined) {
        params.since = range.since;
        params.until = range.until;
      }
      const result = await api.getCostWaterfall(params);
      setData(result);
      setState(result.gross_tokens > 0 ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取成本瀑布数据失败"));
      setState("error");
    }
  }, [viewMode, timeRange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchWaterfall();
  }, [fetchWaterfall]);

  const hasData = data && data.gross_tokens > 0;

  // 计算瀑布条的最大宽度基准（用总额做分母）
  const maxTokens = data?.gross_tokens || 1;

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiFundsLine className="w-5 h-5 text-accent shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">Token 消耗瀑布</h3>
        <span className="text-gm-xs text-text-muted">
          {viewMode === "waterfall"
            ? "原始调用 → 节省扣除 → 净消耗"
            : "按调用点分组 → 净消耗"}
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchWaterfall} className="ml-auto" />
        )}
      </div>

      {/* B95 E3: view mode pill toggle */}
      {(state === "success" || data) && (
        <div className="flex items-center gap-gm-1.5 mb-gm-3" role="radiogroup" aria-label="视图切换">
          {([
            { key: "waterfall" as const, label: "瀑布流" },
            { key: "call_point" as const, label: "按调用点" },
          ]).map((opt) => {
            const isActive = viewMode === opt.key;
            return (
              <button
                key={opt.key}
                role="radio"
                aria-checked={isActive}
                onClick={() => setViewMode(opt.key)}
                className={`text-gm-xs px-gm-2 py-gm-0.5 rounded-gm-sm border transition-colors ${
                  isActive
                    ? "border-accent bg-accent/10 text-accent ring-1 ring-accent/50"
                    : "border-text-muted/30 text-text-muted opacity-60 hover:opacity-80"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          {/* B96 E4: time range quick-select pills */}
          <span className="text-text-muted/30 mx-gm-1 select-none">|</span>
          {TIME_RANGE_OPTIONS.map((opt) => {
            const isActive = timeRange === opt.key;
            return (
              <button
                key={opt.key}
                role="radio"
                aria-checked={isActive}
                data-testid={`time-range-${opt.key}`}
                onClick={() => setTimeRange(opt.key)}
                className={`text-gm-xs px-gm-2 py-gm-0.5 rounded-gm-sm border transition-colors ${
                  isActive
                    ? "border-warning bg-warning/10 text-warning ring-1 ring-warning/50"
                    : "border-text-muted/30 text-text-muted opacity-60 hover:opacity-80"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}



      <DataState
        state={state}
        error={error}
        onRetry={fetchWaterfall}
        loadingMessage="正在计算 Token 消耗…"
        loadingIconClassName="text-accent"
        emptyIcon={RiFundsLine}
        emptyMessage="暂无 Token 消耗数据，发送消息后回来查看"
        isEmpty={
          state === "idle" ||
        (state === "success" && (!hasData))
        }
      >
      {/* Success — waterfall chart */}
      {state === "success" && data && hasData && (
        <div className="border-t border-border pt-gm-4">
          {/* Waterfall steps */}
          <div className="space-y-gm-1">
            {data.steps.map((step, i) => {
              const isSavings = step.kind === "savings";
              const isNet = step.kind === "net";
              const barPct = Math.min((step.tokens / maxTokens) * 100, 100);

              return (
                <div key={`${step.kind}-${i}`}>
                  {/* 净消耗上方的分隔线 */}
                  {isNet && (
                    <div className="border-t border-border my-gm-3" />
                  )}
                  <div
                    className={`flex items-center gap-gm-3 ${
                      isSavings ? "ml-gm-6" : ""
                    }`}
                  >
                    {/* 标签 */}
                    <span
                      className={`text-gm-xs w-28 shrink-0 ${
                        isNet
                          ? "font-semibold text-text"
                          : "text-text-secondary"
                      }`}
                    >
                      {isSavings && (
                        <span className="text-text-muted mr-gm-1">−</span>
                      )}
                      {step.label}
                    </span>
                    {/* Token 数值 */}
                    <span
                      className={`text-gm-xs w-16 shrink-0 text-right tabular-nums ${
                        isNet
                          ? "font-semibold text-text"
                          : isSavings
                            ? "text-success"
                            : "text-text-secondary"
                      }`}
                    >
                      {isSavings ? `−${fmtTokens(step.tokens)}` : fmtTokens(step.tokens)}
                    </span>
                    {/* 瀑布条 */}
                    <div className="flex-1 h-5 rounded-gm-xs overflow-hidden bg-surface-alt">
                      <div
                        className="h-full rounded-gm-xs transition-all duration-500"
                        style={{
                          width: `${barPct}%`,
                          backgroundColor: step.color,
                          opacity: isSavings ? 0.75 : 1,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary footer */}
          <div className="flex items-center gap-gm-4 mt-gm-4 pt-gm-3 border-t border-border text-gm-xs text-text-muted">
            <span>
              总额{" "}
              <span className="text-text-secondary tabular-nums">
                {fmtTokens(data.gross_tokens)}
              </span>
            </span>
            {data.cache_savings > 0 && (
              <span>
                缓存节省{" "}
                <span className="text-success tabular-nums">
                  −{fmtTokens(data.cache_savings)}
                </span>
              </span>
            )}
            {data.compression_savings > 0 && (
              <span>
                压缩节省{" "}
                <span className="text-warning tabular-nums">
                  −{fmtTokens(data.compression_savings)}
                </span>
              </span>
            )}
            <span className="ml-auto">
              净消耗{" "}
              <span className="text-text font-semibold tabular-nums">
                {fmtTokens(data.net_tokens)}
              </span>
            </span>
          </div>
        </div>
      )}
      </DataState>
    </section>
  );
}

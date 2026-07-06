"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RiFundsLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import type { CostWaterfallResponse, FetchState } from "@/lib/api/types";


/** 格式化 token 数，>=1000 显示 k 后缀。 */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function CostWaterfallPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<CostWaterfallResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  const fetchWaterfall = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getCostWaterfall();
      setData(result);
      // If there are any token records at all, show success; otherwise idle
      setState(result.gross_tokens > 0 ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取成本瀑布数据失败"));
      setState("error");
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchWaterfall(), 0);
    return () => clearTimeout(id);
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
          原始调用 → 节省扣除 → 净消耗
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchWaterfall} className="ml-auto" />
        )}
      </div>



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

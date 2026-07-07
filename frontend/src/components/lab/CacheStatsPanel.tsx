"use client";

import { useState, useCallback, useEffect } from "react";
import {
  RiHardDrive2Line,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiCloseCircleLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import type { CacheStatsResponse, CacheStats, FetchState } from "@/lib/api/types";
import { fmtNum } from "@/lib/formatNum";

/** 命中率 → 健康评估标签（图标 + 文案） */
function getHealthLabel(hitRatePct: number): {
  icon: React.ReactNode;
  label: string;
  tone: string;
} {
  if (hitRatePct >= 80)
    return {
      icon: <RiCheckboxCircleLine className="w-4 h-4 shrink-0" />,
      label: "健康 — 缓存命中率处于理想区间",
      tone: "text-success",
    };
  if (hitRatePct >= 40)
    return {
      icon: <RiErrorWarningLine className="w-4 h-4 shrink-0" />,
      label: "偏低 — 建议复查缓存策略或增大容量",
      tone: "text-warning",
    };
  return {
    icon: <RiCloseCircleLine className="w-4 h-4 shrink-0" />,
    label: "异常 — 缓存几乎未命中，检查 key 匹配或预热逻辑",
    tone: "text-danger",
  };
}

/** 单个缓存统计条 */
function CacheBar({
  label,
  stats,
  barColor,
}: {
  label: string;
  stats: CacheStats;
  barColor: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-gm-1">
        <span className="text-gm-xs font-medium text-text-secondary">
          {label}
        </span>
        <span className="text-gm-xs text-text-muted tabular-nums">
          {stats.hit_rate_pct.toFixed(1)}% 命中率
        </span>
      </div>
      <div className="flex h-5 rounded-gm-xs overflow-hidden bg-surface-alt">
        <div
          className={`${barColor} transition-all`}
          style={{
            width: `${Math.max(stats.hit_rate_pct, 2)}%`,
          }}
        />
      </div>
      <div className="flex gap-gm-3 mt-gm-0.5 text-gm-xs text-text-muted/70">
        <span>命中 {fmtNum(stats.hits)}</span>
        <span>未命中 {fmtNum(stats.misses)}</span>
        <span>容量 {fmtNum(stats.size)}</span>
        <span>请求 {fmtNum(stats.total_requests)}</span>
      </div>
      {stats.total_requests > 0 && (() => {
        const health = getHealthLabel(stats.hit_rate_pct);
        return (
          <p
            className={`flex items-center gap-gm-1 text-gm-xs mt-gm-0.5 ${health.tone}`}
          >
            {health.icon}
            <span>{health.label}</span>
          </p>
        );
      })()}
    </div>
  );
}

/**
 * 缓存命中率面板。
 * 展示嵌入缓存和事实提取缓存的命中率及统计信息。
 */
export default function CacheStatsPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<CacheStatsResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  const fetchStats = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getCacheStats();
      setData(result);
      const hasData =
        result.embedding.total_requests > 0 ||
        (result.fact !== null && result.fact.total_requests > 0);
      setState(hasData ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取缓存统计失败"));
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, [fetchStats]);


  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiHardDrive2Line className="w-5 h-5 text-brand shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">缓存命中率</h3>
        <span className="text-gm-xs text-text-muted">
          嵌入缓存 + 事实提取缓存
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchStats} className="ml-auto" />
        )}
      </div>



      <DataState
        state={state}
        error={error}
        onRetry={fetchStats}
        loadingMessage="加载缓存统计…"
        loadingIconClassName="text-brand"
        emptyIcon={RiHardDrive2Line}
        emptyMessage="暂无缓存数据，运行管线后回来查看"
        isEmpty={
          state === "idle"
        }
      >
      {/* Success */}
      {state === "success" && data && (
        <div className="border-t border-border pt-gm-4 space-y-gm-4">
          <CacheBar
            label="嵌入缓存"
            stats={data.embedding}
            barColor="bg-brand"
          />

          {data.fact !== null ? (
            <CacheBar
              label="事实提取缓存"
              stats={data.fact}
              barColor="bg-accent"
            />
          ) : (
            <div className="rounded-gm-sm border border-dashed border-border bg-surface-alt p-gm-4 text-center">
              <p className="text-gm-sm text-text-muted">
                FactExtractor 未加载
              </p>
              <p className="text-gm-xs text-text-muted/60 mt-gm-1">
                事实提取缓存尚未初始化，执行一次含知识抽取的聊天即可激活
              </p>
            </div>
          )}
        </div>
      )}
      </DataState>
    </section>
  );
}

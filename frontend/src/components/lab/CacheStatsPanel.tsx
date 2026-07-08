"use client";

import { useState } from "react";
import {
  RiHardDrive2Line,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiCloseCircleLine,
  RiFileListLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { TabBar } from "@/components/ui/TabBar";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import { useFetchData } from "@/hooks/useFetchData";
import { fmtNum } from "@/lib/formatNum";

type CacheType = "embedding" | "fact" | "response";

const CACHE_TYPE_TABS = [
  { key: "embedding", label: "嵌入缓存" },
  { key: "fact", label: "事实缓存" },
  { key: "response", label: "响应缓存" },
] as const;

const STATS_LABELS: Record<CacheType, string> = {
  embedding: "嵌入缓存",
  fact: "事实提取缓存",
  response: "语义响应缓存",
};

const BAR_COLORS: Record<CacheType, string> = {
  embedding: "bg-brand",
  fact: "bg-accent",
  response: "bg-info",
};

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
  hits,
  misses,
  size,
  totalRequests,
  hitRatePct,
  barColor,
}: {
  label: string;
  hits: number;
  misses: number;
  size: number;
  totalRequests: number;
  hitRatePct: number;
  barColor: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-gm-1">
        <span className="text-gm-xs font-medium text-text-secondary">
          {label}
        </span>
        <span className="text-gm-xs text-text-muted tabular-nums">
          {hitRatePct.toFixed(1)}% 命中率
        </span>
      </div>
      <div className="flex h-5 rounded-gm-xs overflow-hidden bg-surface-alt">
        <div
          className={`${barColor} transition-all`}
          style={{
            width: `${Math.max(hitRatePct, 2)}%`,
          }}
        />
      </div>
      <div className="flex gap-gm-3 mt-gm-0.5 text-gm-xs text-text-muted/70">
        <span>命中 {fmtNum(hits)}</span>
        <span>未命中 {fmtNum(misses)}</span>
        <span>容量 {fmtNum(size)}</span>
        <span>请求 {fmtNum(totalRequests)}</span>
      </div>
      {totalRequests > 0 && (() => {
        const health = getHealthLabel(hitRatePct);
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
 * 缓存命中率面板 — 三缓存系统统一视图。
 *
 * 按缓存类型切 Tab（嵌入 / 事实提取 / 语义响应），每个 Tab 内
 * stats 命中率条 + entries 条目列表上下排列。单层 Tab 替代旧版
 * "统计/缓存内容"二级嵌套。
 *
 * 数据源：GET /lab/cache-entries（返回 stats + entries，一次调用）。
 */
export default function CacheStatsPanel() {
  const [cacheType, setCacheType] = useState<CacheType>("embedding");

  const { state, data, error, refresh } = useFetchData(
    () => api.getCacheEntries(cacheType, 50),
    [cacheType],
    { isEmpty: (r) => r.entries.length === 0 && r.total_entries === 0 },
  );

  const totalRequests = data ? data.hits + data.misses : 0;
  const showEmpty =
    state === "idle" ||
    (state === "success" && data != null && data.entries.length === 0);

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiHardDrive2Line className="w-5 h-5 text-brand shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">缓存命中率</h3>
        <span className="text-gm-xs text-text-muted">
          三缓存系统统一视图
        </span>
        {state === "success" && (
          <RefreshButton onClick={refresh} className="ml-auto" />
        )}
      </div>

      {/* 缓存类型 TabBar — 唯一导航层（替代旧版"统计/缓存内容"二级 Tab） */}
      <TabBar
        tabs={CACHE_TYPE_TABS}
        activeKey={cacheType}
        onChange={(key) => setCacheType(key as CacheType)}
        activeColor="brand"
        size="xs"
        ariaLabel="缓存类型选择"
        className="mb-gm-4"
      />

      <DataState
        state={state}
        error={error}
        onRetry={refresh}
        loadingMessage="加载缓存数据…"
        loadingIconClassName="text-brand"
        emptyIcon={RiFileListLine}
        emptyMessage={
          cacheType === "fact"
            ? "事实提取缓存尚未初始化，执行一次含知识抽取的聊天即可激活"
            : "该缓存当前为空，运行管线后回来查看"
        }
        isEmpty={showEmpty}
      >
        {/* Success — stats bar + entries list */}
        {state === "success" && data && data.entries.length > 0 && (
          <div className="border-t border-border pt-gm-4 space-y-gm-4">
            {/* 命中率统计条 */}
            <CacheBar
              label={STATS_LABELS[cacheType]}
              hits={data.hits}
              misses={data.misses}
              size={data.total_entries}
              totalRequests={totalRequests}
              hitRatePct={data.hit_rate_pct}
              barColor={BAR_COLORS[cacheType]}
            />

            {/* 缓存条目列表 */}
            <div>
              <p className="text-gm-xs text-text-muted mb-gm-2">
                缓存内容（共{" "}
                <span className="text-text tabular-nums">
                  {data.total_entries}
                </span>{" "}
                条）
              </p>
              <div className="space-y-gm-1 max-h-72 overflow-y-auto">
                {data.entries.map((entry, idx) => (
                  <div
                    key={`${entry.kind}-${idx}`}
                    className="rounded-gm-sm border border-border/40 px-gm-3 py-gm-2 hover:bg-surface-alt/40 transition-colors"
                  >
                    <div className="flex items-start gap-gm-2">
                      <span className="text-gm-xs text-text-muted/60 shrink-0 mt-px tabular-nums w-6">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-gm-xs text-text-secondary break-all line-clamp-2">
                          {entry.preview || entry.key}
                        </p>
                        {entry.tokens_est > 0 && (
                          <span className="text-gm-xs text-text-muted/60 mt-gm-0.5 inline-block">
                            ~{fmtNum(entry.tokens_est)} tokens
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DataState>
    </section>
  );
}

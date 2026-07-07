"use client";

import { useState, useCallback, useEffect } from "react";
import {
  RiGitBranchLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import { RefreshButton } from "@/components/ui/RefreshButton";
import type { TraceItem, FetchState } from "@/lib/api/types";
import { STEP_LABELS } from "@/lib/labels";
import { fmtMs, fmtTimestamp } from "@/lib/formatTime";


/** 状态 → { label, color } 映射 */
function statusBadge(status: string): {
  label: string;
  dot: string;
  bg: string;
} {
  if (status === "ok") {
    return { label: "成功", dot: "bg-success", bg: "bg-success/10" };
  }
  if (status === "error") {
    return { label: "失败", dot: "bg-danger", bg: "bg-danger/10" };
  }
  return { label: status, dot: "bg-warning", bg: "bg-warning/10" };
}

/**
 * Pipeline 追踪浏览器面板。
 * 展示管线步骤执行记录，支持展开指标详情、步骤过滤、加载更多。
 */
export default function PipelineTracePanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<TraceItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [error, setError] = useState<Error | string | null>(null);
  const [limit, setLimit] = useState(50);
  const [stepFilter, setStepFilter] = useState<string>("");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [countError, setCountError] = useState(false);

  const fetchTraces = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      let result: TraceItem[];
      if (stepFilter) {
        result = await api.getTracesByStep(stepFilter, limit);
      } else {
        result = await api.getTraces(undefined, limit);
      }
      setData(result);
      setState(result.length > 0 ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取追踪记录失败"));
      setState("error");
    }
  }, [stepFilter, limit]);

  // I5: 获取总数（支持 stepFilter 过滤）
  const fetchCount = useCallback(async () => {
    try {
      const r = await api.getTraceCount(
        undefined,
        stepFilter || undefined,
      );
      setTotalCount(r.count);
      setCountError(false);
    } catch {
      setCountError(true);
    }
  }, [stepFilter]);

  // auto-fetch on mount + when filter/limit changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTraces();
  }, [fetchTraces]);

  // auto-fetch count on mount + when filter changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCount();
  }, [fetchCount]);


  // I4: step names from API (not client-side extraction from loaded data)
  const [stepNames, setStepNames] = useState<string[]>([]);
  useEffect(() => {
    api.getTraceSteps().then(setStepNames).catch(() => setStepNames([]));
  }, []);

  const toggleExpand = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleFilterChange = (value: string) => {
    setStepFilter(value);
    setLimit(50); // 重置分页
  };

  const handleLoadMore = () => {
    setLimit((prev) => prev + 50);
  };

  const hasMore = data.length < totalCount;

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiGitBranchLine className="w-5 h-5 text-warning shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">
          Pipeline 追踪浏览器
        </h3>
        <span className="text-gm-xs text-text-muted">
          查看管线步骤执行记录
        </span>
        {/* 总数徽章 */}
        {!countError && totalCount > 0 && (
          <span className="text-gm-xs text-text-muted bg-surface-alt px-gm-1.5 py-gm-0.5 rounded-gm-sm tabular-nums">
            {totalCount}
          </span>
        )}
        {/* 刷新 + 过滤 */}
        <div className="ml-auto flex items-center gap-gm-2">
          {/* 步骤过滤下拉 */}
          {(state === "success" || data.length > 0) && (
            <select
              value={stepFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              aria-label="按步骤过滤"
              className="text-gm-xs rounded-gm-sm border border-border bg-surface px-gm-2 py-gm-0.5 text-text-muted focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none cursor-pointer"
            >
              <option value="">全部步骤</option>
              {stepNames.map((name) => (
                <option key={name} value={name}>
                  {STEP_LABELS[name] || name}
                </option>
              ))}
            </select>
          )}
          {(state === "success" || data.length > 0) && (
            <RefreshButton onClick={fetchTraces} />
          )}
        </div>
      </div>

      <DataState
        state={state}
        error={error}
        onRetry={fetchTraces}
        loadingMessage="加载追踪记录…"
        loadingIconClassName="text-warning"
        emptyIcon={RiGitBranchLine}
        emptyMessage="暂无追踪记录，执行一次聊天后回来查看"
        isEmpty={
          state === "idle" ||
        (state === "success" && data.length === 0)
        }
      >
      {/* Success */}
      {state === "success" && data.length > 0 && (
        <div className="border-t border-border pt-gm-4 space-y-gm-1">
          {data.map((trace) => {
            const badge = statusBadge(trace.status);
            const isExpanded = expandedRows.has(trace.id);
            return (
              <div
                key={trace.id}
                className="rounded-gm-sm border border-border/50 hover:bg-surface-alt/50 transition-colors"
              >
                {/* 摘要行 */}
                <div className="flex items-center gap-gm-3 p-gm-3">
                  <button
                    onClick={() => toggleExpand(trace.id)}
                    title="展开详情"
                    aria-expanded={isExpanded}
                    className="text-text-muted hover:text-text transition-colors shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
                  >
                    {isExpanded ? (
                      <RiArrowDownSLine className="w-4 h-4" />
                    ) : (
                      <RiArrowRightSLine className="w-4 h-4" />
                    )}
                  </button>

                  <span className="text-gm-xs font-medium text-text-secondary min-w-0 truncate">
                    {STEP_LABELS[trace.step_name] || trace.step_name}
                  </span>

                  <span className="text-gm-xs tabular-nums text-text-muted shrink-0">
                    {fmtMs(trace.elapsed_ms)}
                  </span>

                  <span
                    className={`text-gm-xs px-gm-1.5 py-gm-0.5 rounded-gm-sm flex items-center gap-gm-1 shrink-0 ${badge.bg}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>

                  <span className="text-gm-xs text-text-muted/60 ml-auto truncate shrink-0 hidden sm:block">
                    {fmtTimestamp(trace.created_at)}
                  </span>
                </div>

                {/* 展开详情 */}
                {isExpanded && (
                  <div className="border-t border-border/30 px-gm-4 py-gm-3 bg-surface-alt/30">
                    <div className="grid grid-cols-2 gap-gm-2 text-gm-xs mb-gm-2">
                      <div>
                        <span className="text-text-muted">会话 ID：</span>
                        <span className="text-text-secondary font-mono">
                          {trace.session_id}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted">步骤名：</span>
                        <span className="text-text-secondary">
                          {trace.step_name}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted">耗时：</span>
                        <span className="text-text-secondary tabular-nums">
                          {fmtMs(trace.elapsed_ms)}
                        </span>
                      </div>
                      <div>
                        <span className="text-text-muted">状态：</span>
                        <span className="text-text-secondary">
                          {trace.status}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-text-muted">时间：</span>
                        <span className="text-text-secondary">
                          {fmtTimestamp(trace.created_at)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-gm-xs text-text-muted mb-gm-1">
                        指标数据
                      </p>
                      {trace.metrics &&
                      Object.keys(trace.metrics).length > 0 ? (
                        <pre className="text-gm-xs text-text-secondary bg-surface p-gm-2 rounded-gm-sm overflow-x-auto font-mono max-h-40 overflow-y-auto">
                          {JSON.stringify(trace.metrics, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-gm-xs text-text-muted/60 italic">
                          无额外指标
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center pt-gm-3">
              <button
                onClick={handleLoadMore}
                className="text-gm-xs text-brand hover:text-brand/80 transition-colors px-gm-3 py-gm-1 rounded-gm-sm border border-border hover:border-brand/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
              >
                加载更多
              </button>
            </div>
          )}
        </div>
      )}

      </DataState>
    </section>
  );
}

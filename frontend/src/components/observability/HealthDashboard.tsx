"use client";

import { useState, useEffect, useCallback } from "react";
import { RiHeartPulseLine } from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import DataState from "@/components/ui/DataState";
import { api } from "@/lib/api/client";
import type { HealthResponse, FetchState } from "@/lib/api/types";
import HealthCard from "./HealthCard";
import TokenMetricsCard from "./TokenMetricsCard";
import StepLatencyCard from "./StepLatencyCard";

/** API 组件 key → 中文显示名 */
const COMPONENT_LABELS: Record<string, string> = {
  database: "数据库",
  faiss_index: "向量索引",
  llm_api: "LLM API",
  disk_space: "磁盘空间",
  embedding_model: "嵌入模型",
};

/** 整体状态 → 中文标签 */
function overallStatusLabel(status: string): string {
  switch (status) {
    case "ok":
      return "正常";
    case "warn":
      return "警告";
    case "error":
      return "异常";
    default:
      return status;
  }
}

/** 整体状态 → 圆点颜色 */
function overallDotClass(status: string): string {
  switch (status) {
    case "ok":
      return "bg-success";
    case "warn":
      return "bg-warning";
    case "error":
      return "bg-danger";
    default:
      return "bg-border-strong";
  }
}

/**
 * 健康仪表盘容器组件。
 * 挂载时调用 GET /health，管理 loading / error / success 状态，
 * 渲染 5 张 HealthCard、刷新按钮、整体状态和时间戳。
 */
export default function HealthDashboard() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.health();
      setData(result);
      setLastUpdated(new Date());
      setState("success");
    } catch (err) {
      setError(err);
      setState("error");
    }
  }, []);

  useEffect(() => {
    // 挂载时获取健康数据 — setState 在 useCallback 内部
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchHealth();
  }, [fetchHealth]);

  const isLoading = state === "loading";

  const componentKeys = Object.keys(data?.components ?? {}).filter(
    (k) => k in COMPONENT_LABELS,
  );

  /* ── Success ────────────────────────────────────── */
  const suggestions = data?.recovery_suggestions ?? [];

  return (
    <DataState
      state={state}
      error={error}
      onRetry={fetchHealth}
      loadingMessage="检查中…"
      emptyIcon={RiHeartPulseLine}
      emptyMessage="暂无健康检查数据"
      isEmpty={state === "success" && componentKeys.length === 0}
    >
      <div className="flex flex-col gap-gm-4">
      {/* Header bar: 整体状态 + 刷新 + 时间戳 */}
      <div className="flex items-center justify-between flex-wrap gap-gm-2">
        <div className="flex items-center gap-gm-3">
          {/* 整体状态 */}
          {data && (
            <div className="flex items-center gap-gm-1_5">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${overallDotClass(data.overall_status)}`}
                aria-hidden="true"
              />
              <span className="text-gm-sm font-medium text-text">
                整体状态：
              </span>
              <span className="text-gm-sm text-text-secondary">
                {overallStatusLabel(data.overall_status)}
              </span>
            </div>
          )}

          {/* 刷新按钮 */}
          <RefreshButton onClick={fetchHealth} loading={isLoading} />
        </div>

        {/* 时间戳 */}
        {lastUpdated && (
          <span className="text-gm-xs text-text-muted">
            {lastUpdated.toLocaleTimeString("zh-CN", { hour12: false })}
          </span>
        )}
      </div>

      {/* 恢复建议 */}
      {suggestions.length > 0 && (
        <div className="rounded-gm-sm border border-info/20 bg-info/5 p-gm-4">
          <p className="text-gm-sm font-medium text-text mb-gm-2">恢复建议</p>
          <ul className="flex flex-col gap-gm-1">
            {suggestions.map((s, i) => (
              <li key={i} className="text-gm-xs text-text-secondary">
                • {s.component}
                {s.hint ? `：${s.hint}` : s.suggestion ? `：${s.suggestion}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5 张健康卡片网格 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-gm-3">
        {componentKeys.map((key) => (
          <HealthCard
            key={key}
            component={data!.components[key]}
            label={COMPONENT_LABELS[key]}
          />
        ))}
      </div>

      {/* 指标卡片区：Token 消耗 + 步骤延迟 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-gm-4">
        <TokenMetricsCard />
        <StepLatencyCard />
      </div>
    </div>
    </DataState>
  );
}

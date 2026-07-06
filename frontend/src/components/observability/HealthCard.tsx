"use client";

import type { HealthComponent } from "@/lib/api/types";

/** 状态 → 中文标签映射 */
const STATUS_LABELS: Record<string, string> = {
  ok: "正常",
  warn: "警告",
  error: "异常",
};

/** 状态 → accent bar 背景色 */
function accentBarClass(status: string): string {
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

/** 状态 → 状态 pill 样式 */
function statusPillClass(status: string): string {
  switch (status) {
    case "ok":
      return "bg-success/10 text-success";
    case "warn":
      return "bg-warning/10 text-warning";
    case "error":
      return "bg-danger/10 text-danger";
    default:
      return "bg-surface-lowered text-text-muted";
  }
}

/** 延迟着色：<50ms 绿, 50-200ms 橙, >200ms 红 */
function latencyColor(latencyMs: number): string {
  if (latencyMs < 50) return "text-success";
  if (latencyMs <= 200) return "text-warning";
  return "text-danger";
}

export interface HealthCardProps {
  /** API 返回的单个组件健康数据 */
  component: HealthComponent;
  /** 中文显示名，如 "数据库"、"向量索引" */
  label: string;
}

/**
 * 单张健康检查卡片。
 * 展示 accent bar、组件名、状态 pill、延迟、详情文本（超长截断+titletip）。
 */
export default function HealthCard({ component, label }: HealthCardProps) {
  const { status, latency_ms: latencyMs, detail } = component;
  const statusLabel = STATUS_LABELS[status] ?? status;
  const hasDetail = detail && detail.length > 0;

  return (
    <div className="rounded-gm-sm border border-border bg-surface-elevated shadow-gm-xs overflow-hidden">
      {/* Accent bar */}
      <div className={`h-gm-accent-bar w-full ${accentBarClass(status)}`} />

      <div className="p-gm-4 flex flex-col gap-gm-1_5">
        {/* Row 1: 组件名 + 状态 pill */}
        <div className="flex items-center justify-between">
          <span className="text-gm-sm font-semibold text-text">{label}</span>
          <span
            className={`inline-block rounded-full px-gm-2 py-px text-gm-xs font-medium ${statusPillClass(status)}`}
          >
            {statusLabel}
          </span>
        </div>

        {/* Row 2: 延迟指示 */}
        <div className="flex items-center gap-gm-1">
          <span
            className={`inline-block w-gm-2 h-gm-2 rounded-full ${latencyColor(latencyMs)}`}
            aria-hidden="true"
          />
          <span className={`text-gm-xs ${latencyColor(latencyMs)}`}>
            {latencyMs.toFixed(1)}ms
          </span>
        </div>

        {/* Row 3: 详情文本 */}
        {hasDetail ? (
          <p
            className="text-gm-xs text-text-muted line-clamp-2"
            title={detail.length > 60 ? detail : undefined}
          >
            {detail}
          </p>
        ) : (
          <p className="text-gm-xs text-text-muted/50 italic">无详情</p>
        )}
      </div>
    </div>
  );
}

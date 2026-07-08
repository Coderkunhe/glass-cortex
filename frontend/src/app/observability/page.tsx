import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import ObserveShell from "@/components/observability/ObserveShell";
import ErrorBoundary from "@/components/ui/ErrorBoundary";

/**
 * Observability 页面路由。
 * Server Component — ErrorBoundary 兜底面板崩溃，
 * Suspense 包裹 ObserveShell（客户端组件）以提供加载骨架。
 * 对标 /lab/page.tsx ErrorBoundary + Suspense 模式。
 */
export default function ObservabilityPage() {
  return (
    <AppShell>
      <ErrorBoundary fallbackVariant="card">
        <Suspense fallback={<ObservabilityLoadingSkeleton />}>
          <ObserveShell />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

/**
 * Observability 页面加载骨架。
 * 匹配 ObserveShell 布局（TabBar + 内容区）以消除布局偏移（CLS）。
 */
function ObservabilityLoadingSkeleton() {
  return (
    <div
      className="flex flex-col h-full"
      role="status"
      aria-label="可观测性数据加载中"
    >
      {/* 标题 — 屏幕阅读器可感知 */}
      <h1 className="sr-only">可观测性</h1>

      {/* TabBar 骨架 — 4 个 tab 占位 */}
      <div className="flex gap-gm-1 px-gm-5 pt-gm-3 pb-gm-2">
        {["健康仪表盘", "日志查看器", "调用追踪", "压缩日志"].map((label) => (
          <div
            key={label}
            className="px-gm-4 py-gm-1_5 rounded-gm-sm bg-surface-elevated border border-border"
          >
            <div className="w-16 h-3.5 rounded-gm-sm gm-skeleton-shimmer" />
          </div>
        ))}
      </div>

      {/* 内容区骨架 — 5 卡片网格 + 2 指标卡 */}
      <div className="flex-1 overflow-y-auto p-gm-5">
        <div className="flex flex-col gap-gm-4">
          {/* Header bar placeholder */}
          <div className="flex items-center justify-between">
            <div className="w-32 h-5 rounded-gm-sm gm-skeleton-shimmer" />
            <div className="w-20 h-4 rounded-gm-sm gm-skeleton-shimmer" />
          </div>

          {/* 5 卡片网格 */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-gm-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="rounded-gm-lg bg-surface-elevated border border-border p-gm-4 h-28 gm-skeleton-shimmer"
              />
            ))}
          </div>

          {/* 2 指标卡 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-gm-4">
            <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-4 h-32 gm-skeleton-shimmer" />
            <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-4 h-32 gm-skeleton-shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}

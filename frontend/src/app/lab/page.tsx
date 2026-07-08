import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import LabShell from "@/components/lab/LabShell";
import ErrorBoundary from "@/components/ui/ErrorBoundary";

/**
 * 实验室页面 (/lab)。
 * Server Component — ErrorBoundary 兜底面板崩溃 +
 * Suspense 包裹 LabShell（客户端组件，需 useSearchParams）提供加载骨架。
 * 对标 /observability/page.tsx ErrorBoundary + Suspense 模式。
 */
export default function LabPage() {
  return (
    <AppShell>
      <ErrorBoundary fallbackVariant="card">
        <Suspense fallback={<LabLoadingSkeleton />}>
          <LabShell />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

/**
 * Lab 页面加载骨架。
 * 匹配 LabShell 布局（5 Tab + 内容区多面板）以消除布局偏移（CLS）。
 */
function LabLoadingSkeleton() {
  return (
    <div
      className="flex flex-col h-full"
      role="status"
      aria-label="实验室数据加载中"
    >
      {/* TabBar 骨架 — 5 个 tab 占位（带 icon 位） */}
      <div className="flex gap-gm-1 px-gm-5 pt-gm-3 pb-gm-2 border-b border-border">
        {["上下文", "管线", "数据", "图谱", "实验"].map((label) => (
          <div
            key={label}
            className="flex items-center gap-gm-1 px-gm-4 py-gm-1_5 rounded-gm-sm bg-surface-elevated border border-border"
          >
            <div className="w-4 h-4 rounded-gm-sm gm-skeleton-shimmer" />
            <div className="w-10 h-3.5 rounded-gm-sm gm-skeleton-shimmer" />
          </div>
        ))}
      </div>

      {/* 内容区骨架 — 3 面板占位（匹配上下文 Tab 的面板密度） */}
      <div className="flex-1 overflow-y-auto p-gm-5 space-y-gm-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-gm-lg bg-surface-elevated border border-border p-gm-4"
          >
            {/* 面板标题 */}
            <div className="w-32 h-4 rounded-gm-sm gm-skeleton-shimmer mb-gm-3" />
            {/* 面板内容区 — 不同高度模拟面板差异 */}
            <div
              className={`rounded-gm-md bg-surface-lowered gm-skeleton-shimmer ${
                i === 0 ? "h-40" : i === 1 ? "h-24" : "h-32"
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

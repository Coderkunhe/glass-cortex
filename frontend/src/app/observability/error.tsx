"use client";

import ErrorDisplay from "@/components/ui/ErrorDisplay";
import AppShell from "@/components/layout/AppShell";

/**
 * /observability 路由级错误边界。
 *
 * 捕获 page.tsx 渲染异常以及 ErrorBoundary 未覆盖的客户端异常。
 * 在 AppShell 布局内渲染 ErrorDisplay(card)，保留侧栏导航结构。
 * 对标 /learn/error.tsx 模式。
 */
export default function ObservabilityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell>
      <div className="flex items-center justify-center h-full p-gm-8">
        <ErrorDisplay variant="card" error={error} onRetry={reset} />
      </div>
    </AppShell>
  );
}

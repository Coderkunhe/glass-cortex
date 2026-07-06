"use client";

import ErrorDisplay from "@/components/ui/ErrorDisplay";
import AppShell from "@/components/layout/AppShell";

/**
 * /learn 路由级错误边界。
 *
 * 捕获 page.tsx 服务端数据加载异常（loadAllChaptersParallel 失败）
 * 以及 ErrorBoundary 未覆盖的客户端渲染异常。
 * 在 AppShell 布局内渲染 ErrorDisplay(card)，保留页面导航结构。
 */
export default function LearnError({
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

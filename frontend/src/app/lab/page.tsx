import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import LabShell from "@/components/lab/LabShell";
import ErrorBoundary from "@/components/ui/ErrorBoundary";

/**
 * 实验室页面 (/lab)。
 * Server Component - ErrorBoundary 兜底面板崩溃 + Suspense 包裹 LabShell 以兼容 useSearchParams。
 */
export default function LabPage() {
  return (
    <AppShell>
      <ErrorBoundary fallbackVariant="card">
        <Suspense fallback={<div className="p-gm-6 text-center text-text-muted">加载中...</div>}>
          <LabShell />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

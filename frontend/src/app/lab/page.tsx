import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import LabShell from "@/components/lab/LabShell";

/**
 * 实验室页面 (/lab)。
 * Server Component - Suspense 包裹 LabShell 以兼容 useSearchParams。
 */
export default function LabPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="p-gm-6 text-center text-text-muted">加载中...</div>}>
        <LabShell />
      </Suspense>
    </AppShell>
  );
}

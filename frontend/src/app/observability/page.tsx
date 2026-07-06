import AppShell from "@/components/layout/AppShell";
import ObserveShell from "@/components/observability/ObserveShell";

/**
 * Observability 页面路由。
 * Server Component — 将 ObserveShell（客户端组件）包裹在 AppShell 中。
 */
export default function ObservabilityPage() {
  return (
    <AppShell>
      <ObserveShell />
    </AppShell>
  );
}

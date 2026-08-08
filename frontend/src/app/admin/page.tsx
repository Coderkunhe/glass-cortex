/**
 * Admin 管理面板页面 (/admin)。
 *
 * Phase 68 Batch 3 — 密码保护的管理仪表盘，展示工程健康指标 + 文档清单。
 * 独立页面（不使用 AppShell），密码从 NEXT_PUBLIC_ADMIN_PASSWORD 读取，
 * 默认 Coder@9527。
 *
 * @module app/admin/page
 */

import type { Metadata } from "next";
import AdminShell from "./AdminShell";
import ErrorBoundary from "@/components/ui/ErrorBoundary";

/** Admin 页面元数据 — 不索引管理页 */
export const metadata: Metadata = {
  title: "AI 工程协作管理面板 — GlassCortex",
  robots: "noindex, nofollow",
};

/** Admin 页面入口 — ErrorBoundary 包裹 Client Shell，对标 lab/page.tsx 路由级容错 */
export default function AdminPage() {
  return (
    <ErrorBoundary fallbackVariant="card">
      <AdminShell />
    </ErrorBoundary>
  );
}

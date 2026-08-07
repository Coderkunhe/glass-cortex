"use client";

/**
 * AdminShell — Admin 管理面板编排层。
 *
 * 职责：密码门禁 + 侧栏菜单路由 + 内容区 Panel 调度。
 * 各 Panel 组件（PasswordGate/AdminSidebar/HealthPanel/DocsPanel/DocViewer）
 * 已独立为 components/admin/* 模块，AdminShell 只做编排。
 *
 * @module app/admin/AdminShell
 */

import { useState, useEffect, useCallback } from "react";
import { RiLockLine } from "@remixicon/react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import PasswordGate from "@/components/admin/PasswordGate";
import AdminSidebar from "@/components/admin/AdminSidebar";
import type { AdminTab } from "@/components/admin/AdminSidebar";
import HealthPanel from "@/components/admin/HealthPanel";
import DocsPanel from "@/components/admin/DocsPanel";
import DailyPanel from "@/components/admin/DailyPanel";
import DocViewer from "@/components/admin/DocViewer";
import { api } from "@/lib/api/client";
import type { DocListItem, DocContentResponse } from "@/lib/api/types";

// ── 常量 ──────────────────────────────────────────────────────────────

/** sessionStorage 键 — 认证通过标记 */
const AUTH_KEY = "gm-admin-authed";

// ═══════════════════════════════════════════════════════════════════════
// AdminShell — 编排层
// ═══════════════════════════════════════════════════════════════════════

export default function AdminShell() {
  // ── 认证状态 — 必须默认 false 以匹配 SSR（服务器无 sessionStorage），
  //    客户端通过 useEffect 延迟读取 sessionStorage，避免 hydration mismatch。
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(AUTH_KEY) === "1") {
      // 读取 sessionStorage 必须在 effect 中（SSR 无此 API）。默认 false 确保
      // SSR 与客户端初始渲染一致（都渲染 PasswordGate），避免 hydration mismatch。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthed(true);
    }
  }, []);

  // ── 当前激活的侧栏菜单项 ──
  const [activeTab, setActiveTab] = useState<AdminTab>("health");

  // ── 文档选中状态 ──
  const [selectedDoc, setSelectedDoc] = useState<DocListItem | null>(null);
  const [docContent, setDocContent] = useState<DocContentResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  /** 加载文档内容 */
  const loadDoc = useCallback(async (item: DocListItem) => {
    if (item.is_directory) return;
    setSelectedDoc(item);
    setDocContent(null);
    setDocError(null);
    setDocLoading(true);
    try {
      const data = await api.getDocContent(item.path.replace(/^docs\//, ""));
      setDocContent(data);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setDocLoading(false);
    }
  }, []);

  /** 返回文档列表（保持当前 tab 不变） */
  const backToDocs = useCallback(() => {
    setSelectedDoc(null);
    setDocContent(null);
    setDocError(null);
  }, []);

  /** 退出登录 */
  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(AUTH_KEY);
    setAuthed(false);
    setActiveTab("health");
    setSelectedDoc(null);
    setDocContent(null);
  }, []);

  /** 认证成功回调 */
  const handleAuthSuccess = useCallback(() => {
    sessionStorage.setItem(AUTH_KEY, "1");
    setAuthed(true);
  }, []);

  /** 侧栏菜单切换 — 快捷入口（需求日志）自动触发文档加载；日报展示文档列表供浏览 */
  const handleTabChange = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    setSelectedDoc(null);
    setDocContent(null);
    setDocError(null);

    if (tab === "requirements-log") {
      loadDoc({
        name: "需求日志",
        path: "docs/requirements-log.md",
        group: "核心文档",
        is_directory: false,
        lines: 0,
        size_bytes: 0,
        mtime: "",
      });
    }
  }, [loadDoc]);

  // ── 渲染 ──

  if (!authed) {
    return <PasswordGate onSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="h-screen bg-bg text-text flex flex-col">
      {/* 顶部栏 */}
      <TopBar onLogout={handleLogout} />

      {/* 主体：侧栏 + 内容 — min-h-0 允许 flex 子项缩至内容以下，是独立滚动的关键 */}
      <div className="flex flex-1 min-h-0">
        <AdminSidebar activeTab={activeTab} onTab={handleTabChange} />

        {/* 内容区 — flex flex-col + overflow-hidden + min-h-0 建立高度链 */}
        <main className="flex-1 min-w-0 min-h-0 p-gm-5 overflow-hidden flex flex-col">
          {activeTab === "health" && <HealthPanel />}
          {activeTab === "docs" && (
            selectedDoc ? (
              <DocViewer
                item={selectedDoc}
                content={docContent}
                loading={docLoading}
                error={docError}
                onBack={backToDocs}
              />
            ) : (
              <DocsPanel onSelectDoc={loadDoc} />
            )
          )}
          {activeTab === "daily" && (
            selectedDoc ? (
              <DocViewer
                item={selectedDoc}
                content={docContent}
                loading={docLoading}
                error={docError}
                onBack={backToDocs}
              />
            ) : (
              <DailyPanel onSelectDoc={loadDoc} />
            )
          )}
          {activeTab === "requirements-log" && (
            <DocViewer
              item={selectedDoc!}
              content={docContent}
              loading={docLoading}
              error={docError}
              onBack={backToDocs}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TopBar — 顶部工具栏（简化版：只保留品牌 + 主题切换 + 退出）
// ═══════════════════════════════════════════════════════════════════════

function TopBar({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="sticky top-0 z-40 bg-surface-elevated/80 backdrop-blur border-b border-border shadow-gm-xs shrink-0">
      <div className="mx-auto px-gm-5 py-gm-3 flex items-center justify-between">
        {/* 品牌 */}
        <div className="flex items-center gap-gm-2 select-none">
          <div className="w-7 h-7 rounded-gm-md bg-brand-50 flex items-center justify-center">
            <RiLockLine className="text-gm-sm text-brand" />
          </div>
          <span className="text-gm-sm font-semibold text-text tracking-tight">
            GlassCortex Admin
          </span>
        </div>

        {/* 操作区：主题切换 + 退出 */}
        <div className="flex items-center gap-gm-2">
          <ThemeToggle />
          <button
            onClick={onLogout}
            className="rounded-gm-sm px-gm-3 py-gm-1 text-gm-xs text-text-muted hover:text-red-500 hover:bg-red-50/30 transition-all"
          >
            退出
          </button>
        </div>
      </div>
    </header>
  );
}

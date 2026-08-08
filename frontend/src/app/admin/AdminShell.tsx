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
import { RiLockLine, RiMenuLine, RiCloseLine } from "@remixicon/react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { ScrollLockProvider } from "@/components/ui/ScrollLockContext";
import Drawer from "@/components/ui/Drawer";
import PasswordGate from "@/components/admin/PasswordGate";
import AdminSidebar from "@/components/admin/AdminSidebar";
import type { AdminTab } from "@/components/admin/AdminSidebar";
import HealthPanel from "@/components/admin/HealthPanel";
import DocsPanel from "@/components/admin/DocsPanel";
import DailyPanel from "@/components/admin/DailyPanel";
import RequirementsLogPanel from "@/components/admin/RequirementsLogPanel";
import DocViewer from "@/components/admin/DocViewer";
import SearchModal from "@/components/admin/SearchModal";
import { api } from "@/lib/api/client";
import { flattenDocs } from "@/lib/content/docSearch";
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

  // ── 移动端侧栏 Drawer 状态 ──
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // ── 文档选中状态 ──
  const [selectedDoc, setSelectedDoc] = useState<DocListItem | null>(null);
  const [docContent, setDocContent] = useState<DocContentResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  // ── 全量文档列表（供 SearchModal 全局搜索）──
  const [allDocs, setAllDocs] = useState<DocListItem[]>([]);

  // ── 搜索模态窗 ──
  const [searchOpen, setSearchOpen] = useState(false);

  // 认证后拉取全量文档列表
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    api.getDocs()
      .then((json) => { if (!cancelled) setAllDocs(json); })
      .catch(() => { /* 静默失败 — SearchModal 展示空态 */ });
    return () => { cancelled = true; };
  }, [authed]);

  // Cmd+K / Ctrl+K 全局搜索快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  /** 返回文档列表 — 保持当前 tab 上下文 */
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

  /** 侧栏菜单切换 — 日报展示文档列表供浏览 */
  const handleTabChange = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    setSelectedDoc(null);
    setDocContent(null);
    setDocError(null);
  }, []);

  // ── 渲染 ──

  if (!authed) {
    return <PasswordGate onSuccess={handleAuthSuccess} />;
  }

  return (
    <ScrollLockProvider>
      <div className="h-screen bg-bg text-text flex flex-col">
        {/* 顶部栏 */}
        <TopBar
          onLogout={handleLogout}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        />

        {/* 主体：侧栏 + 内容 — min-h-0 允许 flex 子项缩至内容以下，是独立滚动的关键 */}
        <div className="flex flex-1 min-h-0">
          <AdminSidebar
            activeTab={activeTab}
            onTab={handleTabChange}
            onOpenSearch={() => setSearchOpen(true)}
          />

          {/* 内容区 — ErrorBoundary 包裹确保子面板崩溃时保留 TopBar + Sidebar */}
          <main className="flex-1 min-w-0 min-h-0 p-gm-5 overflow-y-auto flex flex-col">
            <ErrorBoundary fallbackVariant="card">
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
                  <DocsPanel onSelectDoc={loadDoc} onNavigate={handleTabChange} docs={allDocs.length > 0 ? allDocs : undefined} />
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
                selectedDoc ? (
                  <DocViewer
                    item={selectedDoc}
                    content={docContent}
                    loading={docLoading}
                    error={docError}
                    onBack={backToDocs}
                  />
                ) : (
                  <RequirementsLogPanel onSelectDoc={loadDoc} />
                )
              )}
            </ErrorBoundary>
          </main>
        </div>
      </div>

      {/* 移动端侧边栏 Drawer — 对标 MobileSidebarDrawer 模式，从左侧滑入 */}
      <Drawer
        isOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        position="left"
        maxWidth={300}
        duration={350}
        ariaLabel="导航菜单"
      >
        {/* Drawer 头部 */}
        <div className="flex shrink-0 items-center justify-between gap-gm-3 px-gm-5 py-gm-4">
          <h2 className="text-gm-lg font-semibold text-text">导航</h2>
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="rounded-gm-sm p-gm-1 text-text-muted hover:bg-surface-alt transition-all"
            aria-label="关闭菜单"
          >
            <RiCloseLine className="text-gm-icon" />
          </button>
        </div>
        {/* Drawer 内容 — AdminSidebar mobile 模式 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AdminSidebar
            activeTab={activeTab}
            mobile
            onTab={(tab) => {
              handleTabChange(tab);
              setMobileSidebarOpen(false);
            }}
            onOpenSearch={() => {
              setSearchOpen(true);
              setMobileSidebarOpen(false);
            }}
          />
        </div>
      </Drawer>

      {/* 全局文档搜索模态窗 (Cmd+K) */}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        docs={flattenDocs(allDocs)}
        onSelectDoc={(item) => {
          setSearchOpen(false);
          setActiveTab("docs");
          loadDoc(item);
        }}
      />
    </ScrollLockProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TopBar — 顶部工具栏（简化版：只保留品牌 + 主题切换 + 退出）
// ═══════════════════════════════════════════════════════════════════════

function TopBar({
  onLogout,
  onOpenMobileSidebar,
}: {
  onLogout: () => void;
  onOpenMobileSidebar: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 bg-surface-elevated/80 backdrop-blur border-b border-border shadow-gm-xs shrink-0">
      {/* 品牌 accent bar — 2px 渐变条贯穿 header 顶部 */}
      <div className="h-[2px] w-full bg-brand-gradient" />
      <div className="mx-auto px-gm-5 py-gm-2_5 flex items-center justify-between">
        {/* 品牌 */}
        <div className="flex items-center gap-gm-2 select-none">
          {/* 移动端汉堡菜单 — lg:hidden，对标 Header.tsx L66-77 */}
          <button
            onClick={onOpenMobileSidebar}
            className="lg:hidden rounded-gm-md p-gm-2 text-text-secondary hover:bg-surface-alt transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
            aria-label="打开菜单"
          >
            <RiMenuLine className="text-gm-icon" />
          </button>
          <div className="w-8 h-8 rounded-gm-md bg-brand-gradient flex items-center justify-center shadow-gm-glow">
            <RiLockLine className="text-gm-sm text-white" />
          </div>
          <span className="text-gm-base font-bold text-text tracking-tight">
            GlassCortex Admin
          </span>
        </div>

        {/* 操作区：主题切换 + 退出 */}
        <div className="flex items-center gap-gm-2">
          <ThemeToggle />
          <button
            onClick={onLogout}
            className="rounded-gm-md px-gm-3 py-gm-1_5 text-gm-xs font-medium text-text-muted
                       border border-transparent
                       hover:text-red-500 hover:border-red-200 hover:bg-red-50/20
                       transition-all active:scale-[0.97]"
          >
            退出登录
          </button>
        </div>
      </div>
    </header>
  );
}

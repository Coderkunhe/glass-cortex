"use client";

/**
 * AdminSidebar — 管理面板左侧导航菜单。
 *
 * 可折叠分组 + 二级菜单项。点击菜单项切换内容区面板。
 * 桌面端固定显示，移动端隐藏（后续 Batch 补 hamburger）。
 *
 * 样式使用 brand token active 指示器模式（Phase 68 B24 升级）：
 *   border-l-[3px] border-brand text-brand bg-gradient-to-r from-brand-50/60 to-transparent font-semibold
 *
 * @module components/admin/AdminSidebar
 */

import { useState } from "react";
import {
  RiDashboardLine,
  RiFileListLine,
  RiCalendarLine,
  RiArticleLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiSearchLine,
  RiShieldCheckLine,
} from "@remixicon/react";

// ── 类型 ──────────────────────────────────────────────────────────────

/** Admin 面板 Tab 键 */
export type AdminTab = "health" | "docs" | "daily" | "requirements-log";

/** 菜单项定义 */
interface MenuItem {
  key: AdminTab;
  label: string;
  icon: React.ReactNode;
}

/** 菜单分组定义 */
interface MenuGroup {
  group: string;
  items: MenuItem[];
}

// ── 菜单数据 ──────────────────────────────────────────────────────────

const MENU_GROUPS: MenuGroup[] = [
  {
    group: "系统概览",
    items: [
      { key: "health", label: "仪表盘", icon: <RiDashboardLine size={16} /> },
    ],
  },
  {
    group: "文档管理",
    items: [
      { key: "docs", label: "文档清单", icon: <RiFileListLine size={16} /> },
      { key: "daily", label: "工作日报", icon: <RiCalendarLine size={16} /> },
      { key: "requirements-log", label: "需求日志", icon: <RiArticleLine size={16} /> },
    ],
  },
];

// ── Props ─────────────────────────────────────────────────────────────

interface AdminSidebarProps {
  activeTab: AdminTab;
  onTab: (tab: AdminTab) => void;
  /** 移动端渲染模式 — `block` 替代 `hidden lg:block`，供 Drawer 内嵌使用 */
  mobile?: boolean;
  /** 打开全局文档搜索 (Cmd+K) — 点击侧栏底部搜索提示时触发 */
  onOpenSearch?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════
// AdminSidebar
// ═══════════════════════════════════════════════════════════════════════

export default function AdminSidebar({ activeTab, onTab, mobile = false, onOpenSearch }: AdminSidebarProps) {
  return (
    <aside className={`${mobile ? "flex" : "hidden lg:flex"} flex-col w-[var(--spacing-sidebar-w)] shrink-0 border-r border-border bg-surface-lowered h-full`}>
      {/* 品牌标识区 — 侧栏顶部 */}
      <div className="shrink-0 px-gm-3 py-gm-3 border-b border-border/50">
        <div className="flex items-center gap-gm-2_5">
          <div className="w-8 h-8 rounded-gm-md bg-brand-gradient flex items-center justify-center shadow-gm-glow shrink-0">
            <RiShieldCheckLine size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-gm-sm font-bold text-text tracking-tight leading-tight">GlassCortex</p>
            <p className="text-gm-2xs text-text-muted leading-tight">工程管理面板</p>
          </div>
        </div>
      </div>

      {/* 菜单区 — flex-1 占据剩余空间，独立滚动 */}
      <div className="flex-1 overflow-y-auto py-gm-3">
        <nav>
          {MENU_GROUPS.map((group) => (
            <SidebarGroup
              key={group.group}
              group={group}
              activeTab={activeTab}
              onTab={onTab}
            />
          ))}
        </nav>
      </div>

      {/* Cmd+K 快捷键提示 — 固定在侧栏底部，点击打开全局搜索 */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="shrink-0 border-t border-border/70 px-gm-3 py-gm-3
                   w-full text-left
                   hover:bg-surface-alt/30 transition-colors
                   focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none
                   group"
        data-testid="sidebar-search-hint"
        title="搜索文档 (Cmd+K)"
        aria-label="搜索文档"
      >
        <span className="flex items-center gap-gm-2_5 text-gm-sm text-text-muted
                         group-hover:text-text-secondary transition-colors">
          <RiSearchLine size={14} className="shrink-0" />
          <span className="flex-1">搜索全部文档</span>
          <kbd className="shrink-0 bg-surface-elevated rounded-gm-xs px-gm-1.5 py-0.5
                          font-mono text-gm-2xs border border-border text-text-muted
                          group-hover:border-border-strong group-hover:text-text-secondary
                          transition-colors">
            ⌘K
          </kbd>
        </span>
      </button>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SidebarGroup — 可折叠菜单分组
// ═══════════════════════════════════════════════════════════════════════

function SidebarGroup({
  group,
  activeTab,
  onTab,
}: {
  group: MenuGroup;
  activeTab: AdminTab;
  onTab: (tab: AdminTab) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-gm-2">
      {/* 分组标题 — 可点击折叠 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-gm-1.5 px-gm-3 py-gm-1.5 text-left hover:bg-surface-alt/30 transition-colors rounded-gm-sm"
      >
        <span className="text-gm-icon text-text-muted transition-transform duration-200">
          {expanded ? <RiArrowDownSLine size={14} /> : <RiArrowRightSLine size={14} />}
        </span>
        <span className="text-gm-xs font-semibold text-text-muted tracking-wide">
          {group.group}
        </span>
      </button>

      {/* 菜单项列表 — CSS Grid 折叠动画 */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <ul className="mt-gm-0.5">
            {group.items.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <li key={item.key}>
                  <button
                    onClick={() => onTab(item.key)}
                    className={`w-full flex items-center gap-gm-2.5 px-gm-3 py-gm-2 text-left text-gm-sm transition-all border-l-[3px] ${
                      isActive
                        ? "border-brand text-brand bg-gradient-to-r from-brand-50/60 to-transparent font-semibold rounded-r-gm-sm"
                        : "border-transparent text-text-secondary hover:text-text hover:bg-surface-alt/50 hover:border-l-[3px] hover:border-border-strong rounded-r-gm-sm"
                    }`}
                  >
                    <span className={isActive ? "text-brand" : "text-text-muted"}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * AdminSidebar — 管理面板左侧导航菜单。
 *
 * 可折叠分组 + 二级菜单项。点击菜单项切换内容区面板。
 * 桌面端固定显示，移动端隐藏（后续 Batch 补 hamburger）。
 *
 * 样式继承 DocViewer TOC 侧栏的 active 指示器模式：
 *   border-l-2 border-primary text-primary bg-primary/8 font-medium
 *
 * @module components/admin/AdminSidebar
 */

import { useState } from "react";
import {
  RiHeartPulseLine,
  RiFileListLine,
  RiCalendarLine,
  RiArticleLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiSearchLine,
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
      { key: "health", label: "健康仪表盘", icon: <RiHeartPulseLine size={16} /> },
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
}

// ═══════════════════════════════════════════════════════════════════════
// AdminSidebar
// ═══════════════════════════════════════════════════════════════════════

export default function AdminSidebar({ activeTab, onTab, mobile = false }: AdminSidebarProps) {
  return (
    <aside className={`${mobile ? "block" : "hidden lg:block"} w-[var(--spacing-sidebar-w)] shrink-0 border-r border-border bg-surface-lowered h-full flex flex-col`}>
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

      {/* Cmd+K 快捷键提示 — 固定在侧栏底部，斜体提示风格 */}
      <div
        className="shrink-0 border-t border-border px-gm-3 py-gm-3 bg-surface-alt/20"
        data-testid="sidebar-search-hint"
      >
        <p className="text-gm-base text-text-muted italic flex items-center gap-gm-2">
          <RiSearchLine size={16} className="shrink-0" />
          <span>按</span>
          <kbd className="bg-surface-elevated rounded-gm-xs px-gm-1.5 py-0.5 font-mono text-gm-sm border border-border text-text">
            ⌘K
          </kbd>
          <span>搜索全部文档</span>
        </p>
      </div>
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
                    className={`w-full flex items-center gap-gm-2.5 px-gm-3 py-gm-2 text-left text-gm-sm transition-colors border-l-2 ${
                      isActive
                        ? "border-primary text-primary bg-primary/8 font-medium rounded-r-gm-sm"
                        : "border-transparent text-text-secondary hover:text-text hover:bg-surface-alt/50 rounded-r-gm-sm"
                    }`}
                  >
                    <span className={isActive ? "text-primary" : "text-text-muted"}>
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

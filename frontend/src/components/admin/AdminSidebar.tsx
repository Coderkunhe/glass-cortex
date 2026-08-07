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
  RiArrowDownSLine,
  RiArrowRightSLine,
} from "@remixicon/react";

// ── 类型 ──────────────────────────────────────────────────────────────

/** Admin 面板 Tab 键 */
export type AdminTab = "health" | "docs";

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
      { key: "health", label: "健康仪表盘", icon: <RiHeartPulseLine className="text-gm-icon" /> },
    ],
  },
  {
    group: "文档管理",
    items: [
      { key: "docs", label: "文档清单", icon: <RiFileListLine className="text-gm-icon" /> },
    ],
  },
];

// ── Props ─────────────────────────────────────────────────────────────

interface AdminSidebarProps {
  activeTab: AdminTab;
  onTab: (tab: AdminTab) => void;
}

// ═══════════════════════════════════════════════════════════════════════
// AdminSidebar
// ═══════════════════════════════════════════════════════════════════════

export default function AdminSidebar({ activeTab, onTab }: AdminSidebarProps) {
  return (
    <aside className="w-52 xl:w-56 shrink-0 border-r border-border bg-surface-lowered hidden lg:block">
      <div className="sticky top-[56px] max-h-[calc(100vh-56px)] overflow-y-auto py-gm-3">
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
    <div className="mb-gm-1">
      {/* 分组标题 — 可点击折叠 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-gm-1.5 px-gm-3 py-gm-1.5 text-left hover:bg-surface-alt/30 transition-colors"
      >
        <span className="text-gm-icon text-text-muted transition-transform duration-200">
          {expanded ? <RiArrowDownSLine size={14} /> : <RiArrowRightSLine size={14} />}
        </span>
        <span className="text-gm-xs font-semibold text-text-muted uppercase tracking-wide">
          {group.group}
        </span>
      </button>

      {/* 菜单项列表 */}
      {expanded && (
        <ul className="mt-gm-0.5">
          {group.items.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <li key={item.key}>
                <button
                  onClick={() => onTab(item.key)}
                  className={`w-full flex items-center gap-gm-2.5 px-gm-3 py-gm-2 text-left text-gm-sm transition-colors border-l-2 ${
                    isActive
                      ? "border-primary text-primary bg-primary/8 font-medium"
                      : "border-transparent text-text-secondary hover:text-text hover:bg-surface-alt/50"
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
      )}
    </div>
  );
}

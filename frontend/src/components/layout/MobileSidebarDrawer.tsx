"use client";

import Link from "next/link";
import { RiCloseLine } from "@remixicon/react";
import Drawer from "@/components/ui/Drawer";
import Sidebar from "./Sidebar";
import { MOBILE_LINKS, mobileLinkClass } from "./navLinks";

interface MobileSidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  pathname: string;
  /**
   * 页面专属抽屉底部内容。
   * - undefined（默认）：渲染全局 Sidebar（聊天参数/会话统计等）
   * - ReactNode：替换 Sidebar，渲染页面专属内容（如 /learn 的 QuestionList）
   */
  sidebarSlot?: React.ReactNode;
}

/**
 * MobileSidebarDrawer — 移动端侧边导航抽屉。
 *
 * 从 AppShell 中提取的独立组件，封装移动端 Drawer 的完整内容：
 * header（标题 + 关闭按钮）+ 页面导航链接 + Sidebar。
 *
 * 使用方式：
 *   <MobileSidebarDrawer
 *     isOpen={mobileSidebarOpen}
 *     onClose={() => setMobileSidebarOpen(false)}
 *     pathname={pathname}
 *   />
 */
export default function MobileSidebarDrawer({
  isOpen,
  onClose,
  pathname,
  sidebarSlot,
}: MobileSidebarDrawerProps) {
  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      position="left"
      maxWidth={300}
      duration={350}
      ariaLabel="导航菜单"
    >
      {/* Drawer header */}
      <div className="flex shrink-0 items-center justify-between gap-gm-3 px-gm-5 py-gm-4 appshell-drawer-header">
        <h2
          className="text-gm-lg font-semibold"
          style={{ color: "var(--gm-text)" }}
        >
          导航
        </h2>
        <button
          onClick={onClose}
          className="rounded-gm-sm p-gm-1 text-text-muted hover:bg-surface-alt transition-colors"
          aria-label="关闭菜单"
        >
          <RiCloseLine className="text-gm-icon" />
        </button>
      </div>
      {/* 内容区 — flex column：导航固定顶部，页面专属内容填充剩余空间 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 页面导航 — 移动端抽屉内显示（核心 3 页面：聊天/文档/画像） */}
        <nav className="shrink-0 flex flex-col gap-gm-1 px-gm-3 py-gm-3">
          {MOBILE_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={mobileLinkClass(href, pathname)}
              onClick={onClose}
            >
              {label}
            </Link>
          ))}
        </nav>
        {/* 分隔线 */}
        <hr className="shrink-0 mx-gm-3 appshell-drawer-divider" />
        {/* 页面专属内容：flex-1 + min-h-0 提供高度上下文，子组件自行管理滚动 */}
        <div className="flex-1 min-h-0">
          {sidebarSlot !== undefined ? sidebarSlot : <Sidebar />}
        </div>
      </div>
    </Drawer>
  );
}

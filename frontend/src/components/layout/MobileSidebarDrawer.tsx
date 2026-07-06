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
      {/* Sidebar 内容填充剩余空间 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* 页面导航 — 移动端抽屉内显示（核心 3 页面：聊天/文档/画像） */}
        <nav className="flex flex-col gap-gm-1 px-gm-3 py-gm-3">
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
        <hr className="mx-gm-3 appshell-drawer-divider" />
        <Sidebar />
      </div>
    </Drawer>
  );
}

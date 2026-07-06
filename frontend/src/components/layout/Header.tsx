"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { RiRoadMapLine, RiMenuLine } from "@remixicon/react";
import Logo from "@/components/ui/Logo";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { PAGE_LINKS, linkClass } from "./navLinks";

/** 触发收折的滚动距离阈值（px） */
const SCROLL_COMPACT_THRESHOLD = 30;

interface HeaderProps {
  /** 点击项目地图按钮的回调（由 AppShell 注入） */
  onOpenMap?: () => void;
  /** 移动端汉堡菜单回调（由 AppShell 注入）。
   *  undefined 时不渲染汉堡按钮（Learn 页等非 AppShell 页面）。 */
  onOpenMobileSidebar?: () => void;
}

/**
 * 全局 Header 组件。
 * 固定定位，含 Logo、导航（聊天 / 文档）、主题切换 + 项目地图 + 副标题。
 * 滚动时自动收折：副标题隐藏，高度缩减（仿知乎滚动收折效果）。
 * 导航项根据当前路由 active / inactive 自动切换样式。
 */
export default function Header({ onOpenMap, onOpenMobileSidebar }: HeaderProps) {
  const pathname = usePathname();
  const [isCompact, setIsCompact] = useState(false);

  /** 滚动收折：监听 main 元素滚动，超过阈值设置 compact 状态 */
  const handleScroll = useCallback(() => {
    const main = document.querySelector("main");
    if (!main) return;

    setIsCompact(main.scrollTop > SCROLL_COMPACT_THRESHOLD);
  }, []);

  useEffect(() => {
    // 寻找 AppShell 中的 main 元素（overflow-y-auto 的滚动容器）
    const main = document.querySelector("main");
    if (!main) return;

    main.addEventListener("scroll", handleScroll, { passive: true });
    return () => main.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return (
    <header
      className={`lg:col-span-2 gm-header
                 px-gm-5 py-gm-3
                 bg-surface-elevated/80 backdrop-blur
                 border-b border-border
                 shadow-gm-xs
                 ${isCompact ? "gm-header--compact" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-gm-5">
          {/* 移动端汉堡菜单 — 仅在 AppShell 注入回调时渲染 */}
          {onOpenMobileSidebar && (
            <button
              onClick={onOpenMobileSidebar}
              className="lg:hidden rounded-gm-md p-gm-2 text-text-secondary hover:bg-surface-alt transition-colors"
              aria-label="打开菜单"
              title="菜单"
            >
              <RiMenuLine className="text-gm-icon" />
            </button>
          )}
          <Link href="/" aria-label="回到首页">
            <Logo />
          </Link>
          <nav className="hidden lg:flex items-center gap-gm-1">
            {PAGE_LINKS.map(({ href, label }) => (
              <Link key={href} href={href} className={linkClass(href, pathname)}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-gm-3">
          {onOpenMap && (
            <button
              onClick={onOpenMap}
              className="rounded-gm-md p-gm-2 text-text-secondary hover:bg-surface-alt transition-colors"
              aria-label="项目地图"
              title="项目地图"
            >
              <RiRoadMapLine className="text-gm-icon" />
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
      {/* 副标题行 — 滚动时收折隐藏，左对齐锚定到 Logo */}
      <p className="gm-header__subtitle mt-gm-2 text-gm-xs text-text-muted text-left ml-[2rem]">
        逐层解剖 AI Robot 工作原理 — See How AI Remembers, Thinks, and Plans
      </p>
    </header>
  );
}

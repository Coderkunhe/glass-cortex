"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Header from "./Header";
import Sidebar from "./Sidebar";
import Footer from "./Footer";
import MobileSidebarDrawer from "./MobileSidebarDrawer";
import { DrawerProvider } from "@/components/chat/DrawerContext";
import { ChatParamsProvider } from "@/components/chat/ChatParamsContext";
import { ScrollLockProvider } from "@/components/ui/ScrollLockContext";
import ProcessDrawer from "@/components/chat/ProcessDrawer";
import ProjectMapDrawer from "@/components/layout/ProjectMapDrawer";

interface AppShellProps {
  children: React.ReactNode;
  /** 可选的桌面端侧边栏 slot。
   *   不传时渲染默认 Sidebar（聊天/画像/地图路由）；
   *   传入 ReactNode 时替换整个侧边栏区域（如 /learn 的 QuestionList）；
   *   传入 `false` 时完全隐藏侧边栏（沉浸模式）。 */
  sidebar?: React.ReactNode | false;
}

export default function AppShell({ children, sidebar }: AppShellProps) {
  const [mapOpen, setMapOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const pathname = usePathname();

  // sidebar === undefined → 未传 prop，使用默认 Sidebar
  // sidebar === false → 显式隐藏（沉浸模式）
  // sidebar 为其他 ReactNode → 渲染 slot 内容
  const sidebarContent =
    sidebar === undefined ? <Sidebar /> : sidebar;

  return (
    <ScrollLockProvider>
      <DrawerProvider>
        <ChatParamsProvider>
          <div className="grid h-dvh overflow-hidden grid-cols-1 lg:grid-cols-[auto_1fr] grid-rows-[auto_1fr_auto]">
          <Header
            onOpenMap={() => setMapOpen(true)}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          />

          {/* 桌面端侧边栏：列 1 行 2，移动端隐藏。
              slot 模式由调用方控制宽度（如 /learn 的 280px QuestionList）；
              默认 Sidebar 走 --gm-sidebar-w (256px) token。 */}
          <div className={`hidden lg:block h-full min-h-0 row-start-2 col-start-1${sidebar === undefined ? " w-[var(--spacing-sidebar-w)]" : ""}`}>
            {sidebarContent}
          </div>

          {/* 主内容：移动端列 1，桌面端列 2 */}
          <main className="overflow-y-auto min-h-0 col-start-1 lg:col-start-2">{children}</main>
          <Footer />
        </div>

        {/* 移动端侧边栏 Drawer — 从左侧滑入 */}
        <MobileSidebarDrawer
          isOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
          pathname={pathname}
        />
        {/* 全局右侧抽屉单例 — 渲染在 DOM 顶层，脱离所有布局容器 */}
        <ProcessDrawer />
        <ProjectMapDrawer
          isOpen={mapOpen}
          onClose={() => setMapOpen(false)}
        />
      </ChatParamsProvider>
    </DrawerProvider>
    </ScrollLockProvider>
  );
}

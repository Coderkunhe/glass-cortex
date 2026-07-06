/**
 * GlassCortex 首页 — 聊天主入口。
 *
 * AppShell（全局布局壳）+ ChatPanel（聊天面板）的组合入口。
 * 无客户端交互逻辑，纯编排层。
 *
 * @module app/page
 */

import AppShell from "@/components/layout/AppShell";
import ChatPanel from "@/components/chat/ChatPanel";

/** 聊天首页 — 编排 AppShell + ChatPanel */
export default function Home() {
  return (
    <AppShell>
      <ChatPanel />
    </AppShell>
  );
}

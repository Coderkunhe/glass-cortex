/**
 * GlassCortex 根布局 — 全局 HTML 骨架。
 *
 * 职责：字体加载（Geist Sans + Mono）、主题闪烁防护（beforeInteractive
 * Script）、全局 CSS 和 Remix Icon 引入。所有页面的最外层 wrapper。
 *
 * @module app/layout
 */

import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "remixicon/fonts/remixicon.css";
import "./tokens.css";
import "./theme.css";
import "./animations.css";
import "./components.css";
import "prismjs/plugins/line-numbers/prism-line-numbers.css";

/** localStorage 主题键名 */
const THEME_STORAGE_KEY = "gm-theme";
/** 未设置主题时的默认值 */
const DEFAULT_THEME = "dark";

/** Geist Sans — 正文字体，Latin 子集 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/** Geist Mono — 等宽字体，Latin 子集 */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** 页面元数据（title + description） */
export const metadata: Metadata = {
  title: "GlassCortex — See How AI Remembers, Thinks, and Plans",
  description:
    "逐层解剖 AI Robot 工作原理 — 记忆形成、上下文工程、Token 监控、意图识别与任务规划",
};

/** 根布局组件 — 全局 HTML 骨架 + 主题闪烁防护 + 字体变量注入 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head />
      <body className="min-h-screen bg-bg text-text antialiased overflow-hidden">
        <Script
          id="theme-flicker-prevent"
          strategy="beforeInteractive"
        >
          {`(function() {
  var theme = localStorage.getItem('${THEME_STORAGE_KEY}') || '${DEFAULT_THEME}';
  document.documentElement.setAttribute('data-theme', theme);
})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}

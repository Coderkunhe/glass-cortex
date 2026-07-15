"use client";

import { useEffect, useState } from "react";
import { RiSunLine, RiMoonLine } from "@remixicon/react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("gm-theme") as
        | "light"
        | "dark"
        | null;
      if (stored) return stored;
    }
    return "dark";
  });
  const [mounted, setMounted] = useState(false);

  // 仅在 hydration 完成后标记 mounted（通过 setTimeout 避免同步 setState 触发 React 19 警告）
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  // 同步 data-theme 属性到 <html>，确保 tokens.css 的 [data-theme] 选择器
  // 在首帧即生效。toggle() 中也立即设置以避免切换闪烁，此 effect 兜底 mount。
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("gm-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  // hydration 前渲染占位（图标占位 width/height 防布局偏移）
  if (!mounted) {
    return (
      <button
        className="rounded-gm-md p-gm-2 text-text-secondary hover:bg-surface-alt transition-colors focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
        aria-label="切换主题"
      >
        <div className="text-gm-icon h-6 w-6" />
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className="rounded-gm-md p-gm-2 text-text-secondary hover:bg-surface-alt transition-colors focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
      aria-label={`切换到${theme === "dark" ? "亮色" : "暗色"}模式`}
    >
      {theme === "dark" ? (
        <RiSunLine className="text-gm-icon" />
      ) : (
        <RiMoonLine className="text-gm-icon" />
      )}
    </button>
  );
}

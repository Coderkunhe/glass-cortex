"use client";

import { useState, useEffect } from "react";

/**
 * 监听 document.documentElement 的 data-theme 属性变化，
 * 返回当前是否为暗色主题。
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.documentElement.getAttribute("data-theme") === "dark";
  });

  useEffect(() => {
    const htmlEl = document.documentElement;
    const check = () => {
      const dark = htmlEl.getAttribute("data-theme") === "dark";
      setIsDark(dark);
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          check();
          return;
        }
      }
    });

    observer.observe(htmlEl, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

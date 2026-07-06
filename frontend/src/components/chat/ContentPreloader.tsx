/**
 * ContentPreloader — 内容章节空闲预加载器。
 *
 * 在聊天页空闲时调用 loadAllChaptersParallel() 预加载全部 8 章内容，
 * 触发动态 import() 的 webpack chunk 加载和模块缓存，
 * 让用户导航到 /learn 页面时章节代码和内容数据已在浏览器缓存中，实现秒开。
 *
 * 使用 requestIdleCallback（Safari/FF 回退到 setTimeout 200ms fallback）。
 * 零视觉影响，不渲染任何 UI。
 *
 * @module components/chat/ContentPreloader
 */

"use client";

import { useEffect } from "react";
import { loadAllChaptersParallel } from "@/lib/content/questions";

/**
 * 空闲预加载全部章节内容。
 * 仅在浏览器环境执行——SSR 阶段为 no-op。
 */
function preloadAllChapters(): void {
  // 安全检测：仅在浏览器环境执行
  if (typeof window === "undefined") return;

  /** 真正的预加载函数 */
  const doLoad = () => {
    loadAllChaptersParallel().catch(() => {
      // 静默失败——预加载是优化而非必需，不阻塞用户
    });
  };

  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(doLoad, { timeout: 3000 });
    // 不清理 idle callback——组件卸载时没必要取消预加载
    void id;
  } else {
    // Safari/旧版 Firefox 的 fallback
    setTimeout(doLoad, 200);
  }
}

/**
 * ContentPreloader 组件 — 挂载后空闲时预加载 /learn 章节内容。
 * 无视觉输出，可安全嵌入任何客户端组件。
 */
export default function ContentPreloader() {
  useEffect(() => {
    preloadAllChapters();
  }, []);

  // 零视觉组件：隐藏 span 占位供测试定位
  return <span data-testid="content-preloader" hidden />;
}

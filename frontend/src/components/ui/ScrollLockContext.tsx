"use client";

import { createContext, useContext, useRef, useCallback, type ReactNode } from "react";

/**
 * ScrollLockContext — 管理 body 滚动锁的引用计数。
 *
 * 替代 Drawer 中原有的模块级 `_lockCount` 可变变量。
 * 每个 Provider 实例独立持有锁计数和保存的样式值，
 * 消除模块级可变状态，使测试隔离和 HMR 更安全。
 *
 * 使用方式：
 *   ScrollLockProvider > Drawer（Drawer 内部调用 useScrollLock()）
 */

interface ScrollLockAPI {
  /** 注册一个锁持有者。返回取消注册的清理函数。 */
  register: () => () => void;
}

const ScrollLockContext = createContext<ScrollLockAPI | null>(null);

export function ScrollLockProvider({ children }: { children: ReactNode }) {
  const lockCountRef = useRef(0);
  const savedStylesRef = useRef({
    bodyOverflow: "",
    bodyPaddingRight: "",
    htmlOverflow: "",
  });

  const register = useCallback((): (() => void) => {
    const saved = savedStylesRef.current;

    if (lockCountRef.current === 0) {
      saved.bodyOverflow = document.body.style.overflow;
      saved.bodyPaddingRight = document.body.style.paddingRight;
      saved.htmlOverflow = document.documentElement.style.overflow;

      const scrollbarW =
        window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      if (scrollbarW > 0) {
        document.body.style.paddingRight = `${scrollbarW}px`;
        document.documentElement.style.setProperty(
          "--gm-scrollbar-w",
          `${scrollbarW}px`,
        );
      }
    }

    lockCountRef.current++;

    let released = false;
    return () => {
      if (released) return;
      released = true;

      lockCountRef.current = Math.max(0, lockCountRef.current - 1);
      if (lockCountRef.current === 0) {
        document.body.style.overflow = saved.bodyOverflow;
        document.body.style.paddingRight = saved.bodyPaddingRight;
        document.documentElement.style.overflow = saved.htmlOverflow;
        document.documentElement.style.removeProperty("--gm-scrollbar-w");
      }
    };
  }, []);

  return (
    <ScrollLockContext.Provider value={{ register }}>
      {children}
    </ScrollLockContext.Provider>
  );
}

/**
 * 获取 body 滚动锁的注册/取消注册方法。
 *
 * 在 useEffect 中调用 `register()` 获取清理函数，
 * 在 effect cleanup 中调用清理函数释放锁。
 */
export function useScrollLock() {
  const ctx = useContext(ScrollLockContext);
  // Graceful degradation: when Provider is missing (tests, standalone usage),
  // return a no-op so Drawer doesn't crash. Body scroll locking is irrelevant
  // in jsdom anyway. In production AppShell always wraps in ScrollLockProvider.
  if (!ctx) {
    if (
      typeof window !== "undefined" &&
      process.env.NODE_ENV === "development"
    ) {
      console.warn(
        "[ScrollLockContext] useScrollLock() called without a <ScrollLockProvider>. " +
          "Body scroll locking is disabled.",
      );
    }
    return { register: () => () => {} };
  }
  return ctx;
}

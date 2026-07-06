"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * SSR-safe localStorage 持久化 hook。
 *
 * - 初始渲染始终返回 `defaultValue`（SSR + 首帧一致，避免 hydration mismatch）
 * - `useEffect` 在挂载后从 localStorage 恢复存储值（仅执行一次）
 * - 自定义 setter 在值变化时同步写入 `localStorage`（无额外 effect）
 * - `try/catch` 兜底私有模式 / 配额溢出场景
 * - 通过 JSON 序列化支持任意可序列化类型
 *
 * @param key localStorage key
 * @param defaultValue 初始值 / localStorage 不可用时的回退值
 * @returns `[value, setValue]` 类型安全的 useState 签名
 *
 * @example
 * ```ts
 * const [lastRead, setLastRead] = useLocalStorage("gm-learn-last-read", null);
 * ```
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(defaultValue);

  // 仅在客户端挂载后从 localStorage 恢复一次。
  // 级联渲染（SSR defaultValue → 首帧 defaultValue → hydration 恢复存储值）是 SSR-safe 模式的必要代价。
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue(JSON.parse(stored) as T);
      }
    } catch {
      // localStorage 不可用时静默失败
    }
    // 仅在 mount 时执行一次，不含 key 变化后重新读取的语义
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自定义 setter：值变化时同步写入 localStorage
  const setAndPersist = useCallback(
    (action: React.SetStateAction<T>) => {
      setValue((prev) => {
        const next =
          typeof action === "function"
            ? (action as (prev: T) => T)(prev)
            : action;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // localStorage 不可用时静默失败
        }
        return next;
      });
    },
    [key],
  );

  return [value, setAndPersist];
}

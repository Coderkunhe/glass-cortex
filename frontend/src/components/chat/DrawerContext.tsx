"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import type { ApiTrace } from "@/lib/api/types";

// ── Context value type ────────────────────────────────────────────────

interface DrawerContextValue {
  /** 抽屉是否打开 */
  isOpen: boolean;
  /** 当前显示 trace——打开时一定有值 */
  trace: ApiTrace | null;
  /** 触发该抽屉的消息 ID（可用于跳转来源） */
  activeTraceId: string | null;
  /** 打开抽屉 */
  openDrawer: (trace: ApiTrace, traceId?: string) => void;
  /** 关闭抽屉 */
  closeDrawer: () => void;
  /** 设置关闭时数据清空延迟 (ms) —— 应对不同 Drawer 的动画时长差异 */
  setCloseDuration: (ms: number) => void;
}

// ── Context ───────────────────────────────────────────────────────────

const DrawerContext = createContext<DrawerContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [trace, setTrace] = useState<ApiTrace | null>(null);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  // 递增计数器 — 用于竞态检测：close 后快速 open → 旧 timeout 不会覆盖新 trace
  const closeIdRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // S1: 可配置的数据清空延迟 — 对齐不同 Drawer 的动画时长 (默认 420ms = --gm-duration-drawer)
  const closeDurationRef = useRef(420);

  // 组件卸载时清理 pending timer
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const openDrawer = useCallback(
    (t: ApiTrace, traceId?: string) => {
      // 递增 close ID — 任何 pending close timeout 的回调检测到 ID 不匹配时会跳过
      closeIdRef.current += 1;
      setTrace(t);
      setActiveTraceId(traceId ?? null);
      setIsOpen(true);
    },
    [],
  );

  const setCloseDuration = useCallback((ms: number) => {
    closeDurationRef.current = ms;
  }, []);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    const thisCloseId = closeIdRef.current;
    // 延迟清空 data 让退出动画跑完再释放内存 — 延迟量由 closeDurationRef 控制
    closeTimerRef.current = setTimeout(() => {
      // 竞态检测：如果在 timeout 期间又 open 了，跳过清空
      if (closeIdRef.current !== thisCloseId) return;
      closeTimerRef.current = null;
      setTrace(null);
      setActiveTraceId(null);
    }, closeDurationRef.current);
  }, []);

  const value = useMemo<DrawerContextValue>(
    () => ({ isOpen, trace, activeTraceId, openDrawer, closeDrawer, setCloseDuration }),
    [isOpen, trace, activeTraceId, openDrawer, closeDrawer, setCloseDuration],
  );

  return (
    <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useDrawer(): DrawerContextValue {
  const ctx = useContext(DrawerContext);
  if (!ctx) {
    throw new Error("useDrawer must be used within a <DrawerProvider>");
  }
  return ctx;
}

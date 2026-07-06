/**
 * ChatParamsContext — 聊天参数与会话统计上下文（B101 拆分版）。
 *
 * R6 结构性风险修复：原先 22 字段打包在单一 Context 中，任一字段变化导致
 * 全部 13 消费者重渲染。现按更新频率拆为三个独立 Context：
 *
 *   ParamStateContext   — 慢变（用户调参）：l2/l3/l5/l6 + setters + toChatParams + resetToDefaults
 *   SessionStatsContext — 快变（每消息）：stats + setMemoryCount + setSessionTokens + incrementMessageCount
 *   ModelRoutingContext — 中变（每响应）：lastRouting + setLastRouting + routingOverrideModel + setRoutingOverrideModel
 *
 * ChatParamsProvider 组合三个 Provider，保持向后兼容。
 * 消费者按需订阅精确 hook，避免无关更新触发的重渲染。
 *
 * @module components/chat/ChatParamsContext
 */

"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { ChatParams, SessionStats, SessionTokenStats } from "@/lib/chatParams";
import type { RoutingInfo } from "@/lib/api/types-chat";
import {
  DEFAULT_L2_RECALL,
  DEFAULT_L3_CONTEXT,
  DEFAULT_L5_INFERENCE,
  DEFAULT_L6_DECAY,
  type L2RecallParams,
  type L3ContextParams,
  type L5InferenceParams,
  type L6DecayParams,
} from "@/lib/chatParams";

// ═══════════════════════════════════════════════════════════════════════════
// ParamStateContext — 慢变：认知参数 + setters
// ═══════════════════════════════════════════════════════════════════════════

interface ParamStateValue {
  l2: L2RecallParams;
  l3: L3ContextParams;
  l5: L5InferenceParams;
  l6: L6DecayParams;
  setL2: (patch: Partial<L2RecallParams>) => void;
  setL3: (patch: Partial<L3ContextParams>) => void;
  setL5: (patch: Partial<L5InferenceParams>) => void;
  setL6: (patch: Partial<L6DecayParams>) => void;
  /** 导出为传给 useChat 的最小参数集。routingOverrideModel 由调用方传入。 */
  toChatParams: (routingOverrideModel?: string | null) => ChatParams;
  /** 一键重置所有参数和统计到默认值（横跨三 Context 的组合操作）。 */
  resetToDefaults: () => void;
}

const ParamStateContext = createContext<ParamStateValue | null>(null);

// ═══════════════════════════════════════════════════════════════════════════
// SessionStatsContext — 快变：会话统计
// ═══════════════════════════════════════════════════════════════════════════

interface SessionStatsValue {
  stats: SessionStats;
  setMemoryCount: (count: number) => void;
  setSessionTokens: (tokens: SessionTokenStats) => void;
  incrementMessageCount: () => void;
}

const SessionStatsContext = createContext<SessionStatsValue | null>(null);

// ═══════════════════════════════════════════════════════════════════════════
// ModelRoutingContext — 中变：路由决策 + 模型覆盖
// ═══════════════════════════════════════════════════════════════════════════

interface ModelRoutingValue {
  lastRouting: RoutingInfo | null;
  setLastRouting: (routing: RoutingInfo | null) => void;
  routingOverrideModel: string | null;
  setRoutingOverrideModel: (model: string | null) => void;
}

const ModelRoutingContext = createContext<ModelRoutingValue | null>(null);

// ═══════════════════════════════════════════════════════════════════════════
// ChatParamsProvider — 组合 Provider（向后兼容）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ChatParamsProvider — 聊天参数上下文提供者（组合版）。
 *
 * 内部管理三个独立 Context 的状态，通过组合 Provider 暴露。
 * 接口与拆分前完全一致，所有现有 <ChatParamsProvider> 使用点零改动。
 */
export function ChatParamsProvider({ children }: { children: ReactNode }) {
  // ── Param state ──
  const [l2, setL2State] = useState<L2RecallParams>(DEFAULT_L2_RECALL);
  const [l3, setL3State] = useState<L3ContextParams>(DEFAULT_L3_CONTEXT);
  const [l5, setL5State] = useState<L5InferenceParams>(DEFAULT_L5_INFERENCE);
  const [l6, setL6State] = useState<L6DecayParams>(DEFAULT_L6_DECAY);

  // ── Stats state ──
  const [messageCount, setMessageCount] = useState(0);
  const [memoryCount, setMemoryCountState] = useState(0);
  const [sessionTokens, setSessionTokensState] = useState<SessionTokenStats>({
    input: 0,
    output: 0,
    turns: 0,
    cost: 0,
    hasPricing: false,
  });
  const [sessionStart, setSessionStart] = useState(() => Date.now());

  // ── Routing state ──
  const [lastRouting, setLastRouting] = useState<RoutingInfo | null>(null);
  const [routingOverrideModel, setRoutingOverrideModel] = useState<string | null>(null);

  // ── Param setters (stable refs) ──
  const setL2 = useCallback((patch: Partial<L2RecallParams>) => {
    setL2State((prev) => ({ ...prev, ...patch }));
  }, []);

  const setL3 = useCallback((patch: Partial<L3ContextParams>) => {
    setL3State((prev) => ({ ...prev, ...patch }));
  }, []);

  const setL5 = useCallback((patch: Partial<L5InferenceParams>) => {
    setL5State((prev) => ({ ...prev, ...patch }));
  }, []);

  const setL6 = useCallback((patch: Partial<L6DecayParams>) => {
    setL6State((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── Stats setters (stable refs) ──
  const setMemoryCount = useCallback((count: number) => {
    setMemoryCountState(count);
  }, []);

  const setSessionTokens = useCallback((tokens: SessionTokenStats) => {
    setSessionTokensState(tokens);
  }, []);

  const incrementMessageCount = useCallback(() => {
    setMessageCount((prev) => prev + 1);
  }, []);

  // ── Cross-cutting: toChatParams (accepts routingOverrideModel as param) ──
  const toChatParams = useCallback(
    (overrideModel?: string | null): ChatParams => {
      return {
        context_window_size: l3.window_size,
        context_overflow_strategy: l3.overflow_strategy,
        model: overrideModel ?? undefined,
        temperature: l5.temperature,
        max_tokens: l5.max_tokens,
      };
    },
    [l3, l5],
  );

  // ── Cross-cutting: resetToDefaults (resets all three domains) ──
  const resetToDefaults = useCallback(() => {
    setL2State(DEFAULT_L2_RECALL);
    setL3State(DEFAULT_L3_CONTEXT);
    setL5State(DEFAULT_L5_INFERENCE);
    setL6State(DEFAULT_L6_DECAY);
    setMessageCount(0);
    setMemoryCountState(0);
    setSessionTokensState({ input: 0, output: 0, turns: 0, cost: 0, hasPricing: false });
    setLastRouting(null);
    setRoutingOverrideModel(null);
    setSessionStart(Date.now());
  }, []);

  // ── Stats derived object (memoized — only changes when stats fields change) ──
  const stats = useMemo<SessionStats>(
    () => ({
      messageCount,
      memoryCount,
      sessionTokens,
      sessionStart,
    }),
    [messageCount, memoryCount, sessionTokens, sessionStart],
  );

  // ── Context values (each memoized with minimal dep set — the core fix for R6) ──
  const paramStateValue = useMemo<ParamStateValue>(
    () => ({ l2, l3, l5, l6, setL2, setL3, setL5, setL6, toChatParams, resetToDefaults }),
    [l2, l3, l5, l6, setL2, setL3, setL5, setL6, toChatParams, resetToDefaults],
  );

  const sessionStatsValue = useMemo<SessionStatsValue>(
    () => ({ stats, setMemoryCount, setSessionTokens, incrementMessageCount }),
    [stats, setMemoryCount, setSessionTokens, incrementMessageCount],
  );

  const modelRoutingValue = useMemo<ModelRoutingValue>(
    () => ({ lastRouting, setLastRouting, routingOverrideModel, setRoutingOverrideModel }),
    [lastRouting, setLastRouting, routingOverrideModel, setRoutingOverrideModel],
  );

  return (
    <ParamStateContext.Provider value={paramStateValue}>
      <SessionStatsContext.Provider value={sessionStatsValue}>
        <ModelRoutingContext.Provider value={modelRoutingValue}>
          {children}
        </ModelRoutingContext.Provider>
      </SessionStatsContext.Provider>
    </ParamStateContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hooks — 精确订阅
// ═══════════════════════════════════════════════════════════════════════════

/** 订阅慢变参数域（l2/l3/l5/l6 + setters + toChatParams + resetToDefaults）。 */
export function useParamState(): ParamStateValue {
  const ctx = useContext(ParamStateContext);
  if (!ctx) {
    throw new Error("useParamState must be used within a <ChatParamsProvider>");
  }
  return ctx;
}

/** 订阅快变统计域（stats + setMemoryCount + setSessionTokens + incrementMessageCount）。 */
export function useSessionStats(): SessionStatsValue {
  const ctx = useContext(SessionStatsContext);
  if (!ctx) {
    throw new Error("useSessionStats must be used within a <ChatParamsProvider>");
  }
  return ctx;
}

/** 订阅中变路由域（lastRouting + setLastRouting + routingOverrideModel + setRoutingOverrideModel）。 */
export function useModelRouting(): ModelRoutingValue {
  const ctx = useContext(ModelRoutingContext);
  if (!ctx) {
    throw new Error("useModelRouting must be used within a <ChatParamsProvider>");
  }
  return ctx;
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy aggregate hook — 向后兼容，逐步迁移消费者到精确 hook
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated 使用 useParamState / useSessionStats / useModelRouting 精确订阅。
 *  保留此 hook 以支持渐进迁移。 */
export function useChatParams(): ParamStateValue & SessionStatsValue & ModelRoutingValue {
  const param = useContext(ParamStateContext);
  const stats = useContext(SessionStatsContext);
  const routing = useContext(ModelRoutingContext);
  if (!param || !stats || !routing) {
    throw new Error("useChatParams must be used within a <ChatParamsProvider>");
  }
  return { ...param, ...stats, ...routing };
}

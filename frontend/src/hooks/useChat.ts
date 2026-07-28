"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api/client";
import type { ChatResponse, SessionForgetResponse } from "@/lib/api/types";
import type { ChatParams } from "@/lib/chatParams";
import { categorizeError } from "@/lib/errorCategories";
import type { CategorizedError } from "@/lib/errorCategories";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 消息创建时间（毫秒时间戳），用于显示相对时间 */
  createdAt: number;
  response?: ChatResponse;
}

type SendStatus = "idle" | "loading" | "streaming" | "success" | "error";

/** 认知参数获取器——每次发送消息时调用，读取最新参数值。
 *  使用 getter 而非传值，避免参数变化导致 sendMessage 重建。
 *
 *  @param getParams — 每次发送时获取最新 ChatParams 的 getter
 *  @param streamEnabled — 是否启用 SSE 流式输出（默认 true）。
 *    false 时使用非流式 POST /chat，一次性返回完整响应。 */
export function useChat(getParams?: () => ChatParams, streamEnabled: boolean = true) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<SendStatus>("idle");
  const [error, setError] = useState<CategorizedError | null>(null);

  // AbortController ref — 每次 sendMessage 创建新的，abort() 取消当前请求
  const abortRef = useRef<AbortController | null>(null);

  // 会话标识 — mount 时生成，组件生命周期内稳定。
  // ChatRequest.session_id 字段 B20 已添加，此处开始透传。
  const sessionIdRef = useRef<string>("");
  useEffect(() => {
    sessionIdRef.current = crypto.randomUUID();
  }, []);

  // C7: 组件卸载时取消进行中的请求，防止 setState on unmounted component
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Phase 66 B22 — 遗忘操作结果状态
  const [forgetResult, setForgetResult] = useState<SessionForgetResponse | null>(null);
  const [forgetError, setForgetError] = useState<CategorizedError | null>(null);

  // ref 模式：始终持有最新 getter + streamEnabled，sendMessage 身份稳定
  const getParamsRef = useRef(getParams);
  useEffect(() => {
    getParamsRef.current = getParams;
  });

  const streamEnabledRef = useRef(streamEnabled);
  useEffect(() => {
    streamEnabledRef.current = streamEnabled;
  });

  /** M10: abort 时取消请求 + 清理孤儿用户消息 + 重置状态。
   *  AbortError 在 sendMessage 的 catch 中被静默处理，但乐观追加的用户消息
   *  已进入 messages 数组——此处同步移除，避免用户看到无响应的孤儿消息。
   *  向后扫描找最后一条 user 消息（可能不是数组最后一个——若前一条 send 已
   *  在 abort 前完成，其 assistant 会排在 orphan 之后）。 */
  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages((prev) => {
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") { lastUserIdx = i; break; }
      }
      if (lastUserIdx === -1) return prev;
      // B135: streaming appends assistant immediately after user;
      // remove user AND everything after it (the incomplete assistant).
      return prev.slice(0, lastUserIdx);
    });
    setStatus("idle");
    setError(null);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: Date.now(),
    };

    const controller = new AbortController();
    abortRef.current = controller;

    // B136 — 根据流式开关分支
    if (streamEnabledRef.current) {
      // ── 流式路径：预创建空的 assistant 消息，逐 token 填充 ──
      const assistantId = crypto.randomUUID();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setStatus("streaming");
      setError(null);

      try {
        const params = getParamsRef.current?.() ?? {};
        const response = await api.chatStream(
          {
            user_input: content,
            session_id: sessionIdRef.current,
            context_window_size: params.context_window_size,
            context_overflow_strategy: params.context_overflow_strategy,
            model: params.model || undefined,
            temperature: params.temperature ?? undefined,
            max_tokens: params.max_tokens ?? undefined,
            include_system_prompt: true,
          },
          (delta: string) => {
            setMessages((prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === "assistant" && updated[i].id === assistantId) {
                  updated[i] = { ...updated[i], content: updated[i].content + delta };
                  break;
                }
              }
              return updated;
            });
          },
          { signal: controller.signal },
        );

        // 流完成——用完整响应数据更新 assistant 消息
        setMessages((prev) => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === "assistant" && updated[i].id === assistantId) {
              updated[i] = { ...updated[i], response };
              break;
            }
          }
          return updated;
        });
        setStatus("success");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setStatus("idle");
          return;
        }
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setError(categorizeError(err));
        setStatus("error");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    } else {
      // ── 非流式路径：等待完整响应后一次性渲染 ──
      setMessages((prev) => [...prev, userMessage]);
      setStatus("loading");
      setError(null);

      try {
        const params = getParamsRef.current?.() ?? {};
        const response = await api.chat(
          {
            user_input: content,
            session_id: sessionIdRef.current,
            context_window_size: params.context_window_size,
            context_overflow_strategy: params.context_overflow_strategy,
            model: params.model || undefined,
            temperature: params.temperature ?? undefined,
            max_tokens: params.max_tokens ?? undefined,
            include_system_prompt: true,
          },
          { signal: controller.signal },
        );

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.response_text,
          createdAt: Date.now(),
          response,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setStatus("success");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setStatus("idle");
          return;
        }
        // 非流式错误：用户消息已保留，仅设错误状态
        setError(categorizeError(err));
        setStatus("error");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    }
  }, []);

  /** 纯本地清除——不触发遗忘，仅重置 React state。
   *  Phase 66 B22：保留此方法供内部/测试使用；用户"清除对话"入口应走 forgetSession。 */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setStatus("idle");
    setError(null);
  }, []);

  /** Phase 66 B22 — 按当前 session_id 定向遗忘全部对话记忆。
   *
   *  调用 POST /session/forget 触发：
   *  1. 后端级联删除（episodes → facts → recall_log → confidence_log → FAISS）
   *  2. 前端清空消息列表
   *  3. 返回删除统计摘要供 UI 展示
   *
   *  失败时抛出异常，由调用方（ChatPanel）在 ConfirmModal 中展示错误。 */
  const forgetSession = useCallback(async (): Promise<SessionForgetResponse> => {
    setForgetError(null);
    try {
      const result = await api.forgetSession({ session_id: sessionIdRef.current });
      setForgetResult(result);
      clearMessages();
      return result;
    } catch (err) {
      const categorized = categorizeError(err);
      setForgetError(categorized);
      throw err;
    }
  }, [clearMessages]);

  /** M9: 移除最后一条用户消息——供 retry 流程使用。
   *  Error retry 会 sendMessage 相同内容，若不移除旧消息则出现两条相同用户消息。 */
  const removeLastUserMessage = useCallback(() => {
    setMessages((prev) => {
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") { lastUserIdx = i; break; }
      }
      if (lastUserIdx === -1) return prev;
      return [...prev.slice(0, lastUserIdx), ...prev.slice(lastUserIdx + 1)];
    });
  }, []);

  return {
    messages,
    status,
    error,
    sendMessage,
    abort,
    clearMessages,
    forgetSession,
    forgetResult,
    forgetError,
    removeLastUserMessage,
  };
}

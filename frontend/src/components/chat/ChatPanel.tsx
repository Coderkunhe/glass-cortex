/**
 * ChatPanel — 聊天页主面板组件。
 *
 * 职责：编排聊天消息列表、欢迎视图、输入区和错误处理。
 * 通过 useChat hook 管理消息流，useChatParams 管理参数/统计上下文。
 *
 * @module components/chat/ChatPanel
 */

"use client";

import { useMemo, useEffect, useRef, useState } from "react";
import {
  RiArchiveStackLine,
  RiBarChart2Line,
  RiBrainLine,
  RiCheckLine,
  RiCloseLine,
  RiCompassDiscoverLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiQuestionLine,
} from "@remixicon/react";
import Link from "next/link";
import ErrorDisplay from "@/components/ui/ErrorDisplay";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ContextualLens from "@/components/chat/ContextualLens";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import { extractMermaidFromAnswer } from "@/lib/content/extractMermaid";
import { CH7_ANSWERS } from "@/lib/content/answers/ch7";
import { useChat } from "@/hooks/useChat";
import type { ApiTrace, IntentResult, RoutingInfo } from "@/lib/api/types";
import ChatInput from "./ChatInput";
import ContentPreloader from "./ContentPreloader";
import { useParamState, useSessionStats, useModelRouting } from "./ChatParamsContext";
import ChatMessage from "./ChatMessage";
import { aggregateBreakdowns } from "@/components/layout/SessionTokenGauge";
import type { TokenBreakdown } from "@/components/chat/TokenCostBadge";

/** q7.6 错误教学化决策树 — 从答案内容提取 mermaid 图，单一真相源 */
const _q7_6answer = CH7_ANSWERS.find((a) => a.id === "q7.6");
const q7_6chart = _q7_6answer ? extractMermaidFromAnswer(_q7_6answer) : null;

/** 功能特色卡片数据 */
const FEATURES = [
  {
    icon: RiArchiveStackLine,
    title: "透明化记忆",
    desc: "观察 AI 如何存储、召回和遗忘信息，看到每次对话中的记忆生命周期",
  },
  {
    icon: RiBarChart2Line,
    title: "上下文可视化",
    desc: "实时查看上下文窗口的分区占比，理解 Token 如何分配到系统、记忆和对话",
  },
  {
    icon: RiCompassDiscoverLine,
    title: "意图识别",
    desc: "AI 自动分类你的问题类型，展示 Planner 如何规划和理解你的需求",
  },
] as const;

/** 快速开始步骤数据 */
const STEPS = [
  {
    num: 1,
    title: "发送消息",
    desc: "在下方输入框提问，观察 AI 思考过程",
  },
  {
    num: 2,
    title: "展开 Onion",
    desc: "点击消息旁的展开按钮，逐层查看推理细节",
  },
  {
    num: 3,
    title: "学习更多",
    desc: "访问文档页面，深入了解 93 个 AI 认知知识点",
  },
] as const;

/** 好奇心引导按钮数据 */
const CURIOSITY_BUTTONS = [
  {
    icon: "💬",
    label: "跟我聊聊",
    message: "你好！我想了解你是怎么工作的，你会记住我说的话吗？",
  },
  {
    icon: "🧪",
    label: "看一次旅程",
    message:
      "详细解释一下你刚才在处理我的消息时，经历了哪些步骤？请按顺序说明。",
  },
  {
    icon: "🔍",
    label: "解释 Token",
    message:
      "请用大白话解释什么是 Token，最好用一个生活中的例子，并说明为什么要计算它。",
  },
] as const;

/** 空状态欢迎卡片 */
function WelcomeView({ onSend }: { onSend: (message: string) => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-gm-6 px-gm-4">
        {/* ── Hero 区域 ── */}
        <div className="flex flex-col items-center gap-gm-3 text-center animate-gm-fade-in">
          <RiBrainLine className="text-5xl text-brand" />
          <h1
            className="bg-gradient-to-br from-brand-600 via-brand to-brand-light
                       bg-clip-text text-gm-3xl font-bold text-transparent"
          >
            欢迎来到 GlassCortex
          </h1>
          <p className="max-w-xl text-gm-lg text-text-muted">
            探索 AI 认知层的运行机制——记忆如何形成、上下文如何组装、Token
            如何流动
          </p>
        </div>

        {/* ── 功能特色卡片 ── */}
        <div className="grid w-full grid-cols-1 gap-gm-4 md:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <div
              key={feature.title}
              className="animate-gm-slide-in rounded-gm-lg border border-border bg-surface-elevated
                         p-gm-5 shadow-gm-sm"
              style={{ animationDelay: `${i * 150}ms` }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center
                           rounded-xl bg-brand/10 text-brand"
              >
                <feature.icon className="text-gm-xl" />
              </div>
              <h2 className="mt-gm-3 text-gm-base font-semibold">
                {feature.title}
              </h2>
              <p className="mt-gm-1 text-gm-sm text-text-muted">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>

        {/* ── 快速开始 ── */}
        <div className="w-full animate-gm-fade-in">
          <h2 className="mb-gm-4 text-gm-lg font-semibold">快速开始</h2>
          <div className="flex flex-col gap-gm-4 sm:flex-row">
            {STEPS.map((step) => (
              <div
                key={step.num}
                className="flex flex-1 items-start gap-gm-3"
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center
                             rounded-full bg-brand text-gm-sm font-bold text-text-inverse"
                >
                  {step.num}
                </span>
                <div>
                  <p className="text-gm-sm font-semibold">{step.title}</p>
                  <p className="text-gm-xs text-text-muted">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 好奇心引导按钮 ── */}
        <div className="w-full animate-gm-fade-in">
          <p className="mb-gm-3 text-gm-sm font-semibold text-text">
            👇 选一个话题，开始体验
          </p>
          <div className="flex flex-wrap gap-gm-2">
            {CURIOSITY_BUTTONS.map((btn) => (
              <button
                key={btn.label}
                onClick={() => onSend(btn.message)}
                aria-label={btn.label}
                className="inline-flex items-center gap-gm-1_5
                           rounded-gm-md border border-border
                           bg-surface-elevated px-gm-3 py-gm-1_5
                           text-gm-sm text-text-secondary
                           hover:text-text hover:border-text-muted
                           hover:shadow-gm-sm
                           focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                           active:scale-[0.98]
                           transition-all gm-card-lift cursor-pointer"
              >
                <span className="text-gm-base" aria-hidden="true">{btn.icon}</span>
                <span>{btn.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── 引导链接 ── */}
        <Link
          href="/learn"
          className="text-gm-sm text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
        >
          深入了解 AI 认知层 →
        </Link>
      </div>
    </div>
  );
}

/** 加载阶段文案 — 按耗时渐进展示，给用户进度感知 */
const LOADING_STAGES = [
  { thresholdMs: 0, text: "正在理解问题…" },
  { thresholdMs: 1500, text: "正在检索记忆…" },
  { thresholdMs: 3500, text: "正在生成回复…" },
] as const;

/** 聊天页主面板 — 编排欢迎视图、消息列表、错误处理和输入区 */
export default function ChatPanel() {
  const { toChatParams, resetToDefaults } = useParamState();
  const { setMemoryCount, incrementMessageCount, setSessionTokens } = useSessionStats();
  const { setLastRouting, routingOverrideModel } = useModelRouting();
  const { messages, status, error, sendMessage, abort, forgetSession, removeLastUserMessage } = useChat(() => toChatParams(routingOverrideModel));
  const isLoading = status === "loading";
  const isEmpty = messages.length === 0 && status === "idle";

  // Phase 66 B22 — 清除对话 ConfirmModal 状态
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [forgetLoading, setForgetLoading] = useState(false);
  const [forgetModalError, setForgetModalError] = useState<string | null>(null);
  // 遗忘成功后短暂展示摘要横幅
  const [forgetBanner, setForgetBanner] = useState<{ episodes: number; facts: number; faiss: number } | null>(null);

  /** 加载阶段追踪 — 记录 loading 开始时间，按耗时渐进展示阶段文案。
   *  所有 setState 均在 setTimeout/setInterval 回调中触发，满足 React setState-in-effect ESLint 规则。 */
  const loadingStartRef = useRef<number | null>(null);
  const [loadingStageIdx, setLoadingStageIdx] = useState(0);
  useEffect(() => {
    if (!isLoading) {
      loadingStartRef.current = null;
      // 不在此处 setState — 加载指示器已隐藏，残留值无害
      return;
    }
    loadingStartRef.current = Date.now();
    const tick = () => {
      if (loadingStartRef.current === null) return;
      const elapsed = Date.now() - loadingStartRef.current;
      const stage = LOADING_STAGES.findLastIndex((s) => elapsed >= s.thresholdMs);
      setLoadingStageIdx(stage >= 0 ? stage : 0);
    };
    // 初始 tick 通过 setTimeout(0) 推迟到下一个 microtask，避免 effect body 内 setState
    const initialTimer = setTimeout(tick, 0);
    const interval = setInterval(tick, 500);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isLoading]);

  /** 追踪消息数变化 → 更新会话统计 */
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const userCount = messages.filter((m) => m.role === "user").length;
    if (userCount > prevMsgCountRef.current) {
      incrementMessageCount();
    }
    prevMsgCountRef.current = userCount;
  }, [messages, incrementMessageCount]);

  /** 将用户消息与后续 assistant 响应的 intent + api_trace + routing 关联 */
  const userIntentMap = useMemo(() => {
    const intentMap = new Map<string, IntentResult | null>();
    const traceMap = new Map<string, ApiTrace | null>();
    const routingMap = new Map<string, RoutingInfo | null>();
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === "user" && messages[i + 1].role === "assistant") {
        const response = messages[i + 1].response;
        intentMap.set(messages[i].id, response?.intent ?? null);
        traceMap.set(messages[i].id, response?.api_trace ?? null);
        // Phase 66 B43 — per-message routing for IntentPill complexity display
        routingMap.set(messages[i].id, response?.routing ?? null);
      }
    }
    return { intentMap, traceMap, routingMap };
  }, [messages]);

  /** 追踪最新响应 → 更新记忆计数 */
  const latestResponse = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.response ?? null;
  }, [messages]);
  useEffect(() => {
    if (latestResponse) {
      setMemoryCount(latestResponse.recall_items.length);
      setLastRouting(latestResponse.routing ?? null);
    } else if (messages.length === 0) {
      // C6: messages 清空后显式重置统计，避免旧值残留
      setMemoryCount(0);
      setLastRouting(null);
    }
  }, [latestResponse, messages.length, setMemoryCount, setLastRouting]);

  /** 聚合各轮 assistant 的 token_breakdown → 推入会话统计（镜像 setMemoryCount 范式） */
  const sessionTokenAggregate = useMemo(() => {
    const breakdowns: TokenBreakdown[] = [];
    for (const m of messages) {
      if (m.role === "assistant" && m.response) {
        const extras = (m.response.api_trace as Record<string, unknown> | undefined) ?? {};
        const tb = extras["token_breakdown"];
        if (tb) breakdowns.push(tb as TokenBreakdown);
      }
    }
    return aggregateBreakdowns(breakdowns);
  }, [messages]);
  useEffect(() => {
    setSessionTokens({
      input: sessionTokenAggregate.totalInput,
      output: sessionTokenAggregate.totalOutput,
      turns: sessionTokenAggregate.turns,
      cost: sessionTokenAggregate.cost,
      hasPricing: sessionTokenAggregate.hasPricing,
    });
  }, [sessionTokenAggregate, setSessionTokens]);

  /** 自动滚动到底部 — 新消息到达或加载状态变化时触底 */
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex h-full flex-col">
      <ContentPreloader />
      {/* 清除对话按钮栏 — 左上角独立行，避免与 IntentPill 右列叠加 */}
      {!isEmpty && (
        <div className="flex justify-start px-gm-4 py-gm-2">
          <button
            onClick={() => {
              setForgetModalError(null);
              setShowClearConfirm(true);
            }}
            className="inline-flex items-center gap-gm-1_5
                       rounded-gm-md border border-border
                       bg-surface-elevated px-gm-2_5 py-gm-1
                       text-gm-xs text-text-muted
                       hover:text-error hover:border-error/30 hover:bg-error/5
                       focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                       active:scale-[0.97]
                       transition-all cursor-pointer"
            aria-label="清除对话"
          >
            <RiDeleteBinLine className="text-gm-icon" />
            <span>清除对话</span>
          </button>
        </div>
      )}
      {/* 消息区域 */}
      <div
        className="flex-1 overflow-y-auto p-gm-4"
        role="log"
        aria-live="polite"
        aria-label="聊天消息"
      >

        {/* Phase 66 B22 — 确认清除对话框 */}
        <ConfirmModal
          isOpen={showClearConfirm}
          onClose={() => {
            if (!forgetLoading) {
              setShowClearConfirm(false);
              setForgetModalError(null);
            }
          }}
          onConfirm={async () => {
            setForgetLoading(true);
            setForgetModalError(null);
            try {
              const result = await forgetSession();
              setShowClearConfirm(false);
              // C6: 重置 ChatParamsContext 所有统计数据到默认值
              resetToDefaults();
              // 展示遗忘摘要横幅（5 秒后自动消失）
              setForgetBanner({
                episodes: result.episodes_deleted,
                facts: result.facts_deleted,
                faiss: result.faiss_vectors_removed,
              });
              setTimeout(() => setForgetBanner(null), 5000);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "遗忘操作失败，请重试";
              setForgetModalError(msg);
            } finally {
              setForgetLoading(false);
            }
          }}
          title="清除对话记忆？"
          message="这将删除本轮对话产生的所有记忆和标签。后端存储的 episodes、facts 和 FAISS 向量索引将被级联清除，相关标签会自动回退。此操作不可撤销。"
          confirmLabel="确认清除"
          variant="danger"
          isLoading={forgetLoading}
          error={forgetModalError}
        />

        {/* Phase 66 B22 — 遗忘成功摘要横幅 */}
        {forgetBanner && (
          <div
            className="mb-gm-3 flex items-center gap-gm-2
                       rounded-gm-md border border-success/30
                       bg-success/5 px-gm-4 py-gm-2
                       text-gm-sm text-success
                       animate-gm-fade-in"
          >
            <RiCheckLine className="text-gm-base flex-shrink-0" />
            <span>
              已清除 {forgetBanner.episodes} 条对话记录、{forgetBanner.facts} 条事实、{forgetBanner.faiss} 个向量索引。相关标签已自动回退。
            </span>
            <button
              onClick={() => setForgetBanner(null)}
              className="ml-auto shrink-0 rounded-gm-sm p-gm-1 text-text-muted hover:text-text hover:bg-surface-alt transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
              aria-label="关闭横幅"
            >
              <RiCloseLine className="text-gm-icon" />
            </button>
          </div>
        )}
        {isEmpty && <WelcomeView onSend={sendMessage} />}

        {messages.map((msg) => (
          <ErrorBoundary key={msg.id} fallbackVariant="inline">
            <ChatMessage
              message={msg}
              userIntent={msg.role === "user" ? userIntentMap.intentMap.get(msg.id) ?? undefined : undefined}
              userTrace={msg.role === "user" ? userIntentMap.traceMap.get(msg.id) ?? undefined : undefined}
              userRouting={msg.role === "user" ? userIntentMap.routingMap.get(msg.id) ?? undefined : undefined}
            />
          </ErrorBoundary>
        ))}

        {isLoading && (
          <div className="mb-gm-4 flex justify-start">
            <div
              className="rounded-gm-lg border border-border bg-surface-elevated
                          px-gm-4 py-gm-3 shadow-gm-sm"
            >
              <div className="flex items-center gap-gm-2 text-text-muted">
                <RiLoader4Line className="animate-spin" />
                <span className="text-gm-sm">{LOADING_STAGES[loadingStageIdx].text}</span>
              </div>
            </div>
          </div>
        )}

        {error != null && (
          <div className="mx-auto max-w-md space-y-gm-3">
            <ErrorDisplay
              variant="card"
              error={error}
              onRetry={() => {
                const lastUserMsg = [...messages]
                  .reverse()
                  .find((m) => m.role === "user");
                if (lastUserMsg) {
                  // M9: 先移除旧失败消息，再发送，避免两条相同用户消息
                  removeLastUserMessage();
                  sendMessage(lastUserMsg.content);
                }
              }}
            />

            {/* ── 错误教学透镜 (q7.6) ── */}
            {q7_6chart && (
              <ContextualLens
                triggerLabel="🤔 为什么这样处理？"
                triggerIcon={<RiQuestionLine className="text-gm-icon" />}
                title="错误教学化 vs 错误隐藏"
              >
                <MermaidDiagram
                  chart={q7_6chart}
                  title="图：错误教学化决策树"
                  maxHeight={400}
                />
              </ContextualLens>
            )}
          </div>
        )}

        {/* 滚动锚点 — 自动滚底目标 */}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <ChatInput onSend={sendMessage} disabled={isLoading} onAbort={abort} />
    </div>
  );
}

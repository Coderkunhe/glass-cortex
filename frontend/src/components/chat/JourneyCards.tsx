"use client";

import { useState } from "react";
import { RiCloseLine, RiArrowDownSLine } from "@remixicon/react";
import type { ChatResponse, IntentCategory } from "@/lib/api/types";
import { INTENT_COLORS } from "@/lib/content/constants";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import {
  MemoryVisualDetail,
  ContextVisualDetail,
  TokenVisualDetail,
  PlanningVisualDetail,
} from "./FourPillar";

// ── Types ──────────────────────────────────────────────────────────

interface JourneyCardData {
  key: string;
  icon: string;
  title: string;
  metric: string;
  metricLabel: string;
  summary: string;
  color: string;
  error?: boolean;
}

// ── Helper: 意图类别色 fallback ──

function intentColor(category: IntentCategory | string | null | undefined): string {
  if (!category) return "var(--gm-info)";
  const c = (INTENT_COLORS as Record<string, unknown>)[category];
  if (!c) return "var(--gm-info)";
  const CATEGORY_TO_VAR: Record<string, string> = {
    "提问": "var(--gm-success)",
    "指令": "var(--gm-warning)",
    "闲聊": "var(--gm-info)",
    "探索": "var(--gm-accent)",
    "澄清": "var(--gm-info)",
  };
  return CATEGORY_TO_VAR[category] ?? "var(--gm-info)";
}

// ── Simple detail panels for Reply & Memory stages ──

function ReplyDetail({ response }: { response: ChatResponse }) {
  const t = response.api_trace;
  const total = t.prompt_tokens + t.completion_tokens;
  return (
    <div className="space-y-gm-2">
      <div className="flex flex-wrap gap-gm-2">
        <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
          <span className="text-text-muted">模型</span>
          <span className="font-medium text-text">{t.model}</span>
        </span>
        <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
          <span className="text-text-muted">耗时</span>
          <span className="font-medium text-text">{t.elapsed_ms}ms</span>
        </span>
        <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
          <span className="text-text-muted">输入</span>
          <span className="font-medium text-text">{t.prompt_tokens.toLocaleString()} token</span>
        </span>
        <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
          <span className="text-text-muted">输出</span>
          <span className="font-medium text-text">{t.completion_tokens.toLocaleString()} token</span>
        </span>
        <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
          <span className="text-text-muted">合计</span>
          <span className="font-medium text-text">{total.toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
}

// ── Understand detail: Planning + Classifier trace (R9) + Subtask status (R10) ──

function UnderstandDetail({ response }: { response: ChatResponse }) {
  const traceExtras = response.api_trace as Record<string, unknown>;

  // R9: classifier trace fields
  const plannerTokenUsage = traceExtras["planner_token_usage"] as
    | { prompt_tokens: number; completion_tokens: number }
    | undefined;
  const plannerSystemPrompt = String(traceExtras["planner_system_prompt"] ?? "");
  const plannerRawResponse = String(traceExtras["planner_raw_response"] ?? "");
  const plannerElapsed = typeof traceExtras["planner_elapsed_ms"] === "number"
    ? traceExtras["planner_elapsed_ms"]
    : null;

  // R10: subtask status
  const planSubtasks = traceExtras["plan_subtasks"] as Array<Record<string, unknown>> | undefined;
  const planRunId = typeof traceExtras["plan_run_id"] === "number" ? traceExtras["plan_run_id"] : null;
  const planConfidence = typeof traceExtras["plan_confidence"] === "number"
    ? traceExtras["plan_confidence"]
    : null;

  const classifierTokens = plannerTokenUsage
    ? plannerTokenUsage.prompt_tokens + plannerTokenUsage.completion_tokens
    : null;

  const hasClassifierTrace = plannerSystemPrompt.length > 0 || plannerRawResponse.length > 0 || classifierTokens != null;

  // Truncate for preview — show first 200 chars of system prompt / raw
  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max) + "…" : s;

  return (
    <div className="space-y-gm-3">
      <PlanningVisualDetail response={response} />

      {/* R9: Classifier trace — classifier call chain metadata */}
      {hasClassifierTrace && (
        <div className="pt-gm-2 border-t border-border/50">
          <p className="text-gm-2xs font-semibold text-text-muted mb-gm-1_5">
            🔍 分类器调用链
          </p>
          <div className="space-y-gm-2">
            {/* Classifier token + elapsed */}
            <div className="flex flex-wrap gap-gm-1_5">
              {classifierTokens != null && (
                <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
                  <span className="text-text-muted">分类 Token</span>
                  <span className="font-medium text-text font-mono">
                    {classifierTokens.toLocaleString()}
                  </span>
                </span>
              )}
              {plannerElapsed != null && plannerElapsed > 0 && (
                <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
                  <span className="text-text-muted">分类耗时</span>
                  <span className="font-medium text-text">{plannerElapsed}ms</span>
                </span>
              )}
            </div>
            {/* Classifier system prompt preview */}
            {plannerSystemPrompt && (
              <div className="rounded-gm-sm border border-border/40 bg-surface p-gm-2_5">
                <p className="text-gm-2xs text-text-muted mb-gm-1">System Prompt</p>
                <pre className="text-gm-xs text-text-secondary font-mono whitespace-pre-wrap break-all leading-relaxed max-h-24 overflow-y-auto">
                  {truncate(plannerSystemPrompt, 300)}
                </pre>
              </div>
            )}
            {/* Classifier raw response preview */}
            {plannerRawResponse && (
              <div className="rounded-gm-sm border border-border/40 bg-surface p-gm-2_5">
                <p className="text-gm-2xs text-text-muted mb-gm-1">Raw Response</p>
                <pre className="text-gm-xs text-text-secondary font-mono whitespace-pre-wrap break-all leading-relaxed max-h-20 overflow-y-auto">
                  {truncate(plannerRawResponse, 200)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* R10: Subtask status — plan subtasks from api_trace */}
      {planSubtasks && planSubtasks.length > 0 && (
        <div className="pt-gm-2 border-t border-border/50">
          <div className="flex items-center gap-gm-2 mb-gm-1_5">
            <p className="text-gm-2xs font-semibold text-text-muted">
              📋 任务规划
            </p>
            {planRunId != null && (
              <span className="text-gm-2xs text-text-muted/60">
                Plan #{planRunId}
              </span>
            )}
            {planConfidence != null && (
              <span className="text-gm-2xs font-mono text-text-muted/60">
                {(planConfidence * 100).toFixed(0)}% 置信
              </span>
            )}
          </div>
          <div className="space-y-gm-1">
            {planSubtasks.map((st, i) => {
              const desc = String(st.description ?? st.id ?? `步骤 ${i + 1}`);
              const status = String(st.status ?? "pending");
              const statusStyle: Record<string, string> = {
                pending: "text-text-muted/60",
                in_progress: "text-warning",
                completed: "text-success",
                failed: "text-danger",
              };
              return (
                <div
                  key={i}
                  className="flex items-start gap-gm-2 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5"
                >
                  {/* Status dot */}
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${
                      status === "completed"
                        ? "bg-success"
                        : status === "in_progress"
                          ? "bg-warning"
                          : status === "failed"
                            ? "bg-danger"
                            : "bg-border"
                    }`}
                  />
                  <span className={`text-gm-xs leading-relaxed min-w-0 ${statusStyle[status] ?? "text-text-secondary"}`}>
                    {desc}
                  </span>
                  <span className={`shrink-0 text-gm-2xs ml-auto ${statusStyle[status] ?? "text-text-muted/60"}`}>
                    {status === "completed" ? "✓" : status === "in_progress" ? "↻" : "○"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MemoryStorageDetail({ response }: { response: ChatResponse }) {
  const fet = response.context_meta.fact_extraction_trace as Record<string, unknown> | undefined;
  const factsStored = Array.isArray(fet?.stored_fact_ids) ? (fet.stored_fact_ids as unknown[]).length : 0;
  const factsParsed = Array.isArray(fet?.parsed_triples) ? (fet.parsed_triples as unknown[]).length : 0;
  const triples = Array.isArray(fet?.parsed_triples)
    ? (fet.parsed_triples as Array<Record<string, unknown>>)
    : [];
  const isCached = Boolean(fet?.cache_hit);
  const totalStored = 1 + factsStored;

  // R6: memories_before→after 增量
  const m = response.context_meta;
  const memBefore = m.memories_before;
  const memAfter = m.memories_after;
  const memDelta = memAfter - memBefore;

  // R7: dedup results — per-triple action (stored / merged / skipped)
  const dedupResults = Array.isArray(fet?.dedup_results)
    ? (fet.dedup_results as Array<Record<string, unknown>>)
    : [];

  // R8: fact extraction metadata — elapsed + token cost
  const extractElapsed = typeof fet?.elapsed_ms === "number" ? fet.elapsed_ms : null;
  const extractTokens = fet?.token_usage as
    | { prompt_tokens: number; completion_tokens: number }
    | undefined;

  // Action badge color mapping
  const actionBadge = (action: string) => {
    const map: Record<string, string> = {
      stored: "border-success/40 bg-success/5 text-success",
      merged: "border-warning/40 bg-warning/5 text-warning",
      skipped: "border-border/40 bg-surface text-text-muted",
    };
    return map[action] ?? "border-border/40 bg-surface text-text-muted";
  };
  const actionLabel = (action: string) => {
    const map: Record<string, string> = { stored: "新增", merged: "合并", skipped: "跳过" };
    return map[action] ?? action;
  };

  // B70: 本次记忆内容 — user_msg/assistant_msg 从 trace 中提取
  const userMsg = typeof fet?.user_msg === "string" ? (fet.user_msg as string) : "";
  const assistantMsg = typeof fet?.assistant_msg === "string" ? (fet.assistant_msg as string) : "";
  const hasContent = userMsg.length > 0 || assistantMsg.length > 0;

  // Merge triples with dedup results for per-item rendering
  const mergedItems: Array<{ triple: Record<string, unknown>; action?: string; detail?: string }> = [];
  for (let i = 0; i < Math.max(triples.length, dedupResults.length); i++) {
    const triple = triples[i] ?? null;
    const dedup = dedupResults[i];
    mergedItems.push({
      triple: triple ?? {},
      action: dedup ? String(dedup.action ?? "") : undefined,
      detail: dedup ? String(dedup.detail ?? "") : undefined,
    });
  }

  return (
    <div className="space-y-gm-2">
      {/* B70: 本次记忆内容 — 展示实际存储的对话原文 */}
      {hasContent && (
        <div className="rounded-gm-sm border border-border/50 bg-surface-alt/50 p-gm-3 space-y-gm-2">
          <p className="text-gm-2xs font-semibold text-text-muted">📝 本次记忆内容</p>
          {userMsg && (
            <div>
              <span className="text-gm-2xs text-text-muted/70">用户</span>
              <p className="text-gm-xs text-text-secondary leading-relaxed mt-gm-0_5">{userMsg}</p>
            </div>
          )}
          {assistantMsg && (
            <div>
              <span className="text-gm-2xs text-text-muted/70">AI 回复</span>
              <p className="text-gm-xs text-text-secondary leading-relaxed mt-gm-0_5">{assistantMsg}</p>
            </div>
          )}
        </div>
      )}
      {/* Stat pills row 1: counts + delta */}
      <div className="flex flex-wrap gap-gm-2">
        <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
          <span className="text-text-muted">新增记忆</span>
          <span className="font-medium text-text">{totalStored} 条</span>
        </span>
        {factsStored > 0 && (
          <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
            <span className="text-text-muted">事实</span>
            <span className="font-medium text-text">{factsStored} 条</span>
          </span>
        )}
        {factsParsed > 0 && (
          <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
            <span className="text-text-muted">抽取三元组</span>
            <span className="font-medium text-text">{factsParsed}</span>
          </span>
        )}
        {/* R6: memories_before→after delta */}
        <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
          <span className="text-text-muted">记忆增量</span>
          <span className="font-medium text-text font-mono">
            {memBefore} → {memAfter}{" "}
            <span className={memDelta >= 0 ? "text-success" : "text-danger"}>
              ({memDelta >= 0 ? "+" : ""}{memDelta})
            </span>
          </span>
        </span>
        {isCached && (
          <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-success/30 bg-success/5 px-gm-2_5 py-gm-1_5 text-gm-xs text-success font-medium">
            事实缓存命中
          </span>
        )}
      </div>
      {/* R8: episode storage metadata — extraction cost */}
      {(extractElapsed != null || extractTokens) && (
        <div className="flex flex-wrap gap-gm-2">
          {extractElapsed != null && extractElapsed > 0 && (
            <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
              <span className="text-text-muted">抽取耗时</span>
              <span className="font-medium text-text">{extractElapsed}ms</span>
            </span>
          )}
          {extractTokens && (
            <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2_5 py-gm-1_5 text-gm-xs">
              <span className="text-text-muted">抽取 Token</span>
              <span className="font-medium text-text font-mono">
                {extractTokens.prompt_tokens + extractTokens.completion_tokens}
              </span>
            </span>
          )}
        </div>
      )}
      {/* R7: 三元组列表 — 含 per-triple 去重动作（stored / merged / skipped） */}
      {mergedItems.length > 0 && (
        <div className="space-y-gm-1_5">
          {mergedItems.map((item, i) => {
            const t = item.triple;
            const s = String(t.subject ?? "?");
            const r = String(t.relation ?? "?");
            const o = String(t.object ?? "?");
            return (
              <div
                key={i}
                className="rounded-gm-sm border border-border/40 bg-surface p-gm-2_5"
              >
                <div className="flex items-start justify-between gap-gm-2">
                  <p className="text-gm-xs text-text font-mono break-all min-w-0">
                    {s} → {r} → {o}
                  </p>
                  {item.action && (
                    <span
                      className={`shrink-0 inline-flex items-center rounded-gm-sm border px-gm-1_5 py-gm-0_5 text-gm-2xs font-medium ${actionBadge(item.action)}`}
                    >
                      {actionLabel(item.action)}
                    </span>
                  )}
                </div>
                {item.detail && (
                  <p className="text-gm-2xs text-text-muted mt-gm-1">{item.detail}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-component: single journey card ──

function JourneyCard({
  data,
  delay,
  isExpanded,
  onClick,
}: {
  data: JourneyCardData;
  delay: number;
  isExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={
        "animate-gm-slide-in rounded-gm-md border bg-surface-elevated " +
        "cursor-pointer transition-[border-color,box-shadow] duration-gm-base " +
        (isExpanded
          ? "border-border-strong shadow-gm-sm"
          : "border-border/30 hover:border-border hover:shadow-gm-xs")
      }
      style={{ animationDelay: `${delay}ms`, borderLeft: `2px solid ${data.color}` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="p-gm-4">
        {/* Icon + title + chevron */}
        <div className="flex items-center gap-gm-2 mb-gm-2">
          <span className="text-gm-base">{data.icon}</span>
          <span className="text-gm-xs font-medium text-text-muted">
            {data.title}
          </span>
          <RiArrowDownSLine
            className={`ml-auto w-3.5 h-3.5 text-text-muted/25 transition-transform duration-gm-base ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>

        {/* Large metric */}
        <div
          className="text-gm-xl font-bold tracking-tight"
          style={{ color: data.color }}
        >
          {data.metric}
        </div>

        {/* Metric label */}
        <div className="text-gm-xs text-text-muted mt-gm-0_5">
          {data.metricLabel}
        </div>

        {/* Summary */}
        <div
          className={`mt-gm-2 text-gm-sm leading-relaxed line-clamp-2 ${
            data.error ? "text-danger" : ""
          }`}
          style={data.error ? undefined : { color: "var(--gm-text-secondary)" }}
        >
          {data.summary}
        </div>
      </div>
    </div>
  );
}

// ── Expanded detail wrapper ──

function ExpandedDetailPanel({
  title,
  color,
  onClose,
  children,
}: {
  title: string;
  color: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="animate-gm-onion-in rounded-gm-md border border-border/50 bg-surface-elevated shadow-gm-sm overflow-hidden"
      style={{ borderLeft: `2px solid ${color}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-gm-4 py-gm-3">
        <span className="text-gm-sm font-semibold text-text">
          {title} 详情
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-gm-1 text-text-muted hover:text-text hover:bg-surface-alt transition-colors cursor-pointer active:scale-90 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
          aria-label="关闭详情"
        >
          <RiCloseLine className="w-4 h-4" />
        </button>
      </div>
      {/* Body */}
      <div className="px-gm-4 pb-gm-4">
        {children}
      </div>
    </div>
  );
}

// ── Main component ──

interface JourneyCardsProps {
  response: ChatResponse;
  /** 收起消息旅程的回调（点击头部触发） */
  onCollapse?: () => void;
}

export default function JourneyCards({ response, onCollapse }: JourneyCardsProps) {
  const { intent, recall_items, context_meta, api_trace } = response;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const toggleExpand = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  // ── Card 1: 理解 ──
  const c1: JourneyCardData = {
    key: "understand",
    icon: "🎯",
    title: "理解",
    metric: intent?.category ?? "—",
    metricLabel: intent
      ? `置信度 ${(intent.confidence * 100).toFixed(0)}%`
      : "等待分类",
    summary:
      intent?.rationale
        ? intent.rationale
        : "意图分类器分析用户输入",
    color: intentColor(intent?.category ?? null),
  };

  // ── Card 2: 召回 ──
  const epCount = recall_items.filter(
    (r) => !r.subject && !r.relation && !r.object,
  ).length;
  const factCount = recall_items.filter(
    (r) => r.subject || r.relation || r.object,
  ).length;
  const scores = recall_items
    .map((r) => r.similarity ?? r.composite_score)
    .filter((s): s is number => s != null);
  const scoreRange =
    scores.length >= 2
      ? `${(Math.min(...scores) * 100).toFixed(0)}% ~ ${(Math.max(...scores) * 100).toFixed(0)}%`
      : scores.length === 1
        ? `${(scores[0] * 100).toFixed(0)}%`
        : null;

  const c2: JourneyCardData = {
    key: "recall",
    icon: "🧠",
    title: "召回",
    metric: String(recall_items.length),
    metricLabel: `对话 ${epCount} · 事实 ${factCount}`,
    summary:
      recall_items.length > 0
        ? `从长期记忆找回 ${recall_items.length} 条相关记忆${scoreRange ? `（评分 ${scoreRange}）` : ""}`
        : "无相关记忆（可能是首次对话）",
    color: "var(--gm-success)",
  };

  // ── Card 3: 组装 ──
  const ow = context_meta.overflow_applied;
  const c3: JourneyCardData = {
    key: "assemble",
    icon: "⚙️",
    title: "组装",
    metric: context_meta.total_estimated_tokens.toLocaleString(),
    metricLabel: `tokens / ${context_meta.window_size.toLocaleString()} 窗口`,
    summary:
      `上下文使用率 ${(context_meta.usage_pct ?? 0).toFixed(0)}%${ow ? " · 溢出触发" : " · 无溢出"}`,
    color: "var(--gm-brand)",
  };

  // ── Card 4: 花费 ──
  const totalTokens = api_trace.prompt_tokens + api_trace.completion_tokens;
  const estCost = totalTokens * 2.0 / 1_000_000;
  const c4: JourneyCardData = {
    key: "cost",
    icon: "💰",
    title: "花费",
    metric: totalTokens.toLocaleString(),
    metricLabel: "单次调用 token",
    summary: `估算成本 ≈ ¥${estCost.toFixed(4)} (DeepSeek 定价)`,
    color: "var(--gm-warning)",
  };

  // ── Card 5: 回复 ──
  const isError = context_meta.fact_extraction_trace != null &&
    typeof context_meta.fact_extraction_trace === "object" &&
    "status" in (context_meta.fact_extraction_trace as Record<string, unknown>) &&
    (context_meta.fact_extraction_trace as Record<string, unknown>).status === "error";
  const responseError = isError || api_trace.prompt_tokens === 0;
  const c5: JourneyCardData = {
    key: "reply",
    icon: "🤖",
    title: "回复",
    metric: responseError ? "—" : (api_trace.prompt_tokens + api_trace.completion_tokens).toLocaleString(),
    metricLabel: "token",
    summary: responseError
      ? "回复生成失败 · 请检查 API Key"
      : `${api_trace.model} · ${api_trace.elapsed_ms}ms · ${api_trace.completion_tokens} 输出 token`,
    color: responseError ? "var(--gm-danger)" : "var(--gm-info)",
    error: responseError,
  };

  // ── Card 6: 记忆 ──
  const fet = context_meta.fact_extraction_trace as Record<string, unknown> | undefined;
  const factsStored = Array.isArray(fet?.stored_fact_ids) ? (fet.stored_fact_ids as unknown[]).length : 0;
  const factsParsed = Array.isArray(fet?.parsed_triples) ? (fet.parsed_triples as unknown[]).length : 0;
  const isCached = Boolean(fet?.cache_hit);
  const totalStored = 1 + factsStored;

  const c6: JourneyCardData = {
    key: "memory",
    icon: "💾",
    title: "记忆",
    metric: String(totalStored),
    metricLabel: "条新记忆",
    summary:
      `存储了 1 条消息${factsStored > 0 ? ` + ${factsStored} 个事实` : ""}${isCached ? "（事实缓存命中）" : factsParsed > 0 ? ` · 抽取 ${factsParsed} 个三元组` : ""}`,
    color: "var(--gm-accent)",
  };

  const cards = [c1, c2, c3, c4, c5, c6];

  // ── Render expanded detail for the active card ──
  const renderExpandedDetail = () => {
    if (!expandedKey) return null;
    const card = cards.find((c) => c.key === expandedKey);
    if (!card) return null;

    let detailContent: React.ReactNode;
    switch (expandedKey) {
      case "understand":
        detailContent = (
          <UnderstandDetail response={response} />
        );
        break;
      case "recall":
        detailContent = <MemoryVisualDetail response={response} />;
        break;
      case "assemble":
        detailContent = <ContextVisualDetail response={response} />;
        break;
      case "cost":
        detailContent = <TokenVisualDetail response={response} />;
        break;
      case "reply":
        detailContent = <ReplyDetail response={response} />;
        break;
      case "memory":
        detailContent = <MemoryStorageDetail response={response} />;
        break;
      default:
        return null;
    }

    return (
      <ExpandedDetailPanel
        title={card.title}
        color={card.color}
        onClose={() => setExpandedKey(null)}
      >
        {detailContent}
      </ExpandedDetailPanel>
    );
  };

  return (
    <div className="space-y-gm-3">
      {/* Header — clickable to collapse */}
      <div>
        <div
          className={`flex items-center gap-gm-2 ${onCollapse ? "cursor-pointer select-none" : ""}`}
          onClick={onCollapse}
        >
          <span className="text-gm-base">📊</span>
          <span className="text-gm-sm font-semibold text-text-muted">
            消息旅程
          </span>
          <span className="inline-flex items-center gap-gm-1_5 rounded-gm-sm border border-border/40 bg-surface px-gm-2 py-gm-1 text-gm-2xs text-text-muted">
            <span>⏱</span>
            <span className="font-medium text-text">{api_trace.elapsed_ms}ms</span>
          </span>
        </div>
        <p className="text-gm-xs text-text-muted/60 mt-gm-0_5">
          六个镜头，一条消息的完整生命周期 — 点击卡片查看详情
        </p>
      </div>

      {/* Row 1: 理解 · 召回 · 组装 */}
      <div className="grid grid-cols-1 gap-gm-3 md:grid-cols-3">
        {cards.slice(0, 3).map((card, i) => (
          <ErrorBoundary key={card.key} fallbackVariant="inline">
            <JourneyCard
              data={card}
              delay={i * 80}
              isExpanded={expandedKey === card.key}
              onClick={() => toggleExpand(card.key)}
            />
          </ErrorBoundary>
        ))}
      </div>

      {/* Row 2: 花费 · 回复 · 记忆 */}
      <div className="grid grid-cols-1 gap-gm-3 md:grid-cols-3">
        {cards.slice(3).map((card, i) => (
          <ErrorBoundary key={card.key} fallbackVariant="inline">
            <JourneyCard
              data={card}
              delay={(i + 3) * 80}
              isExpanded={expandedKey === card.key}
              onClick={() => toggleExpand(card.key)}
            />
          </ErrorBoundary>
        ))}
      </div>

      {/* Expanded detail panel */}
      {renderExpandedDetail()}
    </div>
  );
}

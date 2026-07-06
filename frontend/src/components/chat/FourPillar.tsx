"use client";

import { useState } from "react";
import type { ChatResponse } from "@/lib/api/types";
import {
  RiBrainLine,
  RiLayoutMasonryLine,
  RiMoneyDollarCircleLine,
  RiCrosshair2Line,
  RiCloseLine,
} from "@remixicon/react";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import { extractMermaidFromAnswer } from "@/lib/content/extractMermaid";
import { buildPartitionChart } from "@/lib/partition-chart";
import { CH2_ANSWERS } from "@/lib/content/answers/ch2";
import { CH4_ANSWERS } from "@/lib/content/answers/ch4";
import TokenCostBadge, { type TokenBreakdown } from "./TokenCostBadge";
import CacheHitIndicator from "./CacheHitIndicator";

// ── Types ────────────────────────────────────────────────────────────────

export interface FourPillarProps {
  /** Latest assistant ChatResponse, or null when no data available */
  response: ChatResponse | null;
}

interface PillarData {
  key: string;
  icon: React.ReactNode;
  title: string;
  /** One-line description shown as browser tooltip on hover */
  description: string;
  color: string;
  metric: string;
  subtitle: string;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Pillar descriptions keyed by card key — displayed as native title tooltips. */
const PILLAR_DESCRIPTIONS: Record<string, string> = {
  memory: "召回相关记忆，区分对话片段与结构化事实",
  context: "管理上下文窗口容量，溢出时触发降级策略",
  token: "追踪每次请求的 Token 消耗与成本",
  planning: "识别用户意图并分配执行策略",
};

const FLOW_STEPS = [
  { key: "memory", label: "记忆设计", color: "var(--gm-success)" },
  { key: "context", label: "上下文工程", color: "var(--gm-info)" },
  { key: "token", label: "Token 效率", color: "var(--gm-warning)" },
  { key: "planning", label: "任务规划", color: "var(--gm-accent)" },
] as const;

/** Mermaid 详情图统一最大高度（px）— 保持紧凑避免面板过高 */
const MERMAID_DETAIL_MAX_HEIGHT = 280;

/** q2.1 事实抽取三条路线 — 从答案内容提取 mermaid 图 */
const _q2_1answer = CH2_ANSWERS.length > 0 ? CH2_ANSWERS[0] : undefined;
const q2_1chart = _q2_1answer ? extractMermaidFromAnswer(_q2_1answer) : null;
/** q4.1 Token 三层精度模型 — 从答案内容提取 mermaid 图 */
const _q4_1answer = CH4_ANSWERS.length > 0 ? CH4_ANSWERS[0] : undefined;
const q4_1chart = _q4_1answer ? extractMermaidFromAnswer(_q4_1answer) : null;

// ── Helpers ──────────────────────────────────────────────────────────────

function countEpisodesAndFacts(items: ChatResponse["recall_items"]) {
  let epCount = 0;
  let factCount = 0;
  for (const item of items) {
    if (item.subject || item.relation || item.object) {
      factCount++;
    } else {
      epCount++;
    }
  }
  return { epCount, factCount };
}

function derivePillars(response: ChatResponse | null): PillarData[] {
  // ── Memory ──
  let memoryMetric = "—";
  let memorySub = "等待召回";
  if (response) {
    const items = response.recall_items;
    if (items.length > 0) {
      const { epCount, factCount } = countEpisodesAndFacts(items);
      memoryMetric = String(items.length);
      memorySub = `对话 ${epCount} · 事实 ${factCount}`;
    } else {
      memoryMetric = "0";
    }
  }

  // ── Context ──
  let contextMetric = "—";
  let contextSub = "等待管线";
  if (response) {
    const { usage_pct, total_estimated_tokens, window_size, overflow_applied } =
      response.context_meta;
    contextMetric = `${Math.round(usage_pct)}%`;
    const tokenPart = `${total_estimated_tokens.toLocaleString()}/${window_size.toLocaleString()} tokens`;
    contextSub = overflow_applied ? `${tokenPart} · 溢出` : tokenPart;
  }

  // ── Token ──
  let tokenMetric = "—";
  let tokenSub = "等待调用";
  if (response) {
    const total = response.api_trace.prompt_tokens + response.api_trace.completion_tokens;
    tokenMetric = total.toLocaleString();
    tokenSub = "本消息 token";
  }

  // ── Planning ──
  let planMetric = "—";
  let planSub = "等待分类";
  if (response) {
    const { intent } = response;
    if (intent) {
      planMetric = intent.category || "未知";
      planSub = `置信度 ${Math.round(intent.confidence * 100)}%`;
    }
  }

  return [
    {
      key: "memory",
      icon: <RiBrainLine />,
      title: "记忆设计",
      description: PILLAR_DESCRIPTIONS.memory,
      color: "var(--gm-success)",
      metric: memoryMetric,
      subtitle: memorySub,
    },
    {
      key: "context",
      icon: <RiLayoutMasonryLine />,
      title: "上下文工程",
      description: PILLAR_DESCRIPTIONS.context,
      color: "var(--gm-info)",
      metric: contextMetric,
      subtitle: contextSub,
    },
    {
      key: "token",
      icon: <RiMoneyDollarCircleLine />,
      title: "Token 效率",
      description: PILLAR_DESCRIPTIONS.token,
      color: "var(--gm-warning)",
      metric: tokenMetric,
      subtitle: tokenSub,
    },
    {
      key: "planning",
      icon: <RiCrosshair2Line />,
      title: "任务规划",
      description: PILLAR_DESCRIPTIONS.planning,
      color: "var(--gm-accent)",
      metric: planMetric,
      subtitle: planSub,
    },
  ];
}

// ── PillarCard (collapsed state) ────────────────────────────────────────

function PillarCard({
  data,
  delay,
  isExpanded,
  onClick,
}: {
  data: PillarData;
  delay: number;
  isExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={
        "gm-card-lift animate-gm-slide-in rounded-gm-md border bg-surface-elevated " +
        "shadow-gm-xs cursor-pointer transition-all p-gm-3 flex flex-col items-center " +
        "gap-gm-1 hover:border-border-strong " +
        (isExpanded ? "border-border-strong shadow-gm-sm" : "border-border")
      }
      style={{ animationDelay: `${delay}ms` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={`${data.title} — ${data.description}`}
      title={data.description}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Icon */}
      <span className="text-gm-lg" style={{ color: data.color }}>
        {data.icon}
      </span>
      {/* Metric */}
      <span
        className="text-gm-xl font-bold leading-none"
        style={{ color: data.color }}
      >
        {data.metric}
      </span>
      {/* Label + subtitle row */}
      <div className="text-center">
        <span className="text-gm-2xs text-text-muted font-medium">
          {data.title}
        </span>
        <span className="text-gm-2xs text-text-muted block">
          {data.subtitle}
        </span>
      </div>
    </div>
  );
}

// ── Visual detail components (expanded state) ──────────────────────────

/** Compact stat pill used in Context/Token detail panels. */
function StatPill({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-gm-1_5 rounded-gm-sm border px-gm-2_5 py-gm-1_5 text-gm-xs " +
        (warn
          ? "border-warning/30 bg-warning/5 text-warning"
          : "border-border/40 bg-surface text-text-secondary")
      }
    >
      <span className="text-text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

export function MemoryVisualDetail({ response }: { response: ChatResponse }) {
  const items = response.recall_items;
  if (items.length === 0) {
    return (
      <p className="text-gm-xs text-text-muted py-gm-2 text-center">
        本次无召回记忆
      </p>
    );
  }
  return (
    <div className="space-y-gm-2">
      {items.map((item) => {
        const isFact = !!(item.subject || item.relation || item.object);
        const score = item.similarity ?? item.composite_score;
        return (
          <div
            key={item.id}
            className="rounded-gm-sm border border-border/40 bg-surface p-gm-3"
          >
            {/* Type badge + score */}
            <div className="flex items-center justify-between">
              <span
                className={
                  "inline-flex items-center gap-gm-1 text-gm-2xs font-medium " +
                  (isFact ? "text-info" : "text-success")
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background: isFact
                      ? "var(--gm-info)"
                      : "var(--gm-success)",
                  }}
                />
                {isFact ? "事实" : "对话片段"}
              </span>
              {/* R1: per-item similarity / composite score */}
              {score != null && (
                <span className="text-gm-2xs text-text-muted font-mono">
                  {(score * 100).toFixed(1)}%
                </span>
              )}
            </div>
            {/* Content */}
            {isFact ? (
              <p className="text-gm-xs text-text font-mono mt-gm-1_5 break-all">
                {item.subject ?? "?"} → {item.relation ?? "?"} →{" "}
                {item.object ?? "?"}
              </p>
            ) : (
              <p className="text-gm-xs text-text mt-gm-1_5">{item.content}</p>
            )}
            {/* R2+R4+R5: Episode stats — strength bar + access_count + lambda */}
            {!isFact && (
              <div className="mt-gm-2 space-y-gm-1">
                {/* R2: importance / initial_strength 强度条 */}
                {item.initial_strength != null && item.initial_strength > 0 && (
                  <div className="flex items-center gap-gm-2">
                    <span className="text-gm-2xs text-text-muted shrink-0 w-10">
                      当前强度
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-surface-alt overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            ((item.composite_score ?? 0) / item.initial_strength) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-gm-2xs text-text-muted font-mono shrink-0">
                      {(
                        ((item.composite_score ?? 0) / item.initial_strength) *
                        100
                      ).toFixed(0)}
                      %
                    </span>
                  </div>
                )}
                {/* R2b: importance 原始值 */}
                {item.importance != null && (
                  <div className="text-gm-2xs text-text-muted">
                    重要度{" "}
                    <span className="text-text font-medium">
                      {item.importance.toFixed(2)}
                    </span>
                  </div>
                )}
                {/* R4: access_count */}
                {item.access_count != null && (
                  <div className="text-gm-2xs text-text-muted">
                    已访问{" "}
                    <span className="text-text font-medium">
                      {item.access_count}
                    </span>{" "}
                    次
                  </div>
                )}
                {/* R5: lambda 衰减速率 */}
                {item.lambda != null && (
                  <div className="text-gm-2xs text-text-muted">
                    衰减速率 λ ={" "}
                    <span className="text-text font-mono">
                      {item.lambda.toFixed(4)}
                    </span>
                  </div>
                )}
              </div>
            )}
            {/* R3: Fact confidence bar */}
            {isFact && item.confidence != null && (
              <div className="mt-gm-2 flex items-center gap-gm-2">
                <span className="text-gm-2xs text-text-muted shrink-0 w-10">
                  置信度
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-surface-alt overflow-hidden">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{
                      width: `${(item.confidence * 100).toFixed(0)}%`,
                    }}
                  />
                </div>
                <span className="text-gm-2xs text-text-muted font-mono shrink-0">
                  {(item.confidence * 100).toFixed(0)}%
                </span>
              </div>
            )}
            {item.recall_reason && (
              <p className="text-gm-xs text-text-muted mt-gm-1 leading-relaxed">
                {item.recall_reason}
              </p>
            )}
          </div>
        );
      })}
      {/* Fact extraction explanatory mermaid */}
      {q2_1chart && (
        <div className="mt-gm-2 pt-gm-2 border-t border-border/50">
          <MermaidDiagram
            chart={q2_1chart}
            title="图：事实抽取三条路线"
            maxHeight={MERMAID_DETAIL_MAX_HEIGHT}
          />
        </div>
      )}
    </div>
  );
}

export function ContextVisualDetail({ response }: { response: ChatResponse }) {
  const m = response.context_meta;
  const pct = Math.round(m.usage_pct);
  return (
    <div className="space-y-gm-2">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between items-baseline text-gm-2xs mb-gm-0_5">
          <span className="text-text-muted">容量使用</span>
          <span className="text-text-secondary font-mono">
            {pct}% · {m.total_estimated_tokens.toLocaleString()} /{" "}
            {m.window_size.toLocaleString()} tokens
          </span>
        </div>
        <div className="h-2 rounded-full bg-surface-alt overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-gm-slow"
            style={{
              width: `${Math.min(pct, 100)}%`,
              background: "linear-gradient(90deg, var(--gm-info), var(--gm-info-light))",
            }}
          />
        </div>
      </div>
      {/* Stat pills */}
      <div className="flex flex-wrap gap-gm-1_5">
        <StatPill label="策略" value={m.strategy} />
        <StatPill
          label="记忆"
          value={`${m.memories_before} → ${m.memories_after}`}
        />
        <StatPill
          label="溢出"
          value={
            m.overflow_applied ? `丢弃 ${m.dropped_count} 条` : "未触发"
          }
          warn={m.overflow_applied}
        />
        <StatPill
          label="基础 Token"
          value={m.base_tokens.toLocaleString()}
        />
        <StatPill
          label="用户消息"
          value={m.user_message_tokens.toLocaleString()}
        />
      </div>
      {/* Context partition explanatory mermaid */}
      <div className="mt-gm-2 pt-gm-2 border-t border-border/50">
        <MermaidDiagram
          chart={buildPartitionChart(m)}
          title="图：上下文窗口四区划分"
          maxHeight={MERMAID_DETAIL_MAX_HEIGHT}
        />
      </div>
    </div>
  );
}

export function TokenVisualDetail({ response }: { response: ChatResponse }) {
  const t = response.api_trace;
  const total = t.prompt_tokens + t.completion_tokens;
  const promptPct = Math.round((t.prompt_tokens / total) * 100);
  // Extract extras from api_trace
  const traceExtras = t as Record<string, unknown>;
  const tokenBreakdown = traceExtras["token_breakdown"] as TokenBreakdown | undefined;
  return (
    <div className="space-y-gm-2">
      {/* Stacked bar */}
      <div>
        <div className="flex justify-between text-gm-2xs mb-gm-0_5">
          <span className="text-text-muted">Prompt</span>
          <span className="text-text-muted">Completion</span>
        </div>
        <div className="h-2 rounded-full bg-surface-alt overflow-hidden flex">
          <div
            className="h-full transition-all duration-gm-slow"
            style={{
              width: `${promptPct}%`,
              background: "linear-gradient(90deg, var(--gm-warning), var(--gm-warning-light))",
            }}
          />
          <div
            className="h-full transition-all duration-gm-slow"
            style={{
              width: `${100 - promptPct}%`,
              background: "linear-gradient(90deg, var(--gm-accent), var(--gm-accent-light))",
            }}
          />
        </div>
        <div className="flex justify-between text-gm-2xs mt-gm-0_5">
          <span className="text-text-secondary font-mono">
            {t.prompt_tokens.toLocaleString()}
          </span>
          <span className="text-text-secondary font-mono">
            {t.completion_tokens.toLocaleString()}
          </span>
        </div>
      </div>
      {/* Stat pills */}
      <div className="flex flex-wrap gap-gm-1_5">
        <StatPill label="模型" value={t.model} />
        <StatPill label="耗时" value={`${t.elapsed_ms}ms`} />
        <StatPill label="合计" value={total.toLocaleString()} />
        {tokenBreakdown?.chat && (
          <StatPill
            label="Chat"
            value={(tokenBreakdown.chat.prompt_tokens + tokenBreakdown.chat.completion_tokens).toLocaleString()}
          />
        )}
        {tokenBreakdown?.intent && (
          <StatPill
            label="Intent"
            value={(tokenBreakdown.intent.prompt_tokens + tokenBreakdown.intent.completion_tokens).toLocaleString()}
          />
        )}
        {tokenBreakdown?.fact_extraction && (
          <StatPill
            label="FactExtract"
            value={(tokenBreakdown.fact_extraction.prompt_tokens + tokenBreakdown.fact_extraction.completion_tokens).toLocaleString()}
          />
        )}
      </div>
      {/* Inline badges + explanatory mermaid */}
      <div className="flex flex-wrap items-center gap-gm-2">
        {tokenBreakdown && (
          <TokenCostBadge tokenBreakdown={tokenBreakdown} />
        )}
        {response.from_cache && response.cache_hit_score != null && (
          <CacheHitIndicator similarity={response.cache_hit_score} />
        )}
      </div>
      {response.context_meta?.total_estimated_tokens != null && q4_1chart && (
        <div className="mt-gm-1 pt-gm-2 border-t border-border/50">
          <MermaidDiagram
            chart={q4_1chart}
            title="图：Token 三层精度模型"
            maxHeight={MERMAID_DETAIL_MAX_HEIGHT}
          />
        </div>
      )}
    </div>
  );
}

export function PlanningVisualDetail({ response }: { response: ChatResponse }) {
  const intent = response.intent;
  if (!intent) {
    return (
      <p className="text-gm-xs text-text-muted py-gm-2 text-center">
        暂无意图数据
      </p>
    );
  }
  const pct = Math.round(intent.confidence * 100);
  const ringSize = 44;
  const radius = (ringSize - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashLen = (pct / 100) * circumference;

  // Build plan DAG mermaid from api_trace extras
  const traceExtras = response.api_trace as Record<string, unknown>;
  const planSubtasks = traceExtras["plan_subtasks"] as Array<Record<string, unknown>> | undefined;
  const planEdges = traceExtras["plan_dag_edges"] as Array<[string, string]> | undefined;
  let planDagChart: string | null = null;
  if (planSubtasks && planSubtasks.length > 0) {
    const lines = ["flowchart TD"];
    for (const t of planSubtasks) {
      const id = String(t.id ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const desc = String(t.description ?? "").replace(/"/g, "'").slice(0, 30);
      lines.push(`  n${id}["${desc}"]`);
    }
    for (const [from, to] of (planEdges ?? [])) {
      const fId = String(from).replace(/[^a-zA-Z0-9_-]/g, "_");
      const tId = String(to).replace(/[^a-zA-Z0-9_-]/g, "_");
      lines.push(`  n${fId} --> n${tId}`);
    }
    planDagChart = lines.join("\n");
  }

  return (
    <div className="space-y-gm-2">
      <div className="flex items-start gap-gm-3">
        {/* Confidence ring */}
        <div
          className="relative shrink-0"
          style={{ width: ringSize, height: ringSize }}
        >
          <svg
            width={ringSize}
            height={ringSize}
            className="-rotate-90"
            aria-label={`置信度 ${pct}%`}
          >
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke="var(--gm-surface-alt)"
              strokeWidth="3"
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke="var(--gm-accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${dashLen} ${circumference - dashLen}`}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-gm-2xs font-bold text-text">
            {pct}%
          </span>
        </div>
        {/* Category + rationale */}
        <div className="flex-1 min-w-0">
          <span className="text-gm-base font-semibold text-text">
            {intent.category}
          </span>
          {intent.rationale && (
            <p className="text-gm-xs text-text-secondary leading-relaxed mt-gm-1">
              {intent.rationale}
            </p>
          )}
        </div>
      </div>
      {/* Plan DAG mermaid */}
      {planDagChart && (
        <div className="mt-gm-2 pt-gm-2 border-t border-border/50">
          <MermaidDiagram
            chart={planDagChart}
            title={`图：${planSubtasks!.length} 个子任务的依赖 DAG`}
            maxHeight={MERMAID_DETAIL_MAX_HEIGHT}
          />
        </div>
      )}
    </div>
  );
}

// ── PillarFlowChart ─────────────────────────────────────────────────────

/** Shared mini flow chart rendered at the bottom of every expanded panel.
 *  Shows the 4-stage pipeline with the active pillar highlighted. */
function PillarFlowChart({ activeKey }: { activeKey: string }) {
  return (
    <div>
      <div className="text-gm-2xs text-text-muted mb-gm-1_5 font-medium">
        四支柱流程
      </div>
      {/* Horizontal flow nodes */}
      <div className="flex items-center gap-gm-1">
        {FLOW_STEPS.map((step, i) => {
          const isActive = activeKey === step.key;
          return (
            <span key={step.key} className="flex items-center gap-gm-1">
              {/* Node */}
              <span
                className={
                  "inline-flex items-center gap-gm-1 px-gm-1_5 py-gm-0_5 rounded-full " +
                  "text-gm-2xs font-medium border transition-colors " +
                  (isActive
                    ? "text-text shadow-gm-xs"
                    : "text-text-muted border-border/50")
                }
                style={
                  isActive
                    ? { borderColor: step.color, background: `${step.color}10` }
                    : undefined
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: step.color }}
                />
                {step.label}
              </span>
              {/* Arrow between nodes */}
              {i < FLOW_STEPS.length - 1 && (
                <span className="text-text-muted/30 text-gm-2xs shrink-0">
                  →
                </span>
              )}
            </span>
          );
        })}
      </div>
      {/* Feedback loop line */}
      <div className="flex items-center gap-gm-1 mt-gm-1">
        <span className="text-gm-2xs text-text-muted/40 shrink-0">↑</span>
        <div className="flex-1 border-t border-dashed border-border/40" />
        <span className="text-gm-2xs text-text-muted/40 shrink-0">
          反馈循环
        </span>
        <div className="flex-1 border-t border-dashed border-border/40" />
        <span className="text-gm-2xs text-text-muted/40 shrink-0">↓</span>
      </div>
    </div>
  );
}

// ── ExpandedPillarDetail ─────────────────────────────────────────────────

function ExpandedPillarDetail({
  pillarKey,
  response,
  color,
  onClose,
}: {
  pillarKey: string;
  response: ChatResponse;
  color: string;
  onClose: () => void;
}) {
  const title =
    FLOW_STEPS.find((s) => s.key === pillarKey)?.label ?? pillarKey;

  return (
    <div className="animate-gm-onion-in rounded-gm-md border border-border bg-surface-elevated shadow-gm-sm overflow-hidden mt-gm-3">
      {/* Header */}
      <div className="flex items-center justify-between px-gm-3 py-gm-2 border-b border-border/50">
        <div className="flex items-center gap-gm-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: color }}
          />
          <span className="text-gm-sm font-semibold text-text">
            {title} 详情
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-gm-sm p-gm-1 text-text-muted hover:text-text hover:bg-surface-alt transition-colors cursor-pointer active:scale-90 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
          aria-label="关闭详情"
        >
          <RiCloseLine className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="px-gm-3 py-gm-3 space-y-gm-3">
        {/* Pillar-specific visual content */}
        {pillarKey === "memory" && (
          <MemoryVisualDetail response={response} />
        )}
        {pillarKey === "context" && (
          <ContextVisualDetail response={response} />
        )}
        {pillarKey === "token" && <TokenVisualDetail response={response} />}
        {pillarKey === "planning" && (
          <PlanningVisualDetail response={response} />
        )}

        {/* Flowchart separator */}
        <div className="border-t border-border/50 pt-gm-3">
          <PillarFlowChart activeKey={pillarKey} />
        </div>
      </div>
    </div>
  );
}

// ── FourPillar ───────────────────────────────────────────────────────────

/** 四支柱全景面板 — 记忆·上下文·Token·规划 始终可见。
 *
 * COLLAPSED: 四张干净卡片水平排列，无连线、无 badge、无描述文字。
 * 每卡片仅 icon + metric + label + subtitle，hover 显示 `title` tooltip。
 *
 * EXPANDED: 点击卡片展开详情面板，视觉化展示该支柱原始数据
 * （进度条 / 标签卡片 / 堆叠柱状图 / 置信度环）+ 底部四支柱流程图。
 *
 * 空状态安全：response 为 null 时所有卡片显示占位符，点击不展开。
 */
export default function FourPillar({ response }: FourPillarProps) {
  const pillars = derivePillars(response);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const toggleExpand = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  const expandedPillar = pillars.find((p) => p.key === expandedKey);

  return (
    <div>
      {/* Card grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-gm-3">
        {pillars.map((p, i) => (
          <PillarCard
            key={p.key}
            data={p}
            delay={i * 80}
            isExpanded={expandedKey === p.key}
            onClick={() => {
              if (response) toggleExpand(p.key);
            }}
          />
        ))}
      </div>

      {/* Expanded detail panel */}
      {expandedKey && response && expandedPillar && (
        <ExpandedPillarDetail
          pillarKey={expandedKey}
          response={response}
          color={expandedPillar.color}
          onClose={() => setExpandedKey(null)}
        />
      )}
    </div>
  );
}

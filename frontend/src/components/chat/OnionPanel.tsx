"use client";

import { useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine, RiArrowUpSLine } from "@remixicon/react";
import type { ChatResponse, RecallItem } from "@/lib/api/types";
import ContextBar from "./ContextBar";
import ContextualLens from "./ContextualLens";
import ContextHealthBadge from "./ContextHealthBadge";
import ContextWindowPanel from "./ContextWindowPanel";
import GhostPromptView from "./GhostPromptView";
import IntentPill from "./IntentPill";
import ModelInferencePanel from "./ModelInferencePanel";
import NutritionLabel from "./NutritionLabel";
import StrategyPersona from "./StrategyPersona";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import { extractMermaidFromAnswer } from "@/lib/content/extractMermaid";
import { buildPartitionChart } from "@/lib/partition-chart";
import { CH1_ANSWERS } from "@/lib/content/answers/ch1";
import { CH2_ANSWERS } from "@/lib/content/answers/ch2";

/** q1.1 溢出策略决策树 — 从答案内容提取 mermaid 图，单一真相源 */
const q1_1chart = extractMermaidFromAnswer(CH1_ANSWERS[0]);
/** q2.1 事实抽取三条路线 — 从答案内容提取 mermaid 图，单一真相源 */
const _q2_1answer = CH2_ANSWERS.length > 0 ? CH2_ANSWERS[0] : undefined;
const q2_1chart = _q2_1answer ? extractMermaidFromAnswer(_q2_1answer) : null;

interface OnionPanelProps {
  response: ChatResponse;
  /** 收起洋葱面板的回调（点击头部或底部收起均触发） */
  onCollapse?: () => void;
}

export default function OnionPanel({ response, onCollapse }: OnionPanelProps) {
  const { intent, recall_items, context_meta, api_trace, system_prompt, cold_start_profile } = response;

  const recallCount = recall_items.length;

  // Phase 66 B102 — 即时 tooltip 替代原生 title (C8: rationale 截断)
  const [rationaleTooltip, setRationaleTooltip] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
    <div className="animate-gm-onion-in mt-gm-3 space-y-gm-3">
      {/* ── 顶部收起行（点击收起，避免长内容需滚到底部）── */}
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          className="flex items-center gap-gm-1 text-gm-sm text-text-muted
                     hover:text-text-secondary transition-colors cursor-pointer active:scale-[0.97]
                     focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
        >
          <RiArrowUpSLine className="text-gm-icon" />
          <span>收起洋葱面板</span>
        </button>
      )}

      {/* ── L1：意图识别 ── */}
      <div className="rounded-gm-md bg-surface-elevated border border-border px-gm-4 py-gm-3">
        <div className="flex items-center gap-gm-2 text-gm-sm">
          <span className="text-text-secondary shrink-0">🎯 意图识别</span>
          {intent ? (
            <>
              <IntentPill category={intent.category} confidence={intent.confidence} rationale={intent.rationale} complexity={response.routing?.complexity} />
              <span
                className="text-text-muted truncate"
                onMouseEnter={(e) => setRationaleTooltip({ x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setRationaleTooltip((prev) => (prev ? { x: e.clientX, y: e.clientY } : null))}
                onMouseLeave={() => setRationaleTooltip(null)}
              >
                {intent.rationale}
              </span>
            </>
          ) : (
            <span className="text-text-muted">未识别</span>
          )}
        </div>
      </div>

      {/* ── L2：记忆召回（含叙事面板）── */}
      <div className="rounded-gm-md bg-surface-elevated border border-border px-gm-4 py-gm-3">
        <p className="text-gm-sm text-text-secondary mb-gm-2">
          🧠 记忆召回 · 检索到{" "}
          <span className="text-text font-medium">{recallCount}</span>{" "}
          条相关记忆
        </p>
        {recallCount === 0 ? (
          <>
            <p className="text-gm-sm text-text-muted">暂无相关记忆（可能是首次对话）</p>
            {/* q2.19 冷启动自感知：当记忆系统尚冷时，展示系统自我认知 */}
            {cold_start_profile && cold_start_profile.phase !== "hot" && (
              <div className="mt-gm-2 rounded-gm-xs bg-accent/10 border border-brand/15 px-gm-3 py-gm-2">
                <div className="flex items-center gap-gm-2 text-gm-xs">
                  <span className="text-gm-sm">
                    {cold_start_profile.phase === "cold" ? "❄️" : "🌤️"}
                  </span>
                  <span className="text-text-secondary">
                    系统记忆状态：<span className="text-text font-medium">{cold_start_profile.phase_label}</span>
                    {cold_start_profile.hint && (
                      <> — {cold_start_profile.hint}</>
                    )}
                  </span>
                </div>
                {/* 进度条：冷→热 */}
                <div className="mt-gm-1 h-1 rounded-full bg-bg-deep overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-700"
                    style={{ width: `${Math.max(2, cold_start_profile.progression_pct)}%` }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* 召回教学入口 — 解释记忆从对话中抽取的原理 */}
            {q2_1chart && (
              <div className="mb-gm-2">
                <ContextualLens
                  triggerLabel="🧠 这些记忆怎么来的？"
                  title="事实抽取：AI 如何从对话中提取记忆"
                >
                  <MermaidDiagram
                    chart={q2_1chart}
                    title="图：事实抽取三条路线"
                    maxHeight={400}
                  />
                </ContextualLens>
              </div>
            )}

            {/* 召回叙事 — 自然语言解释检索过程 */}
            <p className="text-gm-xs text-text-muted leading-relaxed mb-gm-3">
              系统从记忆中检索到 <span className="text-text font-medium">{recallCount}</span>{" "}
              条相关内容，按{" "}
              <strong className="text-text">相似度 × 强度 × 重要性</strong>{" "}
              综合评分排序。
              {(() => {
                const scores = recall_items
                  .map((r) => r.similarity ?? r.composite_score)
                  .filter((s): s is number => s != null);
                if (scores.length >= 2) {
                  return (
                    <>
                      {" "}评分范围{" "}
                      <span className="text-text font-medium">
                        {(Math.min(...scores) * 100).toFixed(0)}%
                      </span>
                      {" ~ "}
                      <span className="text-text font-medium">
                        {(Math.max(...scores) * 100).toFixed(0)}%
                      </span>
                      。
                    </>
                  );
                }
                return "。";
              })()}
            </p>

            {/* 召回条目列表 */}
            <div className="space-y-gm-1">
              {recall_items.map((item) => (
                <RecallItemRow key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── L3：上下文窗口（增强：ContextBar + 营养标签 + 策略 + 明细 + Ghost）── */}
      <div className="rounded-gm-md bg-surface-elevated border border-border px-gm-4 py-gm-3">
        {/* 标题行：图标 + 文字 + 健康徽章 */}
        <div className="flex items-center gap-gm-2 mb-gm-2">
          <p className="text-gm-sm text-text-secondary">📐 上下文窗口</p>
          <ContextHealthBadge meta={context_meta} />
        </div>

        {/* ContextBar 增强版（溢出线 + 压缩气泡已在组件内） */}
        <ContextBar meta={context_meta} />

        {/* NutritionLabel — FDA 风格营养成分卡 */}
        <div className="mt-gm-3">
          <NutritionLabel meta={context_meta} />
        </div>

        {/* StrategyPersona — 当前策略人格 */}
        <div className="mt-gm-3">
          <p className="text-gm-xs text-text-muted mb-gm-1 font-medium">策略人格</p>
          <StrategyPersona activeStrategy={context_meta.strategy} />
        </div>

        {/* ContextWindowPanel — 展开详情 */}
        <div className="mt-gm-3">
          <ContextWindowPanel meta={context_meta} />
        </div>

        {/* GhostPromptView — system prompt 源码 */}
        <div className="mt-gm-2">
          <GhostPromptView systemPrompt={system_prompt} />
        </div>

        {/* ── 溢出策略透镜 (q1.1) ── */}
        {q1_1chart && (
          <div className="mt-gm-3">
            <ContextualLens
              triggerLabel="📐 溢出策略怎么选？"
              title="三种上下文溢出处理策略"
            >
              <MermaidDiagram
                chart={q1_1chart}
                title="图：三种上下文溢出处理策略"
                maxHeight={400}
              />
            </ContextualLens>
          </div>
        )}

        {/* Phase 42 Batch 2: 上下文窗口分区透镜 */}
        <div className="mt-gm-3">
          <ContextualLens
            triggerLabel="📐 窗口分区怎么分的？"
            title={`上下文窗口分区 — ${context_meta.window_size.toLocaleString()} tokens`}
          >
            <MermaidDiagram
              chart={buildPartitionChart(context_meta)}
              title="图：上下文窗口四区划分"
              maxHeight={400}
            />
          </ContextualLens>
        </div>
      </div>

      {/* ── L4/L5：模型推理面板 — 实际 API 调用详情 ── */}
      <ModelInferencePanel apiTrace={api_trace} />
    </div>
    {/* Phase 66 B102 — 即时 tooltip 替代原生 title (C8) */}
    {rationaleTooltip && intent?.rationale && (
      <div
        className="fixed z-50 rounded-gm-sm border border-border-strong
                   bg-surface-elevated px-gm-2.5 py-gm-1.5
                   shadow-gm-md pointer-events-none max-w-[320px]"
        style={{ left: rationaleTooltip.x + 12, top: rationaleTooltip.y - 8 }}
      >
        <p className="text-gm-xs text-text whitespace-normal">{intent.rationale}</p>
      </div>
    )}
    </>
  );
}

/** 单条召回记忆行——可展开查看完整内容与衰减数据 */
function RecallItemRow({ item }: { item: RecallItem }) {
  const [open, setOpen] = useState(false);
  const excerpt = item.content.length > 120 ? item.content.slice(0, 120) + "…" : item.content;
  const score = item.similarity ?? item.composite_score;

  return (
    <div className="rounded-gm-xs bg-bg-subtle px-gm-3 py-gm-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`recall-${item.id}-detail`}
        className="flex items-start gap-gm-1 w-full text-left text-gm-sm text-text hover:text-text-secondary transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:text-text-secondary"
      >
        <span className="shrink-0 mt-px">
          {open ? (
            <RiArrowDownSLine className="text-gm-icon" />
          ) : (
            <RiArrowRightSLine className="text-gm-icon" />
          )}
        </span>
        <span className="flex-1 min-w-0">
          {open ? item.content : excerpt}
        </span>
        {score != null && (
          <span className="shrink-0 text-gm-xs text-text-muted font-mono">
            {(score * 100).toFixed(1)}%
          </span>
        )}
      </button>
      {open && (
        <div id={`recall-${item.id}-detail`} className="mt-gm-2 ml-gm-5 space-y-gm-1">
          {/* 对 episode 类型：显示当前强度进度条 */}
          {item.initial_strength != null && item.initial_strength > 0 && (
            <div className="flex items-center gap-gm-2">
              <span className="text-gm-2xs text-text-muted shrink-0 w-10">当前强度</span>
              <div className="flex-1 h-1.5 rounded-full bg-bg-deep overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{
                    width: `${Math.min(100, (((item.composite_score ?? 0) / item.initial_strength) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-gm-2xs text-text-muted font-mono shrink-0">
                {(((item.composite_score ?? 0) / item.initial_strength) * 100).toFixed(0)}%
              </span>
            </div>
          )}

          {/* 对 fact 类型：显示置信度进度条 */}
          {item.confidence != null && (
            <div className="flex items-center gap-gm-2">
              <span className="text-gm-2xs text-text-muted shrink-0 w-10">置信度</span>
              <div className="flex-1 h-1.5 rounded-full bg-bg-deep overflow-hidden">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{ width: `${(item.confidence * 100).toFixed(0)}%` }}
                />
              </div>
              <span className="text-gm-2xs text-text-muted font-mono shrink-0">
                {(item.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )}

          {/* 已访问次数 */}
          {item.access_count != null && (
            <div className="text-gm-2xs text-text-muted">
              已访问 <span className="text-text font-medium">{item.access_count}</span> 次
            </div>
          )}

          {/* 衰减速率 λ */}
          {item.lambda != null && (
            <div className="text-gm-2xs text-text-muted">
              衰减速率 λ = <span className="text-text font-mono">{item.lambda.toFixed(4)}</span>
            </div>
          )}

          {/* 召回理由 (q2.18 记忆可解释性) — 解释「为什么召回这条」 */}
          {item.recall_reason && (
            <div className="text-gm-2xs text-text-muted mt-gm-1 pt-gm-1 border-t border-border-light">
              <span className="text-gm-2xs text-text-muted/70">为什么召回这条</span>
              <br />
              <span className="text-text-secondary">{item.recall_reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

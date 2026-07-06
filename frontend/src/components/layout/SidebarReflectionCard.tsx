"use client";

import { useState, useEffect } from "react";
import {
  RiLightbulbLine,
  RiArrowUpLine,
  RiBrainLine,
  RiRefreshLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import type { PlanRun, PlanDetail } from "@/lib/api/types";

// ── 辅助 ──

/** 将 0-1 分数渲染为百分比字符串 */
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** 根据分数返回颜色类 */
function scoreColor(n: number): string {
  if (n >= 0.8) return "bg-success";
  if (n >= 0.6) return "bg-warning";
  return "bg-danger";
}

type Phase = "idle" | "loading" | "loading-plan" | "reflecting" | "done" | "error" | "no-plan";

/**
 * Sidebar 反思卡片 — 展示规划反思结果。
 *
 * Phase 53 Batch 2：接入真实 API。挂载时获取最新 plan，
 * 点击"触发反思"调用 POST /planner/reflect。
 */
export default function SidebarReflectionCard() {
  const [phase, setPhase] = useState<Phase>("loading-plan");
  const [latestPlan, setLatestPlan] = useState<PlanRun | null>(null);
  const [reflections, setReflections] = useState<string[]>([]);
  const [improvementSuggestions, setImprovementSuggestions] = useState<string[]>([]);
  const [planQualityScore, setPlanQualityScore] = useState(0);
  const [confidence, setConfidence] = useState(0);

  // 挂载时获取最新 plan
  useEffect(() => {
    let cancelled = false;
    async function fetchLatest() {
      try {
        const plans = await api.getPlans(undefined, 1);
        if (cancelled) return;
        if (plans.length > 0) {
          setLatestPlan(plans[0]);
          setPhase("idle");
        } else {
          setPhase("no-plan");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    }
    fetchLatest();
    return () => { cancelled = true; };
  }, []);

  const handleReflect = async () => {
    if (!latestPlan) return;
    setPhase("reflecting");
    try {
      // 获取完整 plan detail 以便传入真实 subtasks
      const detail: PlanDetail = await api.getPlan(latestPlan.id);
      const planSubtasks = detail.subtasks.map((s) => ({
        id: s.subtask_id,
        description: s.description,
        depends_on: (() => {
          try { return JSON.parse(s.depends_on_json || "[]"); } catch { return []; }
        })(),
      }));
      const res = await api.reflect({
        user_msg: latestPlan.user_msg,
        intent_category: latestPlan.intent_category,
        plan_json: JSON.stringify({
          subtasks: planSubtasks,
          dag_edges: (() => {
            try { return JSON.parse(latestPlan.dag_edges_json || "[]"); } catch { return []; }
          })(),
          rationale: latestPlan.rationale,
          confidence: latestPlan.confidence,
        }),
      });
      setReflections(res.reflections);
      setImprovementSuggestions(res.improvement_suggestions);
      setPlanQualityScore(res.plan_quality_score);
      setConfidence(res.confidence);
      setPhase("done");
    } catch {
      setPhase("error");
    }
  };

  const handleReset = () => setPhase("idle");

  return (
    <section
      className="shrink-0 rounded-gm-sm bg-surface-elevated border border-border p-gm-3"
      aria-label="规划反思"
    >
      {/* ── 标题栏 ── */}
      <div className="flex items-center gap-gm-2 mb-gm-2">
        <RiBrainLine className="w-4 h-4 text-brand shrink-0" />
        <p className="text-gm-xs text-text-muted uppercase tracking-wide font-medium">
          规划反思
        </p>
        {phase === "done" && (
          <button
            type="button"
            onClick={handleReset}
            className="ml-auto text-gm-xs text-text-muted hover:text-text transition-colors"
            aria-label="重新触发反思"
          >
            <RiRefreshLine className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ── loading-plan：获取最新计划 ── */}
      {phase === "loading-plan" && (
        <div className="flex items-center justify-center gap-gm-2 py-gm-2 text-text-muted">
          <RiRefreshLine className="w-4 h-4 animate-spin" />
          <span className="text-gm-xs">加载中…</span>
        </div>
      )}

      {/* ── no-plan：暂无计划 ── */}
      {phase === "no-plan" && (
        <div>
          <p className="text-gm-xs text-text-secondary leading-relaxed mb-gm-2">
            对最近一次任务规划进行事后反思，
            检查计划与实际对话是否一致，发现可改进之处。
          </p>
          <p className="text-gm-xs text-text-muted italic text-center py-gm-2">
            发送消息后规划结果将在此展示
          </p>
        </div>
      )}

      {/* ── idle：触发按钮 ── */}
      {phase === "idle" && latestPlan && (
        <div>
          <p className="text-gm-xs text-text-secondary leading-relaxed mb-gm-2">
            对最近一次任务规划进行事后反思，
            检查计划与实际对话是否一致，发现可改进之处。
          </p>
          <p className="text-gm-xs text-text-muted italic mb-gm-2 leading-relaxed truncate">
            &ldquo;{latestPlan.user_msg}&rdquo;
          </p>
          <button
            type="button"
            onClick={handleReflect}
            className="w-full flex items-center justify-center gap-gm-2
                       rounded-gm-xs bg-brand/10 hover:bg-brand/20
                       border border-brand/30
                       px-gm-3 py-gm-1_5 text-gm-xs font-medium
                       text-brand transition-colors"
          >
            <RiLightbulbLine className="w-3.5 h-3.5" />
            触发反思
          </button>
        </div>
      )}

      {/* ── reflecting：加载态 ── */}
      {phase === "reflecting" && (
        <div className="flex items-center justify-center gap-gm-2 py-gm-2 text-text-muted">
          <RiRefreshLine className="w-4 h-4 animate-spin" />
          <span className="text-gm-xs">反思中…</span>
        </div>
      )}

      {/* ── done：反思结果 ── */}
      {phase === "done" && (
        <div className="space-y-gm-3">
          {/* 反思文本 */}
          {reflections.length > 0 && (
            <div>
              <p className="text-gm-xs font-semibold text-text-secondary flex items-center gap-gm-1 mb-gm-1">
                <RiLightbulbLine className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                反思发现
              </p>
              <ul className="space-y-gm-1">
                {reflections.map((r, i) => (
                  <li
                    key={i}
                    className="text-gm-xs text-text-secondary leading-relaxed pl-gm-4 relative
                               before:content-['·'] before:absolute before:left-1 before:text-text-muted"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 改进建议 */}
          {improvementSuggestions.length > 0 && (
            <div>
              <p className="text-gm-xs font-semibold text-text-secondary flex items-center gap-gm-1 mb-gm-1">
                <RiArrowUpLine className="w-3.5 h-3.5 text-success shrink-0" />
                改进建议
              </p>
              <ul className="space-y-gm-1">
                {improvementSuggestions.map((s, i) => (
                  <li
                    key={i}
                    className="text-gm-xs text-text-secondary leading-relaxed pl-gm-4 relative
                               before:content-['→'] before:absolute before:left-0.5 before:text-brand before:text-gm-xs"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 质量评分 + 置信度 */}
          <div className="grid grid-cols-2 gap-gm-2">
            {/* 计划质量评分 */}
            <div className="rounded-gm-xs bg-surface-lowered p-gm-2">
              <p className="text-gm-xs text-text-muted mb-gm-1">计划质量</p>
              <div className="flex items-center gap-gm-1_5">
                <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${scoreColor(planQualityScore)}`}
                    style={{ width: pct(planQualityScore) }}
                  />
                </div>
                <span className="text-gm-xs font-semibold text-text tabular-nums">
                  {pct(planQualityScore)}
                </span>
              </div>
            </div>

            {/* 置信度 */}
            <div className="rounded-gm-xs bg-surface-lowered p-gm-2 text-center">
              <p className="text-gm-xs text-text-muted mb-gm-0.5">置信度</p>
              <p className="text-gm-sm font-bold text-text tabular-nums">
                {pct(confidence)}
              </p>
            </div>
          </div>

          {/* 后端引擎引用 */}
          <p className="text-gm-xs text-text-muted text-center pt-gm-1 border-t border-border-light">
            <code className="text-gm-xs bg-surface-lowered px-gm-1 rounded-gm-xs">
              src/planner/reflection.py
            </code>
            {" "}ReflectionEngine L3 事后反思
          </p>
        </div>
      )}

      {/* ── error：出错重试 ── */}
      {phase === "error" && (
        <div className="text-center py-gm-2">
          <p className="text-gm-xs text-text-muted mb-gm-2">
            加载失败，请重试
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("loading-plan");
              api.getPlans(undefined, 1)
                .then((plans) => {
                  if (plans.length > 0) {
                    setLatestPlan(plans[0]);
                    setPhase("idle");
                  } else {
                    setPhase("no-plan");
                  }
                })
                .catch(() => setPhase("error"));
            }}
            className="inline-flex items-center gap-gm-1 text-gm-xs text-brand hover:underline"
          >
            <RiRefreshLine className="w-3.5 h-3.5" />
            重试
          </button>
        </div>
      )}
    </section>
  );
}

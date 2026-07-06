"use client";

import { useState, useEffect, useRef } from "react";
import {
  RiArrowLeftRightLine,
  RiAddLine,
  RiSubtractLine,
  RiRefreshLine,
  RiCheckLine,
  RiCloseLine,
  RiSkipForwardLine,
} from "@remixicon/react";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import { api } from "@/lib/api/client";
import type { PlanRun, PlanDetail, PlanOverrideRequest } from "@/lib/api/types";
import { INTENT_COLORS, DEFAULT_INTENT_COLORS } from "@/lib/content/constants";

// ── 类型 ──

interface Subtask {
  id: string;
  description: string;
  depends_on?: string[];
}

interface PlanSnapshot {
  intent: string;
  confidence: number;
  subtasks: Subtask[];
  dagEdges: [string, string][];
  rationale: string;
}

interface DiffData {
  added: string[];
  removed: string[];
}

// ── 辅助：从 PlanRun/PlanDetail 构建 PlanSnapshot ──

function buildSnapshot(plan: PlanRun | PlanDetail): PlanSnapshot {
  const subtasks: Subtask[] = [];
  if ("subtasks" in plan && plan.subtasks) {
    for (const s of plan.subtasks) {
      let dependsOn: string[] = [];
      try {
        dependsOn = JSON.parse(s.depends_on_json || "[]");
      } catch { /* keep empty */ }
      subtasks.push({
        id: s.subtask_id,
        description: s.description,
        depends_on: dependsOn,
      });
    }
  }
  let dagEdges: [string, string][] = [];
  try {
    dagEdges = JSON.parse(plan.dag_edges_json || "[]");
  } catch { /* keep empty */ }

  return {
    intent: plan.intent_category,
    confidence: plan.confidence,
    subtasks,
    dagEdges,
    rationale: plan.rationale,
  };
}

function computeDiff(original: PlanSnapshot, revised: PlanSnapshot): DiffData {
  const origDescs = new Set(original.subtasks.map((t) => t.description));
  const revDescs = new Set(revised.subtasks.map((t) => t.description));
  return {
    added: revised.subtasks
      .filter((t) => !origDescs.has(t.description))
      .map((t) => t.description),
    removed: original.subtasks
      .filter((t) => !revDescs.has(t.description))
      .map((t) => t.description),
  };
}

// ── 辅助：生成 mini DAG mermaid 字符串 ──

function makeDagChart(subtasks: Subtask[], edges: [string, string][]): string {
  const nodeLines = subtasks.map(
    (t) => `    ${t.id}["${t.description.replace(/"/g, "'")}"]`,
  );
  const edgeLines = edges.map(([from, to]) => `    ${from} --> ${to}`);
  return `graph TD\n${nodeLines.join("\n")}\n${edgeLines.join("\n")}`;
}

// ── 意图标签颜色映射（从共享常量导入） ──

function intentPillClass(intent: string): string {
  const c = INTENT_COLORS[intent] ?? DEFAULT_INTENT_COLORS;
  return `${c.bg} ${c.text} ${c.border}`;
}

// ── PlanColumn — 内联子组件 ──

type InterveneHandler = (
  stepId: string,
  action: PlanOverrideRequest["overrides"][0]["action"],
) => void;

function PlanColumn({
  plan,
  label,
  side,
  onIntervene,
  intervening,
}: {
  plan: PlanSnapshot;
  label: string;
  side: "left" | "right";
  onIntervene?: InterveneHandler;
  intervening?: boolean;
}) {
  const dagChart = makeDagChart(plan.subtasks, plan.dagEdges);
  const borderColor = side === "left" ? "border-amber-200" : "border-emerald-200";
  const bgAccent =
    side === "left" ? "bg-amber-50/60" : "bg-emerald-50/60";
  const badgeColor = side === "left" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";

  return (
    <div
      className={`rounded-gm-sm border-2 p-gm-4 ${borderColor} ${bgAccent}`}
    >
      {/* 列标签 */}
      <span
        className={`inline-block text-gm-xs font-semibold px-gm-2 py-gm-0.5 rounded-gm-xs mb-gm-3 ${badgeColor}`}
      >
        {label}
      </span>

      {/* 意图标签 */}
      <div className="flex items-center gap-gm-1.5 mb-gm-2">
        <span className="text-gm-xs text-text-muted">意图</span>
        <span
          className={`inline-block text-gm-xs font-medium px-gm-1.5 py-px rounded-gm-xs border ${intentPillClass(plan.intent)}`}
        >
          {plan.intent}
        </span>
      </div>

      {/* 理由 */}
      <p className="text-gm-xs text-text-secondary mb-gm-3 leading-relaxed">
        {plan.rationale}
      </p>

      {/* Mini DAG */}
      <div className="mb-gm-3">
        <h5 className="text-gm-xs font-semibold text-text-secondary mb-gm-1">
          任务依赖图
        </h5>
        <MermaidDiagram
          chart={dagChart}
          title={`${label}任务DAG`}
          maxHeight={220}
          className="mx-auto"
        />
      </div>

      {/* 子任务列表 */}
      <div className="border-t border-border-light pt-gm-2 mb-gm-2">
        <h5 className="text-gm-xs font-semibold text-text-secondary mb-gm-1.5">
          子任务 ({plan.subtasks.length})
        </h5>
        <ul className="space-y-gm-1">
          {plan.subtasks.map((t) => (
            <li
              key={t.id}
              className="text-gm-xs text-text-secondary flex items-start gap-gm-1.5"
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-alt border border-border text-gm-xs font-mono text-text-muted shrink-0 mt-px">
                {t.id}
              </span>
              <span className="flex-1">{t.description}</span>
              {onIntervene && (
                <span className="inline-flex items-center gap-gm-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onIntervene(t.id, "accept"); }}
                    disabled={intervening}
                    title="接受此步骤"
                    className="p-0.5 rounded-gm-xs text-success hover:bg-success/10 disabled:opacity-40"
                  >
                    <RiCheckLine className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onIntervene(t.id, "reject"); }}
                    disabled={intervening}
                    title="拒绝此步骤"
                    className="p-0.5 rounded-gm-xs text-danger hover:bg-danger/10 disabled:opacity-40"
                  >
                    <RiCloseLine className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onIntervene(t.id, "skip"); }}
                    disabled={intervening}
                    title="跳过此步骤"
                    className="p-0.5 rounded-gm-xs text-text-muted hover:bg-surface-alt disabled:opacity-40"
                  >
                    <RiSkipForwardLine className="w-3 h-3" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* 置信度 */}
      <div className="flex items-center gap-gm-1.5 text-gm-xs text-text-muted">
        <span>置信度</span>
        <div className="flex-1 h-1.5 rounded-full bg-surface-alt border border-border overflow-hidden">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${Math.round(plan.confidence * 100)}%` }}
          />
        </div>
        <span className="tabular-nums font-mono">
          {(plan.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// ── 公开组件 ──

type PanelPhase = "loading" | "empty" | "single" | "compare" | "error";

/**
 * 重规划对比面板。
 *
 * Phase 53 Batch 2：接入真实 API。获取最近 2 次规划运行，
 * 并排对比原始计划 vs 最新计划。ReplanDetector 的事件驱动
 * 对比将在后续 Batch 中接入管线。
 */
export default function ReplanComparePanel() {
  const [phase, setPhase] = useState<PanelPhase>("loading");
  const [original, setOriginal] = useState<PlanSnapshot | null>(null);
  const [revised, setRevised] = useState<PlanSnapshot | null>(null);
  const [diff, setDiff] = useState<DiffData>({ added: [], removed: [] });
  const [intervening, setIntervening] = useState(false);
  const [interveneResult, setInterveneResult] = useState<string | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);
  const mountedRef = useRef(true);

  const loadPlans = async () => {
    setPhase("loading");
    try {
      const plans = await api.getPlans(undefined, 2);
      if (!mountedRef.current) return;
      if (plans.length >= 2) {
        // 两阶段加载：先拿 ID 列表，再并行获取含 subtasks 的详情
        const [detailA, detailB] = await Promise.all([
          api.getPlan(plans[1].id), // 较旧的
          api.getPlan(plans[0].id), // 较新的
        ]);
        if (!mountedRef.current) return;
        const orig = buildSnapshot(detailA);
        const rev = buildSnapshot(detailB);
        setOriginal(orig);
        setRevised(rev);
        setDiff(computeDiff(orig, rev));
        setPlanId(detailB.id);  // 最新计划 ID 用于干预操作
        setInterveneResult(null);
        setPhase("compare");
      } else if (plans.length === 1) {
        const detail = await api.getPlan(plans[0].id);
        if (!mountedRef.current) return;
        const rev = buildSnapshot(detail);
        setRevised(rev);
        setOriginal(null);
        setPhase("single");
      } else {
        setPhase("empty");
      }
    } catch {
      if (mountedRef.current) setPhase("error");
    }
  };

  const applyIntervention = async (
    overrides: PlanOverrideRequest["overrides"],
    actionLabel: string,
  ) => {
    if (planId === null) return;
    setIntervening(true);
    setInterveneResult(null);
    try {
      const result = await api.updatePlan(planId, { overrides });
      if (!mountedRef.current) return;
      setInterveneResult(
        `${actionLabel} — ${result.applied} 项已应用` +
          (result.rejected > 0 ? `，${result.rejected} 项被拒绝` : ""),
      );
      // 刷新计划数据
      const detail = await api.getPlan(planId);
      if (!mountedRef.current) return;
      const rev = buildSnapshot(detail);
      setRevised(rev);
      if (original) {
        setDiff(computeDiff(original, rev));
      }
    } catch {
      if (mountedRef.current) {
        setInterveneResult("干预失败，请重试");
      }
    } finally {
      if (mountedRef.current) setIntervening(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, loadPlans is async
    loadPlans();
    return () => { mountedRef.current = false; };
  }, []);

  const hasDiff = diff.added.length > 0 || diff.removed.length > 0;

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiArrowLeftRightLine className="w-5 h-5 text-brand" />
        <h3 className="text-gm-sm font-semibold text-text">重规划对比</h3>
        <span className="text-gm-xs text-text-muted">
          最近两次规划并排对比
        </span>
      </div>

      {/* ── loading ── */}
      {phase === "loading" && (
        <div className="flex items-center justify-center gap-gm-2 py-gm-8 text-text-muted">
          <RiRefreshLine className="w-5 h-5 animate-spin" />
          <span className="text-gm-sm">加载规划数据…</span>
        </div>
      )}

      {/* ── empty ── */}
      {phase === "empty" && (
        <div className="text-center py-gm-8">
          <p className="text-gm-sm text-text-muted mb-gm-2">
            暂无规划数据
          </p>
          <p className="text-gm-xs text-text-muted">
            发送消息后规划结果将在此展示
          </p>
        </div>
      )}

      {/* ── single：仅一个计划 ── */}
      {phase === "single" && revised && (
        <div className="space-y-gm-4">
          <div className="rounded-gm-sm bg-surface-alt border border-border px-gm-3 py-gm-2">
            <span className="text-gm-xs text-text-muted">
              仅有 1 次规划记录。发送更多消息以对比。
            </span>
          </div>
          <div className="max-w-md mx-auto">
            <PlanColumn plan={revised} label="当前计划" side="right" />
          </div>
        </div>
      )}

      {/* ── compare：并排对比 ── */}
      {phase === "compare" && original && revised && (
        <>
          {/* 三列对比 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gm-4 mb-gm-5">
            {/* 左列：原始计划 */}
            <PlanColumn plan={original} label="较旧计划" side="left" />

            {/* 中列：差异摘要 */}
            <div className="rounded-gm-sm border-2 border-brand/20 bg-brand/[0.02] p-gm-4 flex flex-col">
              <span className="inline-block text-gm-xs font-semibold px-gm-2 py-gm-0.5 rounded-gm-xs bg-brand/15 text-brand mb-gm-3 self-start">
                差异摘要
              </span>

              {hasDiff ? (
                <div className="space-y-gm-3 flex-1">
                  {diff.added.length > 0 && (
                    <div>
                      <span className="text-gm-xs font-semibold text-success flex items-center gap-gm-1 mb-gm-1">
                        <RiAddLine className="w-3.5 h-3.5" />
                        新增 ({diff.added.length})
                      </span>
                      <ul className="space-y-gm-0.5">
                        {diff.added.map((item) => (
                          <li
                            key={item}
                            className="text-gm-xs text-text-secondary flex items-start gap-gm-1 pl-gm-5"
                          >
                            <RiAddLine className="w-3 h-3 text-success mt-gm-0_5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {diff.removed.length > 0 && (
                    <div>
                      <span className="text-gm-xs font-semibold text-danger flex items-center gap-gm-1 mb-gm-1">
                        <RiSubtractLine className="w-3.5 h-3.5" />
                        删除 ({diff.removed.length})
                      </span>
                      <ul className="space-y-gm-0.5">
                        {diff.removed.map((item) => (
                          <li
                            key={item}
                            className="text-gm-xs text-text-secondary flex items-start gap-gm-1 pl-gm-5 line-through"
                          >
                            <RiSubtractLine className="w-3 h-3 text-danger mt-gm-0_5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!hasDiff && (
                    <p className="text-gm-xs text-text-muted italic">
                      子任务无显著变化
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-gm-xs text-text-muted italic">
                  子任务无显著变化
                </p>
              )}

              {/* 批量干预按钮 */}
              <div className="border-t border-border-light pt-gm-3 mt-gm-3">
                <span className="text-gm-xs font-semibold text-text-secondary mb-gm-2 block">
                  批量操作
                </span>
                <div className="flex flex-col gap-gm-1.5">
                  <button
                    type="button"
                    disabled={intervening}
                    onClick={() =>
                      applyIntervention(
                        revised.subtasks.map((t) => ({ step_id: t.id, action: "accept" as const })),
                        "接受全部修正",
                      )
                    }
                    className="inline-flex items-center justify-center gap-gm-1 text-gm-xs font-medium px-gm-3 py-gm-1 rounded-gm-sm bg-success/10 text-success border border-success/20 hover:bg-success/20 disabled:opacity-40 transition-colors"
                  >
                    <RiCheckLine className="w-3.5 h-3.5" />
                    接受全部修正
                  </button>
                  <button
                    type="button"
                    disabled={intervening}
                    onClick={() =>
                      applyIntervention(
                        revised.subtasks.map((t) => ({ step_id: t.id, action: "reject" as const })),
                        "拒绝全部修正",
                      )
                    }
                    className="inline-flex items-center justify-center gap-gm-1 text-gm-xs font-medium px-gm-3 py-gm-1 rounded-gm-sm bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 disabled:opacity-40 transition-colors"
                  >
                    <RiCloseLine className="w-3.5 h-3.5" />
                    拒绝全部
                  </button>
                </div>
                {/* 干预结果反馈 */}
                {interveneResult && (
                  <p className={`text-gm-xs mt-gm-2 font-medium ${
                    interveneResult.includes("失败") ? "text-danger" : "text-success"
                  }`}>
                    {interveneResult}
                  </p>
                )}
              </div>

              {/* 置信度对比 */}
              <div className="border-t border-border-light pt-gm-3 mt-gm-3">
                <span className="text-gm-xs font-semibold text-text-secondary mb-gm-1 block">
                  置信度变化
                </span>
                <div className="flex items-center gap-gm-2 text-gm-xs text-text-muted">
                  <span className="text-amber-600 font-mono">
                    {(original.confidence * 100).toFixed(0)}%
                  </span>
                  <RiArrowLeftRightLine className="w-3 h-3" />
                  <span className="text-emerald-600 font-mono">
                    {(revised.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>

            {/* 右列：最新计划（含逐步骤干预按钮） */}
            <PlanColumn
              plan={revised}
              label="最新计划"
              side="right"
              onIntervene={(stepId, action) =>
                applyIntervention(
                  [{ step_id: stepId, action }],
                  `步骤 ${stepId}: ${action}`,
                )
              }
              intervening={intervening}
            />
          </div>
        </>
      )}

      {/* ── error ── */}
      {phase === "error" && (
        <div className="text-center py-gm-4">
          <p className="text-gm-xs text-text-muted mb-gm-2">
            加载失败
          </p>
          <button
            type="button"
            onClick={loadPlans}
            className="inline-flex items-center gap-gm-1 text-gm-xs text-brand hover:underline"
          >
            <RiRefreshLine className="w-3.5 h-3.5" />
            重试
          </button>
        </div>
      )}

      {/* 底部说明 */}
      <div className="border-t border-border pt-gm-4 mt-gm-4">
        <p className="text-gm-xs text-text-muted/70 text-center">
          后端引擎：<code className="text-gm-xs bg-surface-alt px-gm-1 rounded-gm-xs">src/planner/plan.py</code> — PlanGenerator + PlanStore (Phase 53)
        </p>
      </div>
    </section>
  );
}

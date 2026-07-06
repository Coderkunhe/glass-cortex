"use client";

import { useState, useCallback, useEffect } from "react";
import {
  RiScalesLine,
  RiLoader4Line,
  RiCheckLine,
  RiCloseLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import type { CompareStrategiesResponse, StrategyPersona, FetchState } from "@/lib/api/types";


/** Remix icon name → 策略颜色 CSS 变量映射 */
const PERSONA_COLOR_MAP: Record<string, { border: string; bg: string }> = {
  truncate: { border: "border-info/30", bg: "bg-info/5" },
  prioritize: { border: "border-success/30", bg: "bg-success/5" },
  summarize: { border: "border-accent/30", bg: "bg-accent/5" },
};

/** 从对比结果中提取推荐叙事 */
function getRecommendationNarrative(
  data: CompareStrategiesResponse,
  personaMap: Map<string, StrategyPersona>,
): string | null {
  const results = [
    { key: "truncate", ...data.truncate },
    { key: "prioritize", ...data.prioritize },
    { key: "summarize", ...data.summarize },
  ];
  const minWasted = Math.min(...results.map((r) => r.wasted_tokens));
  const bests = results.filter((r) => r.wasted_tokens === minWasted);

  if (bests.length === 0) return null;
  if (bests.length === 1) {
    const persona = personaMap.get(bests[0].key);
    const name = persona?.name ?? bests[0].key;
    return `推荐「${name}」策略 — 浪费 ${bests[0].wasted_tokens} tokens，为三种策略中最少`;
  }
  // 多个并列最优
  const names = bests
    .map((b) => personaMap.get(b.key)?.name ?? b.key)
    .join(" 和 ");
  return `「${names}」并列最优 — 各浪费 ${minWasted} tokens，可按场景偏好选择`;
}

/**
 * 策略对比面板。
 * 对同一输入运行三种溢出策略，并排展示对比结果。
 */
export default function StrategyComparePanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<CompareStrategiesResponse | null>(null);
  const [personas, setPersonas] = useState<StrategyPersona[]>([]);
  const [error, setError] = useState<Error | string | null>(null);

  const [windowSize, setWindowSize] = useState(4096);
  const [userInput, setUserInput] = useState("");

  // 挂载时获取策略人格数据
  useEffect(() => {
    api.getStrategyPersonas().then((r) => setPersonas(r.personas)).catch(() => {
      // 静默失败 — 人格数据非关键，卡片降级为纯数据展示
    });
  }, []);

  const fetchCompare = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.compareStrategies({
        window_size: windowSize,
        user_input: userInput || undefined,
      });
      setData(result);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("对比失败"));
      setState("error");
    }
  }, [windowSize, userInput]);


  const personaMap = new Map(personas.map((p) => [p.id, p]));

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiScalesLine className="w-5 h-5 text-accent" />
        <h3 className="text-gm-sm font-semibold text-text">策略对比</h3>
        <span className="text-gm-xs text-text-muted">
          同一输入 → 三种策略并排对比
        </span>
      </div>

      {/* 表单区 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-gm-3 mb-gm-4">
        <div>
          <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
            窗口大小: {windowSize} tokens
          </label>
          <input
            type="range"
            min={256}
            max={8192}
            step={256}
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
            className="gm-slider w-full"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={fetchCompare}
            disabled={state === "loading"}
            className="w-full rounded-gm-sm bg-accent px-gm-4 py-gm-1.5 text-gm-sm
                       font-medium text-white hover:opacity-90 transition-opacity
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state === "loading" ? (
              <span className="flex items-center justify-center gap-gm-1">
                <RiLoader4Line className="w-4 h-4 animate-spin" />
                对比中…
              </span>
            ) : (
              "运行对比"
            )}
          </button>
        </div>
      </div>

      <div className="mb-gm-4">
        <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
          用户输入（可选，用于 token 估算）
        </label>
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="输入一段文本模拟用户消息…"
          rows={2}
          className="w-full rounded-gm-xs border border-border bg-surface-alt
                     px-gm-2 py-gm-1.5 text-gm-sm text-text
                     placeholder:text-text-muted/50
                     focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30
                     resize-none"
        />
      </div>

      <DataState
        state={state}
        error={error}
        onRetry={fetchCompare}
        loadingMessage="加载策略对比…"
        loadingIconClassName="text-accent"
        emptyIcon={RiScalesLine}
        emptyMessage="调整参数后点击「运行对比」查看三种策略效果"
        isEmpty={
          state === "idle"
        }
      >
      {/* Success: 三列卡片 */}
      {state === "success" && data && (
        <div className="border-t border-border pt-gm-4">
          {/* 推荐叙事 */}
          {(() => {
            const narrative = getRecommendationNarrative(data, personaMap);
            return narrative ? (
              <p className="text-gm-sm text-text-secondary italic mb-gm-4 pb-gm-3 border-b border-border/50">
                💡 {narrative}
              </p>
            ) : null;
          })()}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gm-3">
            {(
              ["truncate", "prioritize", "summarize"] as const
            ).map((key) => {
              const result = data[key];
              const persona = personaMap.get(key);
              const colors = PERSONA_COLOR_MAP[key] || {
                border: "border-border",
                bg: "bg-surface-alt",
              };

              // 判断最优策略：使用率最低（浪费最少）为最优
              const allResults = [
                data.truncate,
                data.prioritize,
                data.summarize,
              ];
              const minWasted = Math.min(
                ...allResults.map((r) => r.wasted_tokens),
              );
              const isBest = result.wasted_tokens === minWasted;

              return (
                <div
                  key={key}
                  className={`rounded-gm-sm border-2 ${colors.border} ${colors.bg} p-gm-4 ${
                    isBest ? "ring-1 ring-success/40" : ""
                  }`}
                >
                  {/* 人格头部 */}
                  {persona && (
                    <div className="mb-gm-3">
                      <div className="flex items-center gap-gm-1.5">
                        <span
                          className="text-gm-sm font-semibold"
                          style={{ color: persona.color }}
                        >
                          {persona.name}
                        </span>
                        {isBest && (
                          <span className="inline-flex items-center rounded-full bg-success/15 text-success text-gm-xs font-medium px-gm-1.5 py-px">
                            <RiCheckLine className="w-3 h-3 mr-gm-0_5" />
                            推荐
                          </span>
                        )}
                      </div>
                      <p className="text-gm-xs text-text-muted mt-gm-0.5">
                        {persona.subtitle}
                      </p>
                    </div>
                  )}

                  {/* 核心指标 */}
                  <div className="space-y-gm-2 mb-gm-3">
                    <div className="flex justify-between text-gm-xs">
                      <span className="text-text-muted">保留记忆</span>
                      <span className="text-text font-medium tabular-nums">
                        {result.memories_before} → {result.memories_after}
                      </span>
                    </div>
                    <div className="flex justify-between text-gm-xs">
                      <span className="text-text-muted">使用率</span>
                      <span className="text-text font-medium tabular-nums">
                        {result.usage_pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-gm-xs">
                      <span className="text-text-muted">浪费 token</span>
                      <span
                        className={`font-medium tabular-nums ${result.wasted_tokens > 0 ? "text-warning" : "text-success"}`}
                      >
                        {result.wasted_tokens}
                      </span>
                    </div>
                    <div className="flex justify-between text-gm-xs">
                      <span className="text-text-muted">溢出</span>
                      <span>
                        {result.overflow_triggered ? (
                          <RiCloseLine className="w-4 h-4 text-danger inline" />
                        ) : (
                          <RiCheckLine className="w-4 h-4 text-success inline" />
                        )}
                      </span>
                    </div>
                  </div>

                  {/* 人格描述 */}
                  {persona && (
                    <p
                      className="text-gm-xs text-text-muted/70 leading-relaxed border-t pt-gm-2"
                      style={{ borderColor: "var(--gm-border-light)" }}
                    >
                      {persona.description}
                    </p>
                  )}

                  {/* 摘要行 */}
                  <p className="text-gm-xs text-text-muted/60 mt-gm-2 italic">
                    {result.summary_line}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Idle */}
      {state === "idle" && (
        <div className="flex flex-col items-center justify-center gap-gm-2 py-gm-8 text-text-muted/60">
          <RiScalesLine className="w-8 h-8" />
          <p className="text-gm-xs">
            调整参数后点击「运行对比」查看三种策略效果
          </p>
        </div>
      )}
      </DataState>
    </section>
  );
}

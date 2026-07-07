"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RiTestTubeLine,
  RiLoader4Line,
  RiArrowRightLine,
  RiArrowLeftLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import ErrorDisplay from "@/components/ui/ErrorDisplay";
import type {
  ExperimentPreset,
  ExperimentPresetsResponse,
  ExperimentRunResponse,
  ExperimentResultSchema,
  ExperimentDiffSchema,
  FetchState,
} from "@/lib/api/types";
import { fmtMs } from "@/lib/formatTime";

type RunState = "idle" | "running" | "done" | "error";

/** 格式化 token 数。 */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 方向标签映射。 */
const DIRECTION_LABELS: Record<string, { text: string; cls: string }> = {
  a_better: { text: "A 更优", cls: "text-info" },
  b_better: { text: "B 更优", cls: "text-accent" },
  neutral: { text: "持平", cls: "text-text-muted" },
};

/** 维度中文标签映射。 */
const DIMENSION_LABELS: Record<string, string> = {
  recall_count: "召回数量",
  recall_overlap: "召回重叠度",
  chat_token_usage: "聊天 Token",
  fact_token_usage: "事实抽取 Token",
  fact_count: "事实抽取数",
  response_length: "回复长度",
};

export default function ExperimentComparePanel() {
  // 预设加载状态
  const [presetState, setPresetState] = useState<FetchState>("idle");
  const [presets, setPresets] = useState<ExperimentPresetsResponse | null>(null);
  const [presetError, setPresetError] = useState<Error | string | null>(null);

  // 用户输入
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [runResult, setRunResult] = useState<ExperimentRunResponse | null>(null);
  const [runError, setRunError] = useState<Error | string | null>(null);

  // 结果中展开的回复文本
  const [expandedA, setExpandedA] = useState(false);
  const [expandedB, setExpandedB] = useState(false);

  const fetchPresets = useCallback(async () => {
    setPresetState("loading");
    setPresetError(null);
    try {
      const result = await api.getExperimentPresets();
      setPresets(result);
      setPresetState("success");
    } catch (err) {
      setPresetError(err instanceof Error ? err : new Error("加载实验预设失败"));
      setPresetState("error");
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchPresets(), 0);
    return () => clearTimeout(id);
  }, [fetchPresets]);

  const handleRun = useCallback(async () => {
    if (!userInput.trim() || !selectedPreset) return;
    setRunState("running");
    setRunError(null);
    setRunResult(null);
    setExpandedA(false);
    setExpandedB(false);
    try {
      const result = await api.runExperiment({
        user_input: userInput.trim(),
        preset_id: selectedPreset,
      });
      setRunResult(result);
      setRunState("done");
    } catch (err) {
      setRunError(err instanceof Error ? err : new Error("实验运行失败"));
      setRunState("error");
    }
  }, [userInput, selectedPreset]);

  const isRunning = runState === "running";
  const canRun = userInput.trim().length > 0 && selectedPreset !== null && !isRunning;

  /** 渲染单侧结果卡片。 */
  const renderResultCard = (
    result: ExperimentResultSchema,
    label: string,
    expanded: boolean,
    setExpanded: (v: boolean) => void,
  ) => (
    <div className="rounded-gm-sm border border-border bg-surface p-gm-4">
      <h4 className="text-gm-sm font-semibold text-text mb-gm-3">
        {label}：{result.label}
      </h4>
      <dl className="space-y-gm-2 text-gm-xs">
        <div className="flex justify-between">
          <dt className="text-text-muted">召回数量</dt>
          <dd className="text-text-secondary tabular-nums">{result.recalled_count} 条</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-muted">聊天 Token</dt>
          <dd className="text-text-secondary tabular-nums">
            {fmtTokens(result.chat_total_tokens)}
            <span className="text-text-muted/60 ml-gm-1">
              (P:{fmtTokens(result.chat_prompt_tokens)} C:{fmtTokens(result.chat_completion_tokens)})
            </span>
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-muted">事实抽取 Token</dt>
          <dd className="text-text-secondary tabular-nums">
            {fmtTokens(result.fact_total_tokens)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-muted">抽取事实数</dt>
          <dd className="text-text-secondary tabular-nums">{result.facts_extracted} 条</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-muted">回复长度</dt>
          <dd className="text-text-secondary tabular-nums">{result.response_length} 字符</dd>
        </div>
      </dl>
      {/* 回复文本（可折叠） */}
      <div className="mt-gm-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gm-xs text-brand hover:underline"
        >
          {expanded ? "收起回复" : "展开回复"}
        </button>
        {expanded && (
          <div className="mt-gm-2 p-gm-3 rounded-gm-xs bg-surface-alt text-gm-xs text-text-secondary max-h-48 overflow-y-auto whitespace-pre-wrap">
            {result.response_text}
          </div>
        )}
      </div>
      {/* 事实列表 */}
      {result.fact_contents.length > 0 && (
        <div className="mt-gm-3">
          <p className="text-gm-xs text-text-muted mb-gm-1">
            抽取事实 ({result.fact_contents.length})
          </p>
          <ul className="space-y-gm-1">
            {result.fact_contents.map((fact, i) => (
              <li
                key={i}
                className="text-gm-xs text-text-secondary pl-gm-3 border-l-2 border-border"
              >
                {fact}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  /** 渲染单个差异行。 */
  const renderDiffRow = (diff: ExperimentDiffSchema) => {
    const dirInfo = DIRECTION_LABELS[diff.direction] || DIRECTION_LABELS.neutral;
    const dimLabel = DIMENSION_LABELS[diff.dimension] || diff.dimension;

    return (
      <tr key={diff.dimension} className="border-b border-border last:border-0">
        <td className="py-gm-2 text-gm-xs text-text-secondary">{dimLabel}</td>
        <td className="py-gm-2 text-gm-xs text-text-secondary tabular-nums text-right">
          {String(diff.value_a ?? "—")}
        </td>
        <td className="py-gm-2 text-gm-xs text-text-secondary tabular-nums text-right">
          {String(diff.value_b ?? "—")}
        </td>
        <td className="py-gm-2 text-gm-xs tabular-nums text-right">
          <span className={dirInfo.cls}>{diff.delta}</span>
        </td>
        <td className="py-gm-2 text-gm-xs text-center">
          <span
            className={`inline-flex items-center gap-gm-0.5 px-gm-1.5 py-gm-0.5 rounded-gm-xs text-gm-xs ${
              diff.direction === "a_better"
                ? "bg-info/10 text-info"
                : diff.direction === "b_better"
                  ? "bg-accent/10 text-accent"
                  : "bg-surface-alt text-text-muted"
            }`}
          >
            {diff.direction === "a_better" && <RiArrowLeftLine className="w-3 h-3" />}
            {diff.direction === "b_better" && <RiArrowRightLine className="w-3 h-3" />}
            {dirInfo.text}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiTestTubeLine className="w-5 h-5 text-warning shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">A/B 实验对比</h3>
        <span className="text-gm-xs text-text-muted">
          同一输入，两套参数，量化差异
        </span>
        {presetState === "success" && (
          <RefreshButton onClick={fetchPresets} className="ml-auto" />
        )}
      </div>

      {/* Preset state: loading / error / success */}
      <DataState
        state={presetState}
        error={presetError}
        onRetry={fetchPresets}
        loadingMessage="加载实验预设…"
        loadingIconClassName="text-warning"
      >
        {/* Preset selection + controls */}
        {presets && (
        <div className="border-t border-border pt-gm-4" data-testid="presets-loaded">
          {/* Preset grid */}
          <p className="text-gm-xs text-text-muted mb-gm-2">
            选择实验预设（对比两组参数对同一输入的影响）
          </p>
          <div className="grid grid-cols-2 gap-gm-2 mb-gm-4">
            {presets.presets.map((preset: ExperimentPreset) => {
              const isSelected = selectedPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => setSelectedPreset(preset.id)}
                  data-testid={`preset-${preset.id}`}
                  aria-pressed={isSelected}
                  className={`text-left rounded-gm-sm border p-gm-3 transition-all ${
                    isSelected
                      ? "border-warning bg-warning/5 ring-1 ring-warning/30"
                      : "border-border bg-surface hover:border-warning/40"
                  }`}
                >
                  <div className="text-gm-xs font-semibold text-text">
                    {preset.label_a}{" "}
                    <span className="text-text-muted mx-gm-1">vs</span>{" "}
                    {preset.label_b}
                  </div>
                  <div className="text-gm-xs text-text-muted mt-gm-1">
                    {preset.description}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Input + Run */}
          <div className="space-y-gm-3">
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="输入测试文本，例如：什么是记忆衰减？"
              rows={3}
              disabled={isRunning}
              className="w-full rounded-gm-xs border border-border bg-surface-alt px-gm-2 py-gm-1.5 text-gm-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-warning focus:ring-1 focus:ring-warning/30 resize-none disabled:opacity-50"
            />
            <button
              onClick={handleRun}
              disabled={!canRun}
              data-testid="experiment-run-btn"
              className="w-full rounded-gm-sm bg-warning px-gm-4 py-gm-1.5 text-gm-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <span className="inline-flex items-center gap-gm-2">
                  <RiLoader4Line className="w-4 h-4 animate-spin" />
                  实验运行中（可能需数十秒）…
                </span>
              ) : (
                "运行实验"
              )}
            </button>
          </div>

          {/* Run error */}
          {runState === "error" && (
            <ErrorDisplay variant="inline" error={runError} />
          )}

          {/* Results */}
          {runState === "done" && runResult && (
            <div className="mt-gm-4 space-y-gm-4" data-testid="experiment-results">
              {/* 耗时 */}
              <p className="text-gm-xs text-text-muted">
                实验完成，耗时{" "}
                <span className="text-text-secondary tabular-nums">
                  {fmtMs(runResult.elapsed_ms)}
                </span>
              </p>

              {/* 双列结果卡片 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-gm-3">
                {renderResultCard(runResult.result_a, "A 组", expandedA, setExpandedA)}
                {renderResultCard(runResult.result_b, "B 组", expandedB, setExpandedB)}
              </div>

              {/* 差异表 */}
              {runResult.diffs.length > 0 && (
                <div className="rounded-gm-sm border border-border bg-surface p-gm-4">
                  <h4 className="text-gm-sm font-semibold text-text mb-gm-3">
                    维度差异对比
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-gm-xs">
                      <thead>
                        <tr className="border-b border-border-strong text-text-muted">
                          <th className="text-left py-gm-1 font-medium">维度</th>
                          <th className="text-right py-gm-1 font-medium w-16">A 组</th>
                          <th className="text-right py-gm-1 font-medium w-16">B 组</th>
                          <th className="text-right py-gm-1 font-medium w-16">差异</th>
                          <th className="text-center py-gm-1 font-medium w-20">结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runResult.diffs.map((diff) => renderDiffRow(diff))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </DataState>
    </section>
  );
}

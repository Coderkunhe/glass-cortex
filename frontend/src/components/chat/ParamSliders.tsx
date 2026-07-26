"use client";

import { RiBrainLine, RiLayoutMasonryLine, RiCpuLine, RiLineChartLine } from "@remixicon/react";
import type { L2RecallParams, L3ContextParams, L5InferenceParams, L6DecayParams, OverflowStrategy } from "@/lib/chatParams";
import { L5_MODEL_OPTIONS, L5_MODEL_LABELS } from "@/lib/chatParams";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

// ── Types ────────────────────────────────────────────────────────────────

export interface ParamSlidersProps {
  l2: L2RecallParams;
  l3: L3ContextParams;
  l5: L5InferenceParams;
  l6: L6DecayParams;
  onL2Change: (patch: Partial<L2RecallParams>) => void;
  onL3Change: (patch: Partial<L3ContextParams>) => void;
  onL5Change: (patch: Partial<L5InferenceParams>) => void;
  onL6Change: (patch: Partial<L6DecayParams>) => void;
  onTriggerDecay?: () => void;
}

// ── Slider sub-component ─────────────────────────────────────────────────

interface SliderConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  hint?: string;
  /** 显示值格式化 */
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function SliderControl({
  label,
  min,
  max,
  step,
  value,
  hint,
  format,
  onChange,
}: SliderConfig) {
  const display = format ? format(value) : String(value);
  // 计算填充百分比用于渐变轨道
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="mb-gm-2_5 last:mb-0">
      <div className="flex items-center justify-between mb-gm-1">
        <label className="text-gm-xs font-medium text-text-secondary">
          {label}
        </label>
        <span className="text-gm-xs font-mono text-text-muted tabular-nums">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="gm-slider w-full"
        style={{
          background: `linear-gradient(90deg, var(--gm-brand, #6366f1) 0%, var(--gm-brand, #6366f1) ${pct}%, var(--gm-border-strong, #94a3b8) ${pct}%, var(--gm-border-strong, #94a3b8) 100%)`,
        }}
      />
      {hint && (
        <p className="text-gm-xs text-text-muted mt-gm-0_5 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

// ── Select sub-component ─────────────────────────────────────────────────

interface SelectConfig<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  labels?: Record<T, string>;
  hint?: string;
  onChange: (v: T) => void;
}

function SelectControl<T extends string>({
  label,
  value,
  options,
  labels,
  hint,
  onChange,
}: SelectConfig<T>) {
  return (
    <div>
      <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="gm-select w-full rounded-gm-xs border border-border bg-surface-elevated
                   px-gm-2 py-gm-1_5 text-gm-sm text-text
                   focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30
                   appearance-none"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labels?.[opt] ?? opt}
          </option>
        ))}
      </select>
      {hint && (
        <p className="text-gm-xs text-text-muted mt-gm-0_5 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

// ── Overflow strategy labels ─────────────────────────────────────────────

const OVERFLOW_LABELS: Record<OverflowStrategy, string> = {
  truncate: "truncate — FIFO 截断旧记忆",
  prioritize: "prioritize — 按得分保留",
  summarize: "summarize — 压缩旧记忆为摘要",
};

// ── ForgettingCurveSVG ─────────────────────────────────────────────────

/** Pure SVG forgetting curve — exp(-λ·t) for t=0..30 days.
 *  Replaces the Streamlit Plotly chart with zero external dependencies. */
function ForgettingCurveSVG({ lambda }: { lambda: number }) {
  const W = 200;
  const H = 100;
  const pad = { t: 6, r: 8, b: 18, l: 8 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const steps = 60;

  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 30;
    const s = Math.exp(-lambda * t);
    const x = pad.l + (t / 30) * pw;
    const y = pad.t + (1 - s) * ph;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const d = `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(" ")} L${(pad.l + pw).toFixed(1)},${(pad.t + ph).toFixed(1)} L${pad.l},${(pad.t + ph).toFixed(1)} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full mt-gm-2"
      role="img"
      aria-label={`遗忘曲线，λ=${lambda.toFixed(2)}`}
    >
      {/* axes */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + ph} stroke="var(--gm-border)" strokeWidth="0.5" />
      <line x1={pad.l} y1={pad.t + ph} x2={pad.l + pw} y2={pad.t + ph} stroke="var(--gm-border)" strokeWidth="0.5" />
      {/* curve + area fill */}
      <path d={d} fill="var(--gm-success-glow)" stroke="var(--gm-success)" strokeWidth="1.5" opacity="0.8" />
      {/* x-axis label */}
      <text x={pad.l + pw / 2} y={H - 3} textAnchor="middle" fill="var(--gm-text-muted)" fontSize="7">Days</text>
    </svg>
  );
}

// ── ParamSliders ─────────────────────────────────────────────────────────

/** 认知参数面板 — L2 记忆召回 + L3 上下文窗口 + L5 模型推理 + L6 遗忘曲线 折叠块。
 *
 *  在 Sidebar 中使用，通过 on*Change 写入 ChatParamsContext。
 *  L2/L6 参数当前仅 UI 展示，L3/L5 参数即时生效经 useChat 送达后端。 */
export default function ParamSliders({
  l2,
  l3,
  l5,
  l6,
  onL2Change,
  onL3Change,
  onL5Change,
  onL6Change,
  onTriggerDecay,
}: ParamSlidersProps) {
  return (
    <>
      {/* L2 记忆召回 */}
      <CollapsibleSection className="mb-gm-2 last:mb-0" icon={<RiBrainLine />} title="L2 记忆召回">
        <SliderControl
          label="召回数量 (top_k)"
          min={1}
          max={15}
          step={1}
          value={l2.top_k}
          hint="每条消息召回多少条相关记忆注入提示词"
          onChange={(v) => onL2Change({ top_k: v })}
        />
        <SliderControl
          label="召回阈值"
          min={0}
          max={1}
          step={0.05}
          value={l2.recall_threshold}
          format={(v) => v.toFixed(2)}
          hint="强度/置信度低于此阈值的记忆被过滤"
          onChange={(v) => onL2Change({ recall_threshold: v })}
        />
        <SliderControl
          label="截断阈值"
          min={0}
          max={0.5}
          step={0.01}
          value={l2.truncation_threshold}
          format={(v) => v.toFixed(2)}
          hint="综合得分低于此阈值的记忆不注入上下文。0=禁用截断"
          onChange={(v) => onL2Change({ truncation_threshold: v })}
        />
        <SliderControl
          label="压缩阈值 (tokens)"
          min={0}
          max={4096}
          step={100}
          value={l2.compress_threshold}
          hint="召回记忆超过此 token 数时压缩。0=禁用压缩"
          onChange={(v) => onL2Change({ compress_threshold: v })}
        />
      </CollapsibleSection>

      {/* L3 上下文窗口 */}
      <CollapsibleSection icon={<RiLayoutMasonryLine />} title="L3 上下文窗口">
        <SliderControl
          label="窗口大小 (tokens)"
          min={512}
          max={8192}
          step={256}
          value={l3.window_size}
          format={(v) => v.toLocaleString()}
          hint="系统提示词的最大 token 数"
          onChange={(v) => onL3Change({ window_size: v })}
        />
        <SelectControl
          label="溢出策略"
          value={l3.overflow_strategy}
          options={["truncate", "prioritize", "summarize"] as const}
          labels={OVERFLOW_LABELS}
          hint="truncate=FIFO截断 | prioritize=按得分保留 | summarize=压缩旧记忆"
          onChange={(v) => onL3Change({ overflow_strategy: v })}
        />
      </CollapsibleSection>

      {/* L5 模型推理 */}
      <CollapsibleSection icon={<RiCpuLine />} title="L5 模型推理">
        <SelectControl
          label="模型"
          value={l5.model}
          options={L5_MODEL_OPTIONS}
          labels={L5_MODEL_LABELS}
          hint="deepseek-v4-flash=日常对话 | deepseek-v4-pro=复杂推理"
          onChange={(v) => onL5Change({ model: v })}
        />
        <SliderControl
          label="Temperature"
          min={0}
          max={2}
          step={0.1}
          value={l5.temperature}
          format={(v) => v.toFixed(1)}
          hint="越高创造性越强，越低越确定"
          onChange={(v) => onL5Change({ temperature: v })}
        />
        <SliderControl
          label="Max Tokens"
          min={256}
          max={4096}
          step={128}
          value={l5.max_tokens}
          format={(v) => v.toLocaleString()}
          hint="单次回复最大 token 数"
          onChange={(v) => onL5Change({ max_tokens: v })}
        />
      </CollapsibleSection>

      {/* L6 遗忘曲线 */}
      <CollapsibleSection icon={<RiLineChartLine />} title="L6 遗忘曲线">
        <SliderControl
          label="衰减速率 λ"
          min={0.01}
          max={1}
          step={0.01}
          value={l6.lambda}
          format={(v) => v.toFixed(2)}
          hint="λ 越高记忆遗忘越快"
          onChange={(v) => onL6Change({ lambda: v })}
        />
        <ForgettingCurveSVG lambda={l6.lambda} />
        <p className="text-gm-xs text-text-muted mt-gm-1 text-center tabular-nums">
          λ={l6.lambda.toFixed(2)}：30 天后强度降至 {(Math.exp(-l6.lambda * 30) * 100).toFixed(0)}%
        </p>
        {onTriggerDecay && (
          <button
            type="button"
            onClick={onTriggerDecay}
            className="w-full mt-gm-2 rounded-gm-xs bg-warning/10 border border-warning/30
                       px-gm-3 py-gm-1_5 text-gm-sm text-warning font-medium
                       hover:bg-warning/20 active:scale-[0.98] cursor-pointer
                       focus-visible:ring-2 focus-visible:ring-warning/50 focus-visible:outline-none
                       transition-colors"
          >
            触发衰减
          </button>
        )}
      </CollapsibleSection>
    </>
  );
}

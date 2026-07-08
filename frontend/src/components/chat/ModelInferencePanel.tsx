"use client";

import { useState, useRef } from "react";
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCpuLine,
} from "@remixicon/react";
import { KVRow } from "@/components/ui/KVRow";
import { CopyButton } from "@/components/ui/CopyButton";
import { useCodeHighlight } from "@/hooks/useCodeHighlight";
import type { ApiTrace } from "@/lib/api/types";
import type { TokenBreakdown } from "./TokenCostBadge";
import { getExtra } from "@/lib/getExtra";

interface ModelInferencePanelProps {
  apiTrace: ApiTrace;
}

/**
 * 模型推理面板 (L5) — 展示实际 API 调用详情。
 *
 * 两层信息架构：
 * - Tier 1（始终可见）：模型型号 + 响应延迟 + Token 三卡片 + 成本估算
 * - Tier 2（可折叠）：temperature / max_tokens / caller KV 行 +
 *   raw_response / parsed_result 代码块（仅在存在时显示）
 */
export default function ModelInferencePanel({ apiTrace }: ModelInferencePanelProps) {
  const [open, setOpen] = useState(false);
  const codeContainerRef = useRef<HTMLDivElement>(null);

  const totalTokens = apiTrace.prompt_tokens + apiTrace.completion_tokens;

  // 从 api_trace.token_breakdown 读取后端注入的定价（复用 TokenCostBadge 类型）
  const breakdown = getExtra(apiTrace, "token_breakdown") as TokenBreakdown | undefined;
  const pricing = breakdown?.pricing;
  const hasPricing = pricing != null && (pricing.input_per_1m > 0 || pricing.output_per_1m > 0);
  const estCost = hasPricing && pricing
    ? (apiTrace.prompt_tokens * pricing.input_per_1m +
        apiTrace.completion_tokens * pricing.output_per_1m) /
      1_000_000
    : null;

  const tps = apiTrace.elapsed_ms > 0
    ? Math.round(totalTokens / (apiTrace.elapsed_ms / 1000))
    : null;

  const rawResponse = getExtra(apiTrace, "raw_response") as string | undefined;
  const parsedResult = getExtra(apiTrace, "parsed_result");
  const parsedStr = parsedResult != null
    ? (typeof parsedResult === "string" ? parsedResult : JSON.stringify(parsedResult, null, 2))
    : null;

  // ── Prism 语法高亮 (R18) ──
  useCodeHighlight(codeContainerRef, [rawResponse, parsedStr]);

  return (
    <div role="region" aria-label="模型推理面板" className="rounded-gm-md bg-surface-elevated border border-border px-gm-4 py-gm-3">
      {/* ── Tier 1: 摘要行（始终可见）── */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="model-inference-detail"
        className="flex items-center gap-gm-2 w-full text-left
                   hover:text-text transition-colors cursor-pointer active:scale-[0.98]
                   focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs"
      >
        <span className="shrink-0">
          {open ? (
            <RiArrowDownSLine className="text-gm-icon" />
          ) : (
            <RiArrowRightSLine className="text-gm-icon" />
          )}
        </span>
        <RiCpuLine className="text-gm-icon text-brand shrink-0" />
        <span className="text-gm-sm text-text-secondary font-medium">
          L5 模型推理
        </span>
        {/* 模型型号 badge */}
        <span className="text-gm-xs font-mono px-gm-2 py-gm-0_5 rounded-gm-xs
                         bg-brand/10 text-brand font-medium">
          {apiTrace.model}
        </span>
        <span className="text-gm-xs text-text-muted">
          {apiTrace.elapsed_ms}ms
        </span>
        <span className="text-gm-xs text-text-muted">
          {totalTokens.toLocaleString()} tokens
        </span>
      </button>

      {/* ── Token 三卡片 + 成本（始终可见）── */}
      <div className="mt-gm-2 grid grid-cols-4 gap-gm-2">
        <TokenStatCard label="Prompt" value={apiTrace.prompt_tokens.toLocaleString()} />
        <TokenStatCard label="Completion" value={apiTrace.completion_tokens.toLocaleString()} />
        <TokenStatCard label="Total" value={totalTokens.toLocaleString()} />
        <div className="flex flex-col items-center justify-center rounded-gm-xs px-gm-2 py-gm-1_5 bg-bg-subtle">
          <span className="text-gm-xs font-mono font-bold text-brand">
            {estCost != null ? `¥${estCost.toFixed(4)}` : "—"}
          </span>
          <span className="text-gm-xs mt-px text-text-muted">
            估算成本
          </span>
        </div>
      </div>

      {/* TPS 小字 */}
      {tps != null && (
        <p className="text-gm-xs mt-gm-1 text-text-muted">
          {tps.toLocaleString()} tok/s
        </p>
      )}

      {/* ── Tier 2: 详情（可折叠）── */}
      {open && (
        <div id="model-inference-detail" ref={codeContainerRef} className="mt-gm-3 pt-gm-3 border-t border-border space-y-gm-1">
          <KVRow label="Temperature" value={apiTrace.temperature.toFixed(1)} />
          <KVRow label="Max Tokens" value={apiTrace.max_tokens.toLocaleString()} />
          <KVRow label="Caller" value={apiTrace.caller || "—"} />

          {/* 可选 raw_response 代码块 */}
          {rawResponse && (
            <div className="mt-gm-3">
              <div className="flex items-center justify-between mb-gm-1">
                <span className="text-gm-xs font-medium text-text-muted">
                  Raw Response
                </span>
                <CopyButton text={rawResponse} />
              </div>
              <pre
                className="text-gm-xs leading-relaxed p-gm-3 rounded-gm-md
                           max-h-60 overflow-y-auto bg-bg-subtle text-text-secondary
                           border border-border whitespace-pre-wrap break-words"
              >
                <code className="language-json">{rawResponse}</code>
              </pre>
            </div>
          )}

          {/* 可选 parsed_result JSON 块 */}
          {parsedStr && (
            <div className="mt-gm-3">
              <span className="text-gm-xs font-medium text-text-muted">
                Parsed Result
              </span>
              <pre
                className="text-gm-xs leading-relaxed p-gm-3 rounded-gm-md
                           mt-gm-1 max-h-60 overflow-y-auto bg-bg-subtle text-text-secondary
                           border border-border whitespace-pre-wrap break-words"
              >
                <code className="language-json">{parsedStr}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

/** Token 统计卡片 — 标签在上，粗体数字在下 */
function TokenStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col items-center rounded-gm-xs px-gm-2 py-gm-1_5 bg-bg-subtle"
    >
      <span
        className="text-gm-xs font-mono font-bold text-text"
      >
        {value}
      </span>
      <span
        className="text-gm-xs mt-px uppercase tracking-wide text-text-muted"
      >
        {label}
      </span>
    </div>
  );
}


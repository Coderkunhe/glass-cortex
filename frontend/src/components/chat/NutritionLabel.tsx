"use client";

import type { ContextMeta } from "@/lib/api/types";

interface NutritionLabelProps {
  meta: ContextMeta;
}

/** 用量比颜色 */
function pctColor(pct: number): string {
  if (pct < 50) return "var(--gm-success)";
  if (pct < 80) return "var(--gm-warning)";
  return "var(--gm-danger)";
}

/** FDA 营养标签风格 — 上下文窗口结构化指标卡片。
 *
 * 紧凑展示窗口的"营养成分"：各区 token 分配 + 占比 + 策略信息。
 * 宽约 280px，作为 ContextBar 旁的信息卡片。
 */
export default function NutritionLabel({ meta }: NutritionLabelProps) {
  const { window_size, base_tokens, memories_token_after, memories_token_before, user_message_tokens, strategy, overflow_applied, usage_pct } = meta;
  const toolsTokens = (meta as Record<string, unknown>).tools_tokens as number | undefined;
  const used = base_tokens + memories_token_after + user_message_tokens + (toolsTokens ?? 0);
  const free = Math.max(0, window_size - used);

  const strategyLabel: Record<string, string> = {
    truncate: "FIFO 截断",
    prioritize: "按相关度优先",
    summarize: "压缩摘要",
  };

  return (
    <div
      role="region"
      aria-label="上下文成分标签"
      className="rounded-gm-sm border-2 border-text/10 bg-surface-elevated
                 px-gm-3 py-gm-2 text-gm-xs font-mono leading-relaxed"
    >
      {/* 标题 — 类似 FDA "Nutrition Facts" */}
      <p className="text-gm-sm font-extrabold tracking-tight text-text border-b-2 border-text/20 pb-gm-1 mb-gm-1_5">
        上下文成分
      </p>

      {/* Serving Size */}
      <p className="text-text-muted mb-gm-0_5">
        窗口容量{" "}
        <span className="font-bold text-text">{window_size.toLocaleString()} tokens</span>
      </p>

      {/* 分隔线 */}
      <div className="border-t-4 border-text/20 my-gm-1" />

      {/* Amount Per Serving */}
      <p className="text-text-muted mb-gm-1">
        <span className="font-bold text-text">每窗口含量</span>
      </p>

      <div className="space-y-gm-0_5">
        <Row label="System" value={base_tokens} pct={window_size > 0 ? (base_tokens / window_size) * 100 : 0} />
        <Row
          label="Recall"
          value={memories_token_after}
          pct={window_size > 0 ? (memories_token_after / window_size) * 100 : 0}
          note={
            memories_token_before > memories_token_after
              ? `压缩前 ${memories_token_before.toLocaleString()}`
              : undefined
          }
        />
        <Row label="消息" value={user_message_tokens} pct={window_size > 0 ? (user_message_tokens / window_size) * 100 : 0} />
        {toolsTokens != null && toolsTokens > 0 && (
          <Row label="Tools" value={toolsTokens} pct={window_size > 0 ? (toolsTokens / window_size) * 100 : 0} />
        )}
        <Row label="空闲" value={free} pct={window_size > 0 ? (free / window_size) * 100 : 0} muted />
      </div>

      {/* 分隔线 */}
      <div className="border-t-4 border-text/20 my-gm-1" />

      {/* 用量比 */}
      <p className="flex justify-between">
        <span className="text-text-muted">窗口使用率</span>
        <span className="font-bold" style={{ color: pctColor(usage_pct) }}>
          {usage_pct.toFixed(1)}%
        </span>
      </p>

      {/* 脚注 */}
      <div className="border-t border-text/10 mt-gm-1 pt-gm-1 text-text-muted leading-snug">
        <p>
          * 策略: {strategyLabel[strategy] ?? strategy}
          {overflow_applied && " · 已触发溢出"}
        </p>
        {meta.memories_token_before > meta.memories_token_after && (
          <p className="text-success">
            压缩节省 {meta.memories_token_before - meta.memories_token_after} tokens
          </p>
        )}
      </div>
    </div>
  );
}

/** 单行营养素 */
function Row({
  label,
  value,
  pct,
  note,
  muted,
}: {
  label: string;
  value: number;
  pct: number;
  note?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={muted ? "text-text-muted" : "text-text-secondary"}>
        {label} {pct.toFixed(0)}%
      </span>
      <span className={`font-bold ${muted ? "text-text-muted" : "text-text"}`}>
        {value.toLocaleString()}
      </span>
      {note && <span className="text-text-muted text-[10px] block w-full">{note}</span>}
    </div>
  );
}

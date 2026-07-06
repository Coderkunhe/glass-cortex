"use client";

import type { ContextMeta } from "@/lib/api/types";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

interface ContextWindowPanelProps {
  meta: ContextMeta;
}

/** 单行分区数据 */
interface ZoneRow {
  label: string;
  tokens: number;
  pct: number;
  color: string;
  desc: string;
}

/** 从 ContextMeta 推导分区明细行 */
function deriveZones(meta: ContextMeta): ZoneRow[] {
  const { window_size, base_tokens, memories_token_after, user_message_tokens } = meta;
  const toolsTokens = (meta as Record<string, unknown>).tools_tokens as number | undefined;
  const used = base_tokens + memories_token_after + user_message_tokens + (toolsTokens ?? 0);
  const free = Math.max(0, window_size - used);

  const zones: ZoneRow[] = [
    {
      label: "System",
      tokens: base_tokens,
      pct: window_size > 0 ? (base_tokens / window_size) * 100 : 0,
      color: "var(--gm-slate-500)",
      desc: "系统提示词、安全指令、工具定义",
    },
    {
      label: "Recall",
      tokens: memories_token_after,
      pct: window_size > 0 ? (memories_token_after / window_size) * 100 : 0,
      color: "var(--gm-brand)",
      desc: "召回记忆注入（相似度 × 强度 × 重要性排序）",
    },
    {
      label: "消息",
      tokens: user_message_tokens,
      pct: window_size > 0 ? (user_message_tokens / window_size) * 100 : 0,
      color: "var(--gm-emerald-500)",
      desc: "本次用户消息 + 对话历史",
    },
  ];

  if (toolsTokens) {
    zones.push({
      label: "Tools",
      tokens: toolsTokens,
      pct: window_size > 0 ? (toolsTokens / window_size) * 100 : 0,
      color: "var(--gm-amber-500)",
      desc: "工具调用定义与结果",
    });
  }

  zones.push({
    label: "空闲",
    tokens: free,
    pct: window_size > 0 ? (free / window_size) * 100 : 0,
    color: "transparent",
    desc: "可用空间",
  });

  return zones;
}

/** 上下文窗口详细面板 — token 分区明细表 + 溢出信息。
 *
 * 从 ContextMeta 推导各分区 token 占比，
 * 以表格形式展示每区的数值、百分比、内容说明。
 * 默认折叠状态。
 */
export default function ContextWindowPanel({ meta }: ContextWindowPanelProps) {
  const zones = deriveZones(meta);
  const compressed =
    meta.memories_token_before > 0 &&
    meta.memories_token_before > meta.memories_token_after;
  const saved = meta.memories_token_before - meta.memories_token_after;

  return (
    <CollapsibleSection
      variant="bordered"
      title={
        <span className="flex items-center w-full">
          <span className="flex-1">📐 上下文窗口明细</span>
          <span className="text-gm-xs text-text-muted font-normal">
            {meta.total_estimated_tokens.toLocaleString()}/{meta.window_size.toLocaleString()} tokens
          </span>
        </span>
      }
    >
      <table className="w-full text-gm-xs">
        <thead>
          <tr className="text-text-muted border-b border-border/50">
            <th className="text-left py-gm-1 font-medium">分区</th>
            <th className="text-right py-gm-1 font-medium">Tokens</th>
            <th className="text-right py-gm-1 font-medium">占比</th>
            <th className="text-left py-gm-1 font-medium hidden sm:table-cell">内容</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.label} className="border-b border-border/30 last:border-0">
              <td className="py-gm-1_5 flex items-center gap-gm-1_5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: z.color,
                    border: z.label === "空闲" ? "1px solid var(--gm-border-light)" : "none",
                  }}
                />
                <span className="font-medium text-text">{z.label}</span>
              </td>
              <td className="py-gm-1_5 text-right font-mono text-text">
                {z.tokens.toLocaleString()}
              </td>
              <td className="py-gm-1_5 text-right font-mono text-text-muted">
                {z.pct.toFixed(1)}%
              </td>
              <td className="py-gm-1_5 text-text-muted hidden sm:table-cell">
                {z.desc}
              </td>
            </tr>
          ))}
          {/* 总计行 */}
          <tr className="font-semibold">
            <td className="py-gm-1_5 text-text">总计</td>
            <td className="py-gm-1_5 text-right font-mono text-text">
              {meta.total_estimated_tokens.toLocaleString()}
            </td>
            <td className="py-gm-1_5 text-right font-mono text-text">
              {meta.usage_pct.toFixed(1)}%
            </td>
            <td className="py-gm-1_5 hidden sm:table-cell" />
          </tr>
        </tbody>
      </table>

      {/* 压缩信息 */}
      {compressed && (
        <div className="mt-gm-2 rounded-gm-xs bg-success/10 border border-success/20 px-gm-3 py-gm-2">
          <p className="text-gm-xs text-success font-medium">
            📦 消息压缩节省 {saved.toLocaleString()} tokens
          </p>
          <p className="text-gm-xs text-text-muted mt-gm-0_5">
            召回记忆从 {meta.memories_token_before.toLocaleString()} →{" "}
            {meta.memories_token_after.toLocaleString()} tokens
            （{meta.memories_before} → {meta.memories_after} 条）
          </p>
        </div>
      )}

      {/* 溢出信息 */}
      {meta.overflow_applied && (
        <div className="mt-gm-2 rounded-gm-xs bg-warning/10 border border-warning/20 px-gm-3 py-gm-2">
          <p className="text-gm-xs text-warning font-medium">
            ⚠️ 上下文溢出 — 丢弃 {meta.dropped_count} 条低相关度记忆
          </p>
          {meta.dropped_items.length > 0 && (
            <ul className="mt-gm-1 text-gm-xs text-text-muted list-disc list-inside max-h-24 overflow-y-auto">
              {meta.dropped_items.map((item, i) => (
                <li key={i} className="truncate">
                  {typeof item.content === "string"
                    ? item.content.slice(0, 80) + (item.content.length > 80 ? "…" : "")
                    : JSON.stringify(item).slice(0, 80)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

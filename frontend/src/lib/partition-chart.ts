/**
 * 上下文窗口分区图表生成器。
 *
 * 从 ContextMeta 实时推导各分区（system/recall/用户消息/空闲）的
 * token 数和占比，生成 mermaid flowchart LR 图表字符串。
 *
 * @module lib/partition-chart
 */

import type { ContextMeta } from "@/lib/api/types";

/**
 * 从 ContextMeta 构建上下文窗口分区 mermaid 流程图。
 *
 * @param meta - 上下文元数据（含各分区 token 数）
 * @returns mermaid flowchart LR 字符串，含四区（system/recall/用户消息/空闲）及流向箭头
 */
export function buildPartitionChart(meta: ContextMeta): string {
  const windowSize = meta.window_size;
  const free = Math.max(0, windowSize - meta.total_estimated_tokens);
  const pct = (v: number) => (windowSize > 0 ? ((v / windowSize) * 100).toFixed(1) : "0");
  const lines = [
    "flowchart LR",
    `  subgraph W["上下文窗口 ${windowSize.toLocaleString()} tokens"]`,
    `    S["system<br/>${meta.base_tokens.toLocaleString()} (${pct(meta.base_tokens)}%)"]`,
    `    R["recall<br/>${meta.memories_token_after.toLocaleString()} (${pct(meta.memories_token_after)}%)"]`,
    `    U["用户消息<br/>${meta.user_message_tokens.toLocaleString()} (${pct(meta.user_message_tokens)}%)"]`,
    ...(free > 0 ? [`    F["空闲<br/>${free.toLocaleString()} (${pct(free)}%)"]`] : []),
    "  end",
    "  S --> R --> U",
    ...(free > 0 ? ["  U --> F"] : []),
  ];
  return lines.join("\n");
}

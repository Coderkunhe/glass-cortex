/**
 * 置信度阈值与颜色档位共享模块。
 *
 * TagCloud（ProfileShell 内联）和 TagDetailDrawer 使用相同的
 * 置信度分级逻辑（>0.7 success / >0.4 warning / ≤0.4 muted），
 * 但渲染样式不同（纯文本色 vs badge 含 bg+border）。
 * 提取分级决策为共享函数，消除阈值常量重复。
 *
 * @module lib/confidence
 */

/** 高置信度阈值 — 超过此值视为 "high" 档位 */
export const CONFIDENCE_HIGH = 0.7;

/** 中置信度阈值 — 超过此值视为 "medium" 档位，否则为 "low" */
export const CONFIDENCE_MEDIUM = 0.4;

/** 置信度档位 */
export type ConfidenceTier = "high" | "medium" | "low";

/** 将置信度数值映射到三档位。 */
export function getConfidenceTier(c: number): ConfidenceTier {
  if (c > CONFIDENCE_HIGH) return "high";
  if (c > CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

/**
 * formatCost — Token 消耗金额格式化。
 *
 * 从 TokenCostBadge.tsx 提取，供 SessionTokenGauge 等跨组件消费。
 * 对标 B115 `lib/formatNum.ts` fmtTokens 的 DRY 先例——共享格式化函数
 * 不应以组件文件为家。
 *
 * @module lib/formatCost
 */

/**
 * 格式化金额字符串。
 *
 * 策略：
 * - cost = 0 → "¥0"
 * - cost < 0.001 → "≈¥0.0003"（4 位小数，确保极小值可见）
 * - cost < 0.01 → "≈¥0.002"（3 位小数）
 * - cost ≥ 0.01 → "≈¥0.05"（2 位小数）
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "¥0";
  if (cost < 0.001) return `≈¥${cost.toFixed(4)}`;
  if (cost < 0.01) return `≈¥${cost.toFixed(3)}`;
  return `≈¥${cost.toFixed(2)}`;
}

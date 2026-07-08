/**
 * 数字格式化工具。
 *
 * 集中管理各面板中重复的 fmtNum 定义，
 * 消除 TokenDashboardPanel、CacheStatsPanel、TokenMetricsCard 三文件中的重复。
 *
 * @module lib/formatNum
 */

/** 格式化为千分位字符串（en-US locale） */
export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 格式化 token 数为紧凑显示。
 *
 * 阈值策略（与 SessionTokenGauge 原实现对齐）：
 * - < 1k：原值（如 250 → "250"）
 * - 1k–10k：1 位小数 k（如 1500 → "1.5k"）
 * - ≥ 10k：整数 k（如 15000 → "15k"，避免 "15.0k" 冗余小数）
 */
export function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  const k = n / 1000;
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}

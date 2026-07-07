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

/**
 * clampWindow — 上下文窗口大小约束。
 *
 * 从 WindowSizeInput.tsx 提取，供 Lab 各面板复用窗口边界常量。
 * 对标 B115 `lib/formatNum.ts` fmtTokens 的 DRY 先例——组件内工具函数
 * 应归位 lib。
 *
 * @module lib/clampWindow
 */

/** 上下文窗口最小值（token）。 */
export const MIN_WINDOW = 128;

/** 上下文窗口最大值（token）。 */
export const MAX_WINDOW = 8192;

/** 将值 clamp 到 [MIN_WINDOW, MAX_WINDOW]。 */
export function clampWindow(raw: number): number {
  return Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, raw));
}

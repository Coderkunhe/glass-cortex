/**
 * getExtra — 安全读取 trace 对象的 extra field。
 *
 * 两个消费者（ModelInferencePanel / ProcessDrawer）的 trace 类型不同
 * （ApiTrace vs drawer trace），但底层都是 index-signature 对象。
 * 泛型 `<T>` 统一走 `unknown` 中间 cast，消除类型差异。
 *
 * @module lib/getExtra
 */

/** 安全读取 trace 的 extra field，key 不存在时返回 undefined。 */
export function getExtra<T>(trace: T, key: string): unknown {
  return (trace as unknown as Record<string, unknown>)[key];
}

/** 读取 extra field 并运行时校验为 string，非 string 或不存在时返回 ""。 */
export function getExtraString<T>(trace: T, key: string): string {
  const v = getExtra(trace, key);
  return typeof v === "string" ? v : "";
}

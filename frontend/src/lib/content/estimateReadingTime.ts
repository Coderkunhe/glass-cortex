/**
 * 阅读时间估算工具。
 *
 * 同时支持中文和英文内容：中文按 ~250 字/分钟，英文按 ~200 词/分钟估算。
 * 混合内容分别计算后求和，返回整数分钟数（最少 1 分钟）。
 *
 * @module lib/content/estimateReadingTime
 */

/**
 * 估算阅读正文所需的分钟数。
 *
 * @param text - 要估算的正文（L0+L1+L2+L3 拼接后的全量文本）
 * @returns 整数分钟数，最少 1 分钟
 */
export function estimateReadingTime(text: string): number {
  if (!text) return 1;

  // 中文汉字（CJK 统一表意文字 + 扩展 A 区）
  const chineseChars = (text.match(/[一-鿿㐀-䶿]/g) || [])
    .length;

  // 英文单词（去除中文后按单词边界计数）
  const englishWords = (
    text.replace(/[一-鿿㐀-䶿]/g, " ").match(/\b\w+\b/g) || []
  ).length;

  const minutes = Math.max(
    1,
    Math.round(chineseChars / 250 + englishWords / 200),
  );
  return minutes;
}

/**
 * 将阅读时间格式化为可读文案。
 *
 * @param minutes - 阅读时间（分钟）
 * @returns 格式化文案，如 "约 3 分钟"、"约 1 小时 15 分钟"
 */
export function formatReadingTime(minutes: number): string {
  if (minutes <= 1) return "约 1 分钟";
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain > 0
    ? `约 ${hours} 小时 ${remain} 分钟`
    : `约 ${hours} 小时`;
}

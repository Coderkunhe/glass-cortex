/** 阿拉伯数字 → 中文数字转换（1-99），用于章节序号渲染。 */
export function toChineseNumeral(n: number): string {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const tens = ["", "十", "二十", "三十", "四十", "五十", "六十", "七十", "八十", "九十"];
  if (n < 1 || n > 99 || !Number.isInteger(n)) return String(n);
  if (n <= 9) return digits[n];
  const t = Math.floor(n / 10);
  const d = n % 10;
  return tens[t] + digits[d];
}

/** 将章节标题中的阿拉伯数字替换为中文数字： "第 1 章：标题" → "第一章：标题"。 */
export function formatChapterTitle(title: string): string {
  return title.replace(/第 (\d+) 章/, (_, n) => `第${toChineseNumeral(Number(n))}章`);
}

/**
 * 内容类型检测工具。
 *
 * 从 Markdown 原文检测折叠区包含的内容类型（代码块/流程图/表格），
 * 用于在折叠标题旁显示内容类型徽章，让用户在不展开的情况下了解内容。
 *
 * B137: L2 折叠区代码块不可见 → 折叠标题加内容类型徽章。
 */

/** 匹配非 mermaid 围栏代码块 — ```language ... ``` */
const CODE_FENCE_RE = /```(?!mermaid)\w*\n[\s\S]*?```/g;

/** 匹配 mermaid 围栏代码块 — ```mermaid ... ``` */
const MERMAID_FENCE_RE = /```mermaid\n[\s\S]*?```/g;

/** 匹配 Markdown 表格行 — 至少含两个 | 分隔符的行 */
const TABLE_ROW_RE = /^\|.*\|.*\|/m;

/** 内容类型 → 中文徽章标签映射 */
const TYPE_LABELS: Record<ContentType, string> = {
  code: "代码示例",
  mermaid: "流程图",
  table: "表格",
};

/** 可检测的内容类型 */
export type ContentType = "code" | "mermaid" | "table";

/**
 * 从 Markdown 字符串中检测内容类型。
 * 返回去重后的类型数组，保持 code → mermaid → table 的固定顺序。
 * 未检测到任何已知类型时返回空数组。
 */
export function detectContentTypes(md: string): ContentType[] {
  if (!md || md.trim().length === 0) return [];

  const types: ContentType[] = [];

  // 重置全局正则 lastIndex
  CODE_FENCE_RE.lastIndex = 0;
  MERMAID_FENCE_RE.lastIndex = 0;

  if (CODE_FENCE_RE.test(md)) {
    types.push("code");
  }

  if (MERMAID_FENCE_RE.test(md)) {
    types.push("mermaid");
  }

  if (TABLE_ROW_RE.test(md)) {
    types.push("table");
  }

  return types;
}

/**
 * 返回内容类型对应的中文标签文本。
 */
export function getContentTypeLabel(type: ContentType): string {
  return TYPE_LABELS[type];
}

/**
 * 批量获取内容类型标签。
 * 快捷方法 — 等价于 detectContentTypes(md).map(getContentTypeLabel)。
 */
export function getContentTypeBadges(md: string): string[] {
  return detectContentTypes(md).map(getContentTypeLabel);
}

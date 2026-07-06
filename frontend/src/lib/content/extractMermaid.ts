/**
 * Mermaid 图表提取工具。
 *
 * 从 Answer 对象或 Markdown 字符串中提取 mermaid 代码块。
 * 复用 AnswerCard renderMarkdown 的正则模式，保持提取逻辑一致。
 */

import type { Answer } from "./types";

/** 匹配 ```mermaid ... ``` 围栏代码块，与 AnswerCard renderMarkdown 正则一致 */
const MERMAID_RE = /```mermaid\n([\s\S]*?)```/g;

/**
 * 从 Markdown 字符串中提取第一个 mermaid 代码块内容。
 * 未找到时返回 null。
 */
export function extractMermaidFromString(md: string): string | null {
  const match = MERMAID_RE.exec(md);
  MERMAID_RE.lastIndex = 0; // reset global regex state
  return match ? match[1].trim() : null;
}

/**
 * 从 Answer 对象的 l1 字段提取第一个 mermaid 代码块。
 * l1 为空或无 mermaid 块时返回 null。
 */
export function extractMermaidFromAnswer(answer: Answer): string | null {
  if (!answer.l1) return null;
  return extractMermaidFromString(answer.l1);
}

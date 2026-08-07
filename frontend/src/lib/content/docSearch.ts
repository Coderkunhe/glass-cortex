/**
 * 文档搜索工具 — Fuse.js 包装。
 *
 * 对 DocListItem 数组建立模糊搜索索引，搜索 name 和 summary 字段。
 * 供 Admin 面板 SearchModal（Cmd+K 全局搜索）和 DocsPanel（内联搜索）共用。
 *
 * 使用方式：
 * ```ts
 * const flat = flattenDocs(allDocs);
 * const index = createDocSearchIndex(flat);
 * const results = index.search("架构");
 * // results[0].item → DocListItem 对象
 * // results[0].matches → 匹配详情
 * ```
 *
 * @module lib/content/docSearch
 */

import Fuse, { type FuseResult } from "fuse.js";
import type { DocListItem } from "@/lib/api/types";

/** Fuse.js 对 DocListItem 的搜索结果类型别名 */
export type DocSearchResult = FuseResult<DocListItem>;

/**
 * 扁平化文档列表 — 递归展开目录 children，过滤掉目录项。
 *
 * 用于建立 Fuse 索引前预处理：SearchModal 搜索的是文档而非目录。
 */
export function flattenDocs(items: DocListItem[]): DocListItem[] {
  const result: DocListItem[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      result.push(...flattenDocs(item.children));
    }
    if (!item.is_directory) {
      result.push(item);
    }
  }
  return result;
}

/**
 * 为 DocListItem 数组创建 Fuse.js 模糊搜索索引。
 *
 * 搜索字段：name（权重 0.6）+ summary（权重 0.4）。
 * 排除 is_directory 目录项（调用方应先 flattenDocs 预处理）。
 * threshold: 0.4 — 文档标题短，比 Answer 搜索稍严格以减少噪音。
 */
export function createDocSearchIndex(
  docs: DocListItem[],
): Fuse<DocListItem> {
  return new Fuse(docs, {
    keys: [
      { name: "name", weight: 0.6 },
      { name: "summary", weight: 0.4 },
    ],
    /** 匹配阈值：0.4 允许中文简繁/英文拼写细微差异 */
    threshold: 0.4,
    /** 返回匹配位置信息 */
    includeMatches: true,
    /** 返回匹配分数用于排序 */
    includeScore: true,
    /** 最少匹配字符数，中文场景 1 字符即可 */
    minMatchCharLength: 1,
    /** 按匹配度排序 */
    shouldSort: true,
    /** 模糊匹配搜索半径 */
    distance: 100,
  });
}

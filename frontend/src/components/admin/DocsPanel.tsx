"use client";

/**
 * DocsPanel — 文档清单面板。
 *
 * 展示文档目录树，按分组折叠排列。点击文件项触发 onSelectDoc 回调进入 DocViewer。
 * 从 AdminShell 拆出为独立组件。
 *
 * @module components/admin/DocsPanel
 */

import { useState, useEffect, useMemo } from "react";
import {
  RiLockLine,
  RiArrowRightLine,
  RiCalendarLine,
  RiArticleLine,
  RiFileListLine,
  RiBookOpenLine,
  RiDashboardLine,
  RiBookReadLine,
  RiFileLine,
  RiSearchLine,
  RiCloseLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import { fmtBytes, fmtDate } from "./utils";
import { createDocSearchIndex, flattenDocs } from "@/lib/content/docSearch";
import type { DocListItem } from "@/lib/api/types";
import type { AdminTab } from "./AdminSidebar";

// ── 常量 ──────────────────────────────────────────────────────────────

/** 文档分组排序权重（数字越小越靠前） */
const GROUP_ORDER: Record<string, number> = {
  "核心文档": 0,
  "经验库": 1,
  "治理看板": 2,
  "参考手册": 3,
  "日报": 4,
  "需求日志": 5,
  "其他": 99,
};

// ── 摘要卡片配置（日报/需求日志 → 跳转专用视图） ──────────────────

interface SummaryCardConfig {
  groupKey: string;
  icon: React.ReactNode;
  title: string;
  targetTab: AdminTab;
  buttonLabel: string;
  statLabel: (dir: DocListItem) => string;
}

const SUMMARY_CARD_CONFIGS: Record<string, SummaryCardConfig> = {
  "日报": {
    groupKey: "日报",
    icon: <RiCalendarLine size={20} />,
    title: "工作日报",
    targetTab: "daily",
    buttonLabel: "查看日历",
    statLabel: (dir) => {
      const files = dir.children ?? [];
      if (files.length === 0) return "暂无日报";
      const latest = files[0].name.slice(0, 10);
      const first = files[files.length - 1].name.slice(0, 10);
      return `共 ${dir.count} 篇 · ${first} → ${latest}`;
    },
  },
  "需求日志": {
    groupKey: "需求日志",
    icon: <RiArticleLine size={20} />,
    title: "需求日志",
    targetTab: "requirements-log",
    buttonLabel: "查看全部",
    statLabel: (dir) => {
      const count = dir.count ?? 0;
      return `当前活跃 · 历史归档 ${count} 个文件`;
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════
// DocsPanel — 主组件
// ═══════════════════════════════════════════════════════════════════════

export default function DocsPanel({
  onSelectDoc,
  onNavigate,
  filterGroup,
  docs,
}: {
  onSelectDoc: (item: DocListItem) => void;
  /** 点击摘要卡片时导航到专用 tab */
  onNavigate: (tab: AdminTab) => void;
  /** 可选：只展示指定分组（如 "日报" 或 ["核心文档", "需求日志"]） */
  filterGroup?: string | string[];
  /** 可选：预取文档列表（AdminShell 传入，避免重复 fetch） */
  docs?: DocListItem[];
}) {
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 外部传入 docs 时直接使用（AdminShell 预取优化），无需内部 fetch
  const externalItems = useMemo(() => {
    if (!docs) return null;
    if (!filterGroup) return docs;
    const groups = Array.isArray(filterGroup) ? filterGroup : [filterGroup];
    return docs.filter((item: DocListItem) =>
      groups.includes(item.group) ||
      (item.is_directory && item.children?.some((c: DocListItem) => groups.includes(c.group))),
    );
  }, [docs, filterGroup]);

  const isExternal = externalItems !== null;

  useEffect(() => {
    if (isExternal) return; // 外部传入 docs 时跳过内部 fetch

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await api.getDocs();
        if (!cancelled) {
          // filterGroup 模式下过滤到只保留目标分组（含 group 匹配的目录 + 文件）
          const filtered = filterGroup
            ? json.filter((item: DocListItem) => {
                const groups = Array.isArray(filterGroup) ? filterGroup : [filterGroup];
                return groups.includes(item.group) ||
                  (item.is_directory && item.children?.some((c: DocListItem) => groups.includes(c.group)));
              })
            : json;
          setItems(filtered);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [filterGroup, docs, isExternal]);

  // ── 统一数据源：外部传入优先，否则用内部 fetch ──
  const allItems = externalItems ?? items;

  // ── 按 group 分组排序 ──
  const grouped = useMemo(() => {
    const map = new Map<string, { items: DocListItem[]; dirs: DocListItem[] }>();
    for (const item of allItems) {
      if (!map.has(item.group)) {
        map.set(item.group, { items: [], dirs: [] });
      }
      const entry = map.get(item.group)!;
      if (item.is_directory) {
        entry.dirs.push(item);
      } else {
        entry.items.push(item);
      }
    }
    // 按 GROUP_ORDER 排序
    const sorted = Array.from(map.entries()).sort(
      (a, b) => (GROUP_ORDER[a[0]] ?? 99) - (GROUP_ORDER[b[0]] ?? 99)
    );
    return sorted;
  }, [allItems]);

  // ── 文档搜索 ──
  const [searchQuery, setSearchQuery] = useState("");

  /** Fuse 索引：仅对非目录项建索引 */
  const fuseIndex = useMemo(() => {
    const flat = flattenDocs(allItems);
    if (flat.length === 0) return null;
    return createDocSearchIndex(flat);
  }, [allItems]);

  /** 搜索结果过滤后的分组数据 */
  const filteredGrouped = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || !fuseIndex) return grouped;

    const fuseResults = fuseIndex.search(trimmed);
    const matchedPaths = new Set(fuseResults.map((r) => r.item.path));

    // 过滤分组：只保留含匹配项的分组，组内只保留匹配项
    return grouped
      .map(([group, { items: groupItems, dirs: groupDirs }]) => {
        const matchedItems = groupItems.filter((i) => matchedPaths.has(i.path));
        const matchedDirs = groupDirs.filter((d) => matchedPaths.has(d.path));
        return [group, { items: matchedItems, dirs: matchedDirs }] as const;
      })
      .filter(([, { items: gi, dirs: gd }]) => gi.length > 0 || gd.length > 0);
  }, [grouped, searchQuery, fuseIndex]);

  // 外部数据源：跳过 loading/error 状态（AdminShell 预取）
  if (!isExternal && loading) {
    return (
      <div className="space-y-gm-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-gm-lg bg-surface-elevated border border-border p-gm-5">
            <div className="w-24 h-3 rounded-gm-sm gm-skeleton-shimmer mb-gm-3" />
            <div className="space-y-gm-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="w-full h-6 rounded-gm-sm gm-skeleton-shimmer" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!isExternal && error) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">文档清单加载失败</p>
        <p className="text-gm-xs text-red-500 mt-gm-1">{error}</p>
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">暂无文档</p>
      </div>
    );
  }

  return (
    <div className="space-y-gm-4">
      {/* 内联搜索 — 紧凑模式，右上角 */}
      <div className="flex justify-end">
        <div
          className="flex items-center gap-gm-2 rounded-gm-md border border-border/60
                      bg-surface-lowered/50 px-gm-3 py-gm-1.5
                      focus-within:border-primary/30 focus-within:bg-surface-elevated
                      transition-colors"
        >
          <RiSearchLine size={14} className="text-text-muted shrink-0" />
          <input
            type="text"
            className="w-40 bg-transparent text-gm-sm text-text
                       placeholder:text-text-muted/50 outline-none"
            placeholder="过滤文档..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="docs-search-input"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="p-gm-0.5 rounded-gm-sm text-text-muted
                         hover:text-text hover:bg-surface-lowered transition-colors"
              aria-label="清除搜索"
            >
              <RiCloseLine size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 搜索结果为空 */}
      {searchQuery.trim() && filteredGrouped.length === 0 ? (
        <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
          <RiSearchLine className="text-gm-2xl text-text-muted mx-auto mb-gm-2" />
          <p className="text-gm-sm text-text-muted">未找到匹配的文档</p>
          <p className="text-gm-xs text-text-muted/60 mt-gm-1">试试其他关键词</p>
        </div>
      ) : (
        filteredGrouped.map(([group, { items: groupItems, dirs }]) => (
        <DocGroup key={group} group={group} items={groupItems} dirs={dirs} onSelectDoc={onSelectDoc} onNavigate={onNavigate} />
      ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DocGroup — 文档分组（可折叠区域）
// ═══════════════════════════════════════════════════════════════════════

function DocGroup({
  group,
  items,
  dirs,
  onSelectDoc,
  onNavigate,
}: {
  group: string;
  items: DocListItem[];
  dirs: DocListItem[];
  onSelectDoc: (item: DocListItem) => void;
  onNavigate: (tab: AdminTab) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // 日报 / 需求日志 → 摘要卡片（不展开文件列表）
  const isSummaryGroup = group in SUMMARY_CARD_CONFIGS;

  return (
    <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-gm-5 py-gm-3 hover:bg-surface-alt/30 transition-colors text-left"
      >
        <div className="flex items-center gap-gm-2">
          <span className={`text-gm-xs transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
          <h3 className="text-gm-sm font-semibold text-text">{group}</h3>
          <span className="text-gm-xs text-text-muted">
            {items.length + dirs.length} 个文件
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* 摘要卡片（日报/需求日志 → 跳转专用视图） */}
          {isSummaryGroup && dirs.map((dir) => (
            <SummaryCard
              key={dir.path}
              dir={dir}
              config={SUMMARY_CARD_CONFIGS[group]!}
              onNavigate={onNavigate}
            />
          ))}

          {/* 普通目录项（非摘要分组）— 保持紧凑行 */}
          {!isSummaryGroup && dirs.map((dir) => (
            <DocDirRow key={dir.path} dir={dir} onSelectDoc={onSelectDoc} />
          ))}

          {/* 文件卡片网格 */}
          {items.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-gm-3 p-gm-4">
              {items.map((item) => (
                <DocFileCard key={item.path} item={item} onClick={() => onSelectDoc(item)} />
              ))}
            </div>
          )}

          {items.length === 0 && dirs.length === 0 && (
            <div className="px-gm-5 py-gm-3 text-center text-gm-xs text-text-muted">
              此分组下暂无文档
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DocDirRow — 目录行（展开显示子文档列表）
// ═══════════════════════════════════════════════════════════════════════

function DocDirRow({
  dir,
  onSelectDoc,
}: {
  dir: DocListItem;
  onSelectDoc: (item: DocListItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-gm-3 px-gm-5 py-gm-2.5 hover:bg-surface-alt/30 transition-colors text-left"
      >
        <span className={`text-gm-xs text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
        <RiLockLine className="text-gm-icon text-text-muted" />
        <span className="text-gm-sm text-text font-medium">{dir.name}</span>
        <span className="text-gm-xs text-text-muted">{dir.count ?? 0} 个文件</span>
      </button>

      {expanded && dir.children && (
        <div className="border-t border-border bg-surface-lowered/30 divide-y divide-border">
          {dir.children.map((child) => (
            <button
              key={child.path}
              onClick={() => onSelectDoc(child)}
              className="w-full flex items-center gap-gm-3 pl-gm-12 pr-gm-5 py-gm-2 hover:bg-surface-alt/30 transition-colors text-left"
            >
              <span className="text-gm-sm text-text truncate flex-1">{child.name}</span>
              {child.summary && (
                <span className="text-gm-xs text-text-muted/60 truncate max-w-[14rem] hidden lg:inline" title={child.summary}>
                  {child.summary}
                </span>
              )}
              <span className="text-gm-xs text-text-muted shrink-0 tabular-nums">{child.lines} 行</span>
              <span className="text-gm-xs text-text-muted/60 shrink-0 w-12 text-right tabular-nums">{fmtBytes(child.size_bytes)}</span>
              <span className="text-gm-xs text-text-muted/60 shrink-0 w-14 text-right">{fmtDate(child.mtime)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SummaryCard — 日报/需求日志摘要卡片（跳转专用视图）
// ═══════════════════════════════════════════════════════════════════════

function SummaryCard({
  dir,
  config,
  onNavigate,
}: {
  dir: DocListItem;
  config: SummaryCardConfig;
  onNavigate: (tab: AdminTab) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(config.targetTab)}
      className="w-full flex items-center gap-gm-4 px-gm-5 py-gm-4 hover:bg-surface-alt/30 transition-colors text-left group border-b border-border last:border-b-0"
    >
      {/* 图标 */}
      <span className="text-gm-2xl shrink-0 group-hover:scale-110 transition-transform" aria-hidden>
        {config.icon}
      </span>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <h4 className="text-gm-base font-semibold text-text group-hover:text-primary transition-colors">
          {config.title}
        </h4>
        <p className="text-gm-sm text-text-muted mt-gm-0.5">
          {config.statLabel(dir)}
        </p>
      </div>

      {/* 跳转按钮 */}
      <span className="shrink-0 flex items-center gap-gm-1.5 text-gm-sm font-medium text-primary bg-primary/8 rounded-gm-md px-gm-3 py-gm-1.5 group-hover:bg-primary group-hover:text-white transition-all">
        <span>{config.buttonLabel}</span>
        <RiArrowRightLine size={14} />
      </span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DocFileCard — 文档卡片（用于顶级文档分组）
// ═══════════════════════════════════════════════════════════════════════

/** 分组→图标映射 */
const GROUP_ICON: Record<string, React.ReactNode> = {
  "核心文档": <RiFileListLine size={18} />,
  "经验库": <RiBookOpenLine size={18} />,
  "治理看板": <RiDashboardLine size={18} />,
  "参考手册": <RiBookReadLine size={18} />,
  "其他": <RiFileLine size={18} />,
};

function DocFileCard({
  item,
  onClick,
}: {
  item: DocListItem;
  onClick: () => void;
}) {
  const icon = GROUP_ICON[item.group] ?? <RiFileLine size={18} />;
  const displayName = item.name.replace(/\.md$/, "");

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-gm-4 p-gm-6 rounded-gm-lg bg-surface-elevated border border-border
                 hover:border-primary/30 hover:shadow-gm-md hover:bg-surface-alt/20
                 transition-all text-left group"
    >
      {/* 标题行：图标 + 文档名 + 分组徽章 */}
      <div className="flex items-start gap-gm-3 min-w-0">
        <span className="text-gm-2xl shrink-0 leading-none mt-0.5" aria-hidden>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-gm-lg font-semibold text-text leading-snug group-hover:text-primary transition-colors">
            {displayName}
          </span>
        </div>
        <span className="text-gm-sm text-text-muted/60 bg-surface-lowered/60 rounded-gm-sm px-gm-2 py-0.5 shrink-0">
          {item.group}
        </span>
      </div>

      {/* 文档说明 */}
      {item.summary ? (
        <p className="text-gm-base text-text-secondary leading-relaxed pl-gm-10">
          {item.summary}
        </p>
      ) : (
        <p className="text-gm-base text-text-muted/40 italic pl-gm-10">暂无说明</p>
      )}

      {/* 元信息行 */}
      <div className="flex items-center gap-gm-3 text-gm-sm text-text-muted/60 pl-gm-10 mt-auto">
        <span className="tabular-nums">{item.lines} 行</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums text-success">{fmtBytes(item.size_bytes)}</span>
        <span aria-hidden>·</span>
        <span>{fmtDate(item.mtime)}</span>
      </div>
    </button>
  );
}

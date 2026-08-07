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
import { RiLockLine } from "@remixicon/react";
import { api } from "@/lib/api/client";
import { fmtBytes, fmtDate } from "./utils";
import type { DocListItem } from "@/lib/api/types";

// ── 常量 ──────────────────────────────────────────────────────────────

/** 文档分组排序权重（数字越小越靠前） */
const GROUP_ORDER: Record<string, number> = {
  "核心文档": 0,
  "经验库": 1,
  "治理看板": 2,
  "参考手册": 3,
  "日报": 4,
  "归档": 5,
  "其他": 99,
};

// ═══════════════════════════════════════════════════════════════════════
// DocsPanel — 主组件
// ═══════════════════════════════════════════════════════════════════════

export default function DocsPanel({ onSelectDoc }: { onSelectDoc: (item: DocListItem) => void }) {
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await api.getDocs();
        if (!cancelled) setItems(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── 按 group 分组排序 ──
  const grouped = useMemo(() => {
    const map = new Map<string, { items: DocListItem[]; dirs: DocListItem[] }>();
    for (const item of items) {
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
  }, [items]);

  if (loading) {
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

  if (error) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">文档清单加载失败</p>
        <p className="text-gm-xs text-red-500 mt-gm-1">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">暂无文档</p>
      </div>
    );
  }

  return (
    <div className="space-y-gm-4">
      {grouped.map(([group, { items: groupItems, dirs }]) => (
        <DocGroup key={group} group={group} items={groupItems} dirs={dirs} onSelectDoc={onSelectDoc} />
      ))}
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
}: {
  group: string;
  items: DocListItem[];
  dirs: DocListItem[];
  onSelectDoc: (item: DocListItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);

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
        <div className="divide-y divide-border border-t border-border">
          {/* 目录项（日报/归档等） */}
          {dirs.map((dir) => (
            <DocDirRow key={dir.path} dir={dir} onSelectDoc={onSelectDoc} />
          ))}

          {/* 文件项 */}
          {items.map((item) => (
            <DocFileRow key={item.path} item={item} onClick={() => onSelectDoc(item)} />
          ))}

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
        <div className="border-t border-border bg-surface-lowered/30">
          {dir.children.map((child) => (
            <DocFileRow
              key={child.path}
              item={child}
              onClick={() => onSelectDoc(child)}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DocFileRow — 文档文件行
// ═══════════════════════════════════════════════════════════════════════

function DocFileRow({
  item,
  onClick,
  indent = false,
}: {
  item: DocListItem;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-gm-3 px-gm-5 py-gm-2.5 hover:bg-surface-alt/30 transition-colors text-left ${
        indent ? "pl-gm-10" : ""
      }`}
    >
      <span className="text-gm-sm text-text truncate flex-1">{item.name}</span>
      <span className="text-gm-xs text-text-muted shrink-0">{item.lines} 行</span>
      <span className="text-gm-xs text-text-muted/60 shrink-0 w-12 text-right">{fmtBytes(item.size_bytes)}</span>
      <span className="text-gm-xs text-text-muted/60 shrink-0 w-14 text-right">{fmtDate(item.mtime)}</span>
    </button>
  );
}

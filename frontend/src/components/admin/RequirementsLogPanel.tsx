"use client";

/**
 * RequirementsLogPanel — 需求日志统一列表。
 *
 * 将当前需求日志（requirements-log.md）与归档目录下全部历史需求日志
 * 合并为一个统一列表，按 Phase 倒序呈现。点击任意条目进入 DocViewer。
 *
 * @module components/admin/RequirementsLogPanel
 */

import { useState, useEffect } from "react";
import { api } from "@/lib/api/client";
import { fmtBytes, fmtDate } from "./utils";
import type { DocListItem } from "@/lib/api/types";

// ── 常量 ──────────────────────────────────────────────────────────────

/** 当前需求日志路径 */
const CURRENT_LOG_PATH = "docs/requirements-log.md";

/** 从文件名提取起始 Phase 编号用于排序 */
function extractPhaseOrder(item: DocListItem): number {
  // 当前日志排最前
  if (item.path === CURRENT_LOG_PATH) return 9999;
  // roadmap 排最后
  if (item.name.includes("roadmap")) return -1;
  // requirements-log-phase-N-M.md → 取 N
  const m = item.name.match(/phase-(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

/** 从文件名生成 Phase 标签 */
function phaseLabel(item: DocListItem): string {
  if (item.path === CURRENT_LOG_PATH) return "Phase 66+";
  if (item.name.includes("roadmap")) return "路线图";
  const m = item.name.match(/phase-(\d+-\d+)/i);
  if (m) return `Phase ${m[1]}`;
  const s = item.name.match(/phase-(\d+)/i);
  if (s) return `Phase ${s[1]}`;
  return item.name.replace(/\.md$/, "");
}

/** 是否为当前活跃日志 */
function isCurrent(item: DocListItem): boolean {
  return item.path === CURRENT_LOG_PATH;
}

// ═══════════════════════════════════════════════════════════════════════
// RequirementsLogPanel — 主组件
// ═══════════════════════════════════════════════════════════════════════

export default function RequirementsLogPanel({
  onSelectDoc,
}: {
  onSelectDoc: (item: DocListItem) => void;
}) {
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const allDocs = await api.getDocs();
        if (cancelled) return;

        // 收集：当前日志 + 归档目录下全部子文件
        const result: DocListItem[] = [];

        for (const item of allDocs) {
          // 当前需求日志
          if (item.path === CURRENT_LOG_PATH && !item.is_directory) {
            result.push({ ...item, group: "需求日志" });
          }
          // 归档目录的子文件
          if (item.group === "归档" && item.is_directory && item.children) {
            for (const child of item.children) {
              result.push({ ...child, group: "需求日志" });
            }
          }
        }

        // 按 Phase 倒序
        result.sort((a, b) => extractPhaseOrder(b) - extractPhaseOrder(a));
        setItems(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── 骨架屏 ──
  if (loading) {
    return (
      <div className="space-y-gm-4">
        {/* 当前卡片骨架 */}
        <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-5">
          <div className="flex items-center gap-gm-4">
            <div className="w-10 h-10 rounded-gm-lg gm-skeleton-shimmer shrink-0" />
            <div className="flex-1 space-y-gm-2">
              <div className="w-48 h-5 rounded-gm-sm gm-skeleton-shimmer" />
              <div className="w-64 h-4 rounded-gm-sm gm-skeleton-shimmer" />
            </div>
          </div>
        </div>
        {/* 历史列表骨架 */}
        <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-gm-4 px-gm-5 py-gm-3">
                <div className="w-28 h-5 rounded-gm-sm gm-skeleton-shimmer shrink-0" />
                <div className="flex-1 h-4 rounded-gm-sm gm-skeleton-shimmer" />
                <div className="w-12 h-4 rounded-gm-sm gm-skeleton-shimmer shrink-0" />
                <div className="w-12 h-4 rounded-gm-sm gm-skeleton-shimmer shrink-0" />
                <div className="w-16 h-4 rounded-gm-sm gm-skeleton-shimmer shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── 错误态 ──
  if (error) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-6 text-center">
        <p className="text-gm-sm text-text-muted">加载失败：{error}</p>
      </div>
    );
  }

  // ── 空态 ──
  if (!items.length) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-6 text-center">
        <p className="text-gm-sm text-text-muted">暂无需求日志</p>
      </div>
    );
  }

  // ── 数据态：统一文件列表 ──
  const currentItem = items.find((i) => isCurrent(i));

  return (
    <div className="space-y-gm-4">
      {/* 当前活跃日志 — 突出卡片 */}
      {currentItem && (
        <button
          onClick={() => onSelectDoc(currentItem)}
          className="w-full text-left rounded-gm-lg bg-surface-elevated border-2 border-brand/30 hover:border-brand/60 hover:shadow-md hover:bg-surface-alt/40 transition-all duration-200 overflow-hidden group cursor-pointer"
        >
          <div className="flex items-center gap-gm-4 px-gm-5 py-gm-4">
            {/* 图标 */}
            <span className="shrink-0 text-gm-2xl group-hover:scale-110 transition-transform">
              📋
            </span>
            {/* 内容 */}
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-gm-2 mb-gm-1">
                <span className="text-gm-base font-semibold text-text">
                  {currentItem.name.replace(/\.md$/, "")}
                </span>
                <span className="shrink-0 text-gm-2xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-gm-1.5 py-px rounded-gm-xs border border-green-300 dark:border-green-700">
                  当前
                </span>
              </span>
              <span className="text-gm-xs text-text-muted">
                Phase 66+ · {currentItem.lines.toLocaleString()} 行 · {fmtBytes(currentItem.size_bytes)} · {fmtDate(currentItem.mtime)}
              </span>
            </span>
            {/* 箭头 */}
            <span className="shrink-0 text-gm-sm text-text-muted group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </button>
      )}

      {/* 历史归档列表 */}
      <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
        {/* 表头 */}
        <div className="flex items-center gap-gm-4 px-gm-5 py-gm-2.5 border-b border-border bg-surface-lowered/50 text-gm-xs text-text-muted font-medium">
          <span className="w-28 shrink-0">阶段</span>
          <span className="flex-1">文件</span>
          <span className="w-20 shrink-0 text-right">行数</span>
          <span className="w-16 shrink-0 text-right">大小</span>
          <span className="w-20 shrink-0 text-right">日期</span>
        </div>

        {/* 历史文件行 */}
        <div className="divide-y divide-border">
          {items.filter((i) => !isCurrent(i)).map((item) => (
            <button
              key={item.path}
              onClick={() => onSelectDoc(item)}
              className="w-full flex items-center gap-gm-4 px-gm-5 py-gm-3 hover:bg-surface-alt hover:shadow-sm transition-all duration-150 text-left cursor-pointer group"
            >
              <span className="w-28 shrink-0">
                <span className="inline-block text-gm-2xs font-mono text-text-muted bg-surface-lowered px-gm-1.5 py-px rounded-gm-xs border border-border group-hover:border-border-strong group-hover:text-text transition-colors">
                  {phaseLabel(item)}
                </span>
              </span>
              <span className="flex-1 min-w-0 text-gm-sm text-text group-hover:text-brand truncate transition-colors">{item.name}</span>
              <span className="w-20 shrink-0 text-right text-gm-xs text-text-muted group-hover:text-text tabular-nums transition-colors">
                {item.lines.toLocaleString()}
              </span>
              <span className="w-16 shrink-0 text-right text-gm-xs text-text-muted group-hover:text-text tabular-nums transition-colors">
                {fmtBytes(item.size_bytes)}
              </span>
              <span className="w-20 shrink-0 text-right text-gm-xs text-text-muted group-hover:text-text transition-colors">
                {fmtDate(item.mtime)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * SearchModal — Cmd+K / Ctrl+K 文档搜索模态窗。
 *
 * 居中搜索卡片 + backdrop 模糊遮罩。自动聚焦搜索框，支持键盘导航
 *  (↑↓ 移动 · Enter 选中 · Escape 关闭)。使用 Fuse.js 对文档名称
 *  和摘要做模糊搜索。
 *
 * @module components/admin/SearchModal
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { RiSearchLine } from "@remixicon/react";
import { createDocSearchIndex, type DocSearchResult } from "@/lib/content/docSearch";
import type { DocListItem } from "@/lib/api/types";

// ── 常量 ──────────────────────────────────────────────────────────────

/** 搜索无输入时展示的文档上限 */
const BROWSE_LIMIT = 20;
/** 有搜索词时的结果上限 */
const SEARCH_LIMIT = 10;

/** 分组排序权重 — 与 DocsPanel.GROUP_ORDER 保持同步 */
const GROUP_ORDER: Record<string, number> = {
  "核心文档": 0,
  "经验库": 1,
  "治理看板": 2,
  "参考手册": 3,
  "日报": 4,
  "需求日志": 5,
  "其他": 99,
};

// ── Props ─────────────────────────────────────────────────────────────

export interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 扁平化后的文档列表（非目录项） */
  docs: DocListItem[];
  /** 选中文档后回调 */
  onSelectDoc: (item: DocListItem) => void;
}

// ═══════════════════════════════════════════════════════════════════════
// SearchModal — 主组件
// ═══════════════════════════════════════════════════════════════════════

export default function SearchModal({
  isOpen,
  onClose,
  docs,
  onSelectDoc,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 构建 Fuse 索引（依赖 docs）
  const fuseIndex = useMemo(() => {
    if (docs.length === 0) return null;
    return createDocSearchIndex(docs);
  }, [docs]);

  // 搜索结果（空输入 → 浏览模式 top N，有输入 → Fuse 搜索）
  const results: { item: DocListItem; score?: number }[] = useMemo(() => {
    if (!fuseIndex) return [];
    const trimmed = query.trim();
    if (trimmed === "") {
      // 浏览模式：按分组权重排序展示 top BROWSE_LIMIT
      return [...docs]
        .sort(
          (a, b) =>
            (GROUP_ORDER[a.group] ?? 99) - (GROUP_ORDER[b.group] ?? 99),
        )
        .slice(0, BROWSE_LIMIT)
        .map((item) => ({ item }));
    }
    const fuseResults: DocSearchResult[] = fuseIndex.search(trimmed);
    return fuseResults.slice(0, SEARCH_LIMIT).map((r) => ({
      item: r.item,
      score: r.score,
    }));
  }, [fuseIndex, docs, query]);

  // 打开时重置状态 + 自动聚焦（模态窗打开时同步重置是标准模式）
  useEffect(() => {
    if (isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setQuery("");
      setSelectedIndex(0);
      /* eslint-enable react-hooks/set-state-in-effect */
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  // 全局键盘：Escape 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // 滚动选中项进入可视区域
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            onSelectDoc(results[selectedIndex].item);
            onClose();
          }
          break;
      }
    },
    [results, selectedIndex, onSelectDoc, onClose],
  );

  const handleSelect = useCallback(
    (item: DocListItem) => {
      onSelectDoc(item);
      onClose();
    },
    [onSelectDoc, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[15vh]"
      style={{ zIndex: "var(--gm-z-nav)" }}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
        onClick={onClose}
        data-testid="search-modal-backdrop"
      />

      {/* 卡片 */}
      <div
        className="relative z-10 w-full max-w-lg mx-gm-4
                   bg-surface border border-border rounded-gm-lg
                   shadow-gm-lg animate-gm-fade-in flex flex-col max-h-[70vh]"
        role="dialog"
        aria-modal="true"
        aria-label="搜索文档"
        onKeyDown={handleKeyDown}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-gm-3 px-gm-4 py-gm-3 border-b border-border">
          <RiSearchLine className="text-gm-icon text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-gm-base text-text
                       placeholder:text-text-muted/50 outline-none"
            placeholder="搜索文档名称或说明..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            data-testid="search-modal-input"
          />
          {/* 快捷键提示 */}
          <kbd className="shrink-0 text-gm-xs text-text-muted/40 bg-surface-lowered
                          rounded-gm-xs px-gm-1.5 py-0.5 font-mono">
            esc
          </kbd>
        </div>

        {/* 结果列表 */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto divide-y divide-border"
          data-testid="search-modal-results"
        >
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-gm-12 gap-gm-3 text-text-muted">
              <RiSearchLine className="text-gm-2xl" />
              <p className="text-gm-sm">
                {query.trim()
                  ? "未找到匹配的文档"
                  : "暂无文档"}
              </p>
              {query.trim() && (
                <p className="text-gm-xs text-text-muted/60">
                  试试其他关键词
                </p>
              )}
            </div>
          ) : (
            results.map(({ item }, idx) => {
              const displayName = item.name.replace(/\.md$/, "");
              return (
                <button
                  key={item.path}
                  onClick={() => handleSelect(item)}
                  className={`w-full flex items-start gap-gm-3 px-gm-4 py-gm-3 text-left
                              transition-colors hover:bg-surface-alt/30
                              ${idx === selectedIndex
                                ? "bg-primary/8 border-l-2 border-primary"
                                : "border-l-2 border-transparent"
                              }`}
                  data-testid={`search-result-${idx}`}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-gm-sm font-medium text-text block truncate">
                      {displayName}
                    </span>
                    {item.summary && (
                      <span className="text-gm-xs text-text-muted/70 line-clamp-1 mt-gm-0.5 block">
                        {item.summary}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-gm-2xs text-text-muted/50 bg-surface-lowered/60
                                   rounded-gm-xs px-gm-1.5 py-0.5 mt-0.5">
                    {item.group}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center gap-gm-4 px-gm-4 py-gm-2 border-t border-border
                        text-gm-xs text-text-muted/50">
          <span className="flex items-center gap-gm-1">
            <kbd className="bg-surface-lowered rounded-gm-xs px-gm-1 py-0.5 font-mono">↑↓</kbd>
            导航
          </span>
          <span className="flex items-center gap-gm-1">
            <kbd className="bg-surface-lowered rounded-gm-xs px-gm-1 py-0.5 font-mono">↵</kbd>
            打开
          </span>
          <span className="flex items-center gap-gm-1">
            <kbd className="bg-surface-lowered rounded-gm-xs px-gm-1 py-0.5 font-mono">Esc</kbd>
            关闭
          </span>
        </div>
      </div>
    </div>
  );
}

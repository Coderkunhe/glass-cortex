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
import { RiSearchLine, RiLoader4Line } from "@remixicon/react";
import { createDocSearchIndex, type DocSearchResult } from "@/lib/content/docSearch";
import type { DocListItem, DocSearchResult as ApiDocSearchResult } from "@/lib/api/types";
import { api } from "@/lib/api/client";

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

  // ── API 全文搜索 state ──
  const [apiResults, setApiResults] = useState<ApiDocSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // ── 搜索结果：空输入 → 浏览模式（Fuse top N），有输入 → API 优先 ──
  const fuseResults: { item: DocListItem; score?: number }[] = useMemo(() => {
    if (!fuseIndex) return [];
    const trimmed = query.trim();
    if (trimmed === "") {
      return [...docs]
        .sort(
          (a, b) =>
            (GROUP_ORDER[a.group] ?? 99) - (GROUP_ORDER[b.group] ?? 99),
        )
        .slice(0, BROWSE_LIMIT)
        .map((item) => ({ item }));
    }
    const fuseR: DocSearchResult[] = fuseIndex.search(trimmed);
    return fuseR.slice(0, SEARCH_LIMIT).map((r) => ({
      item: r.item,
      score: r.score,
    }));
  }, [fuseIndex, docs, query]);

  // 统一结果：空输入用 Fuse 浏览，有输入优先 API（加载中 fallback Fuse）
  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return { kind: "browse" as const, items: fuseResults };
    if (apiResults.length > 0) return { kind: "api" as const, items: apiResults };
    if (searching) return { kind: "searching" as const, items: fuseResults };
    return { kind: "fuse" as const, items: fuseResults };
  }, [query, fuseResults, apiResults, searching]);

  // ── 有输入时调 /api/admin/search（200ms debounce）──
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setApiResults([]);
       
      setSearching(false);
      return;
    }

     
    setSearching(true);
    const timer = setTimeout(() => {
      api.searchDocs(trimmed)
        .then((res) => {
          setApiResults(res);
          setSearching(false);
        })
        .catch(() => {
          setApiResults([]);
          setSearching(false);
        });
    }, 200);

    return () => {
      clearTimeout(timer);
    };
  }, [query]);

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

  /** 统一"选中文档并关闭"——兼容 Fuse 结果与 API 搜索结果 */
  const selectAndClose = useCallback(
    (idx: number) => {
      const items = results.items;
      if (idx < 0 || idx >= items.length) return;
      const entry = items[idx];
      // Fuse 结果 { item: DocListItem, score? }
      if (entry && typeof entry === "object" && "item" in entry) {
        onSelectDoc((entry as { item: DocListItem }).item);
        onClose();
        return;
      }
      // API 结果 ApiDocSearchResult — 按 path 匹配 DocListItem
      if (entry && typeof entry === "object" && "path" in entry) {
        const doc = docs.find(
          (d) => d.path === (entry as ApiDocSearchResult).path,
        );
        if (doc) onSelectDoc(doc);
        onClose();
      }
    },
    [results, onSelectDoc, onClose, docs],
  );

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = results.items;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          selectAndClose(selectedIndex);
          break;
      }
    },
    [results, selectedIndex, selectAndClose],
  );

  if (!isOpen) return null;

  const resultItems = results.items;
  const isApiMode = results.kind === "api";
  const showSpinner = results.kind === "searching" && query.trim();

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

      {/* 卡片 — API 模式加宽以容纳 snippet */}
      <div
        className={`relative z-10 w-full mx-gm-4
                   bg-surface border border-border rounded-gm-lg
                   shadow-gm-lg animate-gm-fade-in flex flex-col max-h-[70vh]
                   ${isApiMode ? "max-w-2xl" : "max-w-lg"}`}
        role="dialog"
        aria-modal="true"
        aria-label="搜索文档"
        onKeyDown={handleKeyDown}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-gm-3 px-gm-4 py-gm-3 border-b border-border">
          {showSpinner ? (
            <RiLoader4Line className="text-gm-icon text-primary animate-spin shrink-0" />
          ) : (
            <RiSearchLine className="text-gm-icon text-text-muted shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-gm-base text-text
                       placeholder:text-text-muted/50 outline-none"
            placeholder={isApiMode ? "搜索文档正文..." : "搜索文档名称或说明..."}
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
          {resultItems.length === 0 ? (
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
          ) : isApiMode ? (
            /* ── API 全文搜索结果：显示 snippet ── */
            (resultItems as ApiDocSearchResult[]).map((r, idx) => {
              const displayName = r.name.replace(/\.md$/, "");
              return (
                <button
                  key={r.path}
                  onClick={() => selectAndClose(idx)}
                  className={`w-full flex items-start gap-gm-3 px-gm-4 py-gm-3 text-left
                              transition-colors hover:bg-surface-alt/30
                              ${idx === selectedIndex
                                ? "bg-primary/8 border-l-2 border-primary"
                                : "border-l-2 border-transparent"
                              }`}
                  data-testid={`search-result-${idx}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-gm-2">
                      <span className="text-gm-sm font-medium text-text truncate">
                        {displayName}
                      </span>
                      {r.match_count > 1 && (
                        <span className="shrink-0 text-gm-2xs text-text-muted/50">
                          {r.match_count} 处匹配
                        </span>
                      )}
                    </div>
                    {r.snippet && (
                      <span className="text-gm-xs text-text-muted/70 line-clamp-2 mt-gm-0.5 block font-mono whitespace-pre-wrap break-all">
                        {r.snippet}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-gm-2xs text-text-muted/50 bg-surface-lowered/60
                                   rounded-gm-xs px-gm-1.5 py-0.5 mt-0.5">
                    {r.group}
                  </span>
                </button>
              );
            })
          ) : (
            /* ── 浏览模式 / Fuse 搜索：现有卡片样式 ── */
            resultItems.map((entry, idx) => {
              const item = (entry as { item: DocListItem }).item;
              const displayName = item.name.replace(/\.md$/, "");
              return (
                <button
                  key={item.path}
                  onClick={() => selectAndClose(idx)}
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

"use client";

import { useState, useCallback, useEffect } from "react";
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBookOpenLine,
  RiSearchLine,
  RiHistoryLine,
} from "@remixicon/react";
import DataState from "@/components/ui/DataState";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import type { EpisodeOut, FetchState } from "@/lib/api/types";

/** 格式化 Unix 时间戳为 zh-CN 本地时间 */
function fmtTime(ts: number | null): string {
  if (!ts || ts <= 0) return "N/A";
  return new Date(ts * 1000).toLocaleString("zh-CN");
}

/** 截断内容预览 */
function contentPreview(content: string, maxLen = 80): string {
  return content.length > maxLen ? content.slice(0, maxLen) + "…" : content;
}

/** 记忆分级 → 中文标签 */
function tierLabel(tier: string): string {
  const map: Record<string, string> = { hot: "🔥 热", warm: "🌤 温", cold: "❄️ 冷" };
  return map[tier] ?? tier;
}

/** 记忆分级 → Tailwind 颜色 class */
function tierColor(tier: string): string {
  const map: Record<string, string> = { hot: "text-error", warm: "text-warning", cold: "text-info" };
  return map[tier] ?? "text-text-muted";
}

export interface JourneyHistoryBrowserProps {
  /** 收起对话历史的回调（点击头部触发） */
  onCollapse?: () => void;
}

/**
 * 旅程历史浏览器 — 浏览历史对话记录。
 *
 * 自管理 fetch（GET /memory/episodes），支持客户端搜索过滤、
 * 行展开查看完整内容与元数据、刷新重载。
 * 四态状态机：idle → loading → success | error。
 */
export default function JourneyHistoryBrowser({ onCollapse }: JourneyHistoryBrowserProps) {
  const [state, setState] = useState<FetchState>("idle");
  const [episodes, setEpisodes] = useState<EpisodeOut[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // ── Fetch ──────────────────────────────────────────────────────────

  const fetchEpisodes = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getEpisodes(50);
      setEpisodes(result);
      setState(result.length > 0 ? "success" : "idle");
    } catch (err) {
      setError(err);
      setState("error");
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchEpisodes(), 0);
    return () => clearTimeout(id);
  }, [fetchEpisodes]);

  // ── Search filter ──────────────────────────────────────────────────

  const filtered = search.trim()
    ? episodes.filter((ep) =>
        ep.content.toLowerCase().includes(search.toLowerCase()),
      )
    : episodes;

  // ── Expand toggle ──────────────────────────────────────────────────

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ── Render states ──────────────────────────────────────────────────

  return (
    <div className="rounded-gm-md bg-surface-elevated border border-border overflow-hidden">
      {/* Header — clickable to collapse */}
      <div
        className={`flex items-center justify-between px-gm-4 py-gm-3
                      border-b border-border ${onCollapse ? "cursor-pointer select-none" : ""}`}
        {...(onCollapse
          ? {
              role: "button",
              tabIndex: 0,
              onClick: onCollapse,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCollapse();
                }
              },
            }
          : {})}
      >
        <div className="flex items-center gap-gm-2">
          <RiHistoryLine className="text-accent text-gm-icon" />
          <span className="text-gm-sm font-semibold text-text-muted">
            对话历史
          </span>
          {state === "success" && (
            <span className="text-gm-xs text-text-muted">
              {episodes.length} 条
            </span>
          )}
        </div>
        <RefreshButton
          variant="ghost"
          onClick={fetchEpisodes}
          loading={state === "loading"}
        />
      </div>

      {/* Search bar — only show when we have data */}
      {state === "success" && episodes.length > 0 && (
        <div className="px-gm-4 py-gm-2 border-b border-border">
          <div className="flex items-center gap-gm-2 rounded-gm-xs px-gm-3 py-gm-1_5
                          bg-bg-subtle
                          focus-within:ring-2 focus-within:ring-brand/50">
            <RiSearchLine className="text-gm-icon text-text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索历史内容…"
              aria-label="搜索历史内容"
              className="flex-1 text-gm-sm bg-transparent outline-none
                         placeholder:text-text-muted text-text"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-gm-xs text-text-muted shrink-0 cursor-pointer
                           hover:text-text transition-colors active:scale-[0.97]
                           focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                           rounded-gm-xs"
              >
                清除
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="max-h-96 overflow-y-auto">
        <DataState
          state={state}
          error={error}
          onRetry={fetchEpisodes}
          emptyIcon={RiBookOpenLine}
          emptyMessage="暂无对话历史"
          isEmpty={state === "success" && episodes.length === 0}
        >
          {/* No search results */}
          {filtered.length === 0 && search.trim() && (
            <div className="flex flex-col items-center gap-gm-2 py-gm-8">
              <RiSearchLine className="text-gm-icon text-text-muted" />
              <p className="text-gm-sm text-text-muted">
                未找到匹配 &ldquo;{search}&rdquo; 的记录
              </p>
            </div>
          )}

          {state === "success" && filtered.length > 0 && (
          <div className="divide-y divide-border">
            {filtered.map((ep) => {
              const isExpanded = expandedIds.has(ep.id);
              return (
                <div key={ep.id}>
                  {/* Collapsed row */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(ep.id)}
                    className="flex items-start gap-gm-2 w-full text-left
                               px-gm-4 py-gm-3 cursor-pointer
                               hover:bg-bg-subtle/50 transition-colors active:bg-bg-subtle/80
                               focus-visible:ring-2 focus-visible:ring-brand/50
                               focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <span className="shrink-0 mt-px">
                      {isExpanded ? (
                        <RiArrowDownSLine className="text-gm-icon text-text-muted" />
                      ) : (
                        <RiArrowRightSLine className="text-gm-icon text-text-muted" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gm-sm leading-relaxed line-clamp-2 text-text-secondary">
                        {isExpanded ? ep.content : contentPreview(ep.content)}
                      </p>
                      <p className="text-gm-xs mt-gm-1 text-text-muted">
                        {fmtTime(ep.timestamp)}
                        {" · 重要性 "}{ep.importance.toFixed(0)}
                        {" · 强度 "}{(ep.initial_strength * 100).toFixed(0)}%
                      </p>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-gm-4 pb-gm-3 pl-gm-10 bg-bg-subtle">
                      <div className="grid grid-cols-2 gap-x-gm-4 gap-y-gm-2
                                      text-gm-xs">
                        <div>
                          <span className="text-text-muted">ID</span>
                          <p className="font-mono text-text">
                            {ep.id}
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">时间</span>
                          <p className="text-text">
                            {fmtTime(ep.timestamp)}
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">重要性</span>
                          <p className="font-mono text-text">
                            {ep.importance.toFixed(1)}
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">初始强度</span>
                          <p className="font-mono text-text">
                            {(ep.initial_strength * 100).toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">衰减系数 λ</span>
                          <p className="font-mono text-text">
                            {ep.lambda.toFixed(4)}
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">访问次数</span>
                          <p className="font-mono text-text">
                            {ep.access_count}
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">FAISS ID</span>
                          <p className="font-mono text-text">
                            {ep.faiss_id ?? "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">最近召回</span>
                          <p className="text-text">
                            {fmtTime(ep.last_recall)}
                          </p>
                        </div>
                        <div>
                          <span className="text-text-muted">记忆分级</span>
                          <p className={`font-mono text-gm-xs font-medium ${tierColor(ep.tier)}`}>
                            {tierLabel(ep.tier)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </DataState>
      </div>
    </div>
  );
}

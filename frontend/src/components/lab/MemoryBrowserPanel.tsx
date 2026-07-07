"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  RiBookOpenLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiSearchLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { TabBar } from "@/components/ui/TabBar";
import type {
  EpisodeOut,
  FactOut,
  FetchState,
  TierDistributionResponse,
} from "@/lib/api/types";
import { fmtTimestamp as fmtTime } from "@/lib/formatTime";
type SubTab = "episodes" | "facts";

const SUB_TABS = [
  { key: "episodes", label: "记忆流" },
  { key: "facts", label: "知识碎片" },
] as const;

/** 记忆分级 → 颜色类名映射 */
const TIER_STYLES: Record<string, string> = {
  hot: "bg-danger/10 text-danger-light border-danger/20",
  warm: "bg-warning/10 text-warning-light border-warning/20",
  cold: "bg-text-muted/10 text-text-muted border-text-muted/20",
};

/** 记忆分级 → 中文标签 */
const TIER_LABELS: Record<string, string> = {
  hot: "热层",
  warm: "温层",
  cold: "冷层",
};

/**
 * 记忆浏览器面板。
 * 双视图子 Tab：记忆流 (Episodes) + 知识碎片 (Facts)。
 * 支持客户端搜索（content 关键字）和可展开详情行。
 */
export default function MemoryBrowserPanel() {
  // ── 子 Tab ──
  const [subTab, setSubTab] = useState<SubTab>("episodes");

  // ── Episodes ──
  const [epState, setEpState] = useState<FetchState>("idle");
  const [epData, setEpData] = useState<EpisodeOut[]>([]);
  const [epError, setEpError] = useState<Error | string | null>(null);
  const [epSearch, setEpSearch] = useState("");
  const [expandedEpIds, setExpandedEpIds] = useState<Set<number>>(new Set());

  // ── Facts ──
  const [fctState, setFctState] = useState<FetchState>("idle");
  const [fctData, setFctData] = useState<FactOut[]>([]);
  const [fctError, setFctError] = useState<Error | string | null>(null);
  const [fctSearch, setFctSearch] = useState("");
  const [expandedFctIds, setExpandedFctIds] = useState<Set<number>>(new Set());

  // ── Tier filter (Phase 54 Batch 5) ──
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [tierDist, setTierDist] = useState<TierDistributionResponse | null>(null);

  // ── Episodes fetch ──
  const fetchEpisodes = useCallback(async () => {
    setEpState("loading");
    setEpError(null);
    try {
      const result = await api.getEpisodes(50);
      setEpData(result);
      setEpState(result.length > 0 ? "success" : "idle");
    } catch (err) {
      setEpError(err instanceof Error ? err : new Error("获取记忆流失败"));
      setEpState("error");
    }
  }, []);

  // ── Facts fetch ──
  const fetchFacts = useCallback(async () => {
    setFctState("loading");
    setFctError(null);
    try {
      const result = await api.getFacts(50);
      setFctData(result);
      setFctState(result.length > 0 ? "success" : "idle");
    } catch (err) {
      setFctError(err instanceof Error ? err : new Error("获取知识碎片失败"));
      setFctState("error");
    }
  }, []);

  // Auto-fetch episodes on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEpisodes();
  }, [fetchEpisodes]);

  // Lazy-fetch facts on first sub-tab switch
  useEffect(() => {
    if (subTab === "facts" && fctState === "idle") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFacts();
    }
  }, [subTab, fctState, fetchFacts]);

  // Fetch tier distribution on mount
  useEffect(() => {
    const fetchTiers = async () => {
      try {
        const result = await api.getTiers();
        if (result.tier_enabled) setTierDist(result);
      } catch {
        // Silently ignore — tier filter just won't show
      }
    };
    fetchTiers();
  }, []);

  // ── Client-side search + tier filter ──
  const filteredEpisodes = useMemo(() => {
    let result = epData;
    if (tierFilter !== "all") {
      result = result.filter((ep) => ep.tier === tierFilter);
    }
    if (epSearch) {
      const q = epSearch.toLowerCase();
      result = result.filter((ep) => ep.content.toLowerCase().includes(q));
    }
    return result;
  }, [epData, epSearch, tierFilter]);

  const filteredFacts = fctSearch
    ? fctData.filter((f) =>
        f.content.toLowerCase().includes(fctSearch.toLowerCase()),
      )
    : fctData;

  // ── Toggle helper ──
  const toggleSetItem = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    id: number,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ── Current state aliases ──
  const isEpisodes = subTab === "episodes";
  const currentState = isEpisodes ? epState : fctState;

  const handleRefresh = isEpisodes ? fetchEpisodes : fetchFacts;

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiBookOpenLine className="w-5 h-5 text-info shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">记忆浏览器</h3>
        <span className="text-gm-xs text-text-muted">
          浏览记忆流与知识碎片
        </span>
        {currentState === "success" && (
          <RefreshButton
            onClick={handleRefresh}
            className="ml-auto"
          />
        )}
      </div>

      {/* 子 Tab 导航 */}
      <TabBar
        tabs={SUB_TABS}
        activeKey={subTab}
        onChange={(key) => setSubTab(key as SubTab)}
        activeColor="info"
        size="xs"
        ariaLabel="记忆浏览器子面板"
        className="mb-gm-4"
      />

      {/* 分层过滤 pills */}
      {isEpisodes && tierDist && (
        <div className="flex items-center gap-gm-1.5 mb-gm-3" role="radiogroup" aria-label="记忆分层过滤">
          {(["all", "hot", "warm", "cold"] as const).map((tier) => {
            const isActive = tierFilter === tier;
            const count = tier === "all"
              ? tierDist.distribution.hot + tierDist.distribution.warm + tierDist.distribution.cold
              : tierDist.distribution[tier] ?? 0;
            const style = tier === "all"
              ? "border-text-muted/30 text-text-muted"
              : TIER_STYLES[tier];
            const activeRing = isActive
              ? "ring-1 ring-info/50"
              : "";
            return (
              <button
                key={tier}
                role="radio"
                aria-checked={isActive}
                onClick={() => setTierFilter(tier)}
                className={`text-gm-xs px-gm-2 py-gm-0.5 rounded-gm-sm border transition-colors ${style} ${activeRing} ${
                  isActive ? "opacity-100" : "opacity-60 hover:opacity-80"
                }`}
              >
                {tier === "all" ? "全部" : TIER_LABELS[tier]}
                <span className="ml-gm-1 tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 搜索框 */}
      {(currentState === "success" ||
        (isEpisodes ? epData.length > 0 : fctData.length > 0)) && (
        <div className="relative mb-gm-3">
          <RiSearchLine className="absolute left-gm-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted/70" />
          <input
            type="text"
            placeholder={isEpisodes ? "搜索记忆流…" : "搜索知识碎片…"}
            value={isEpisodes ? epSearch : fctSearch}
            onChange={(e) =>
              isEpisodes
                ? setEpSearch(e.target.value)
                : setFctSearch(e.target.value)
            }
            className="w-full rounded-gm-sm border border-border bg-surface pl-gm-8 pr-gm-3 py-gm-1.5 text-gm-xs text-text placeholder:text-text-muted/50 focus:outline-none focus:border-info/50"
          />
        </div>
      )}

      {/* ── Episodes Tab Content ── */}
      {isEpisodes ? (
        <DataState
          state={epState}
          error={epError}
          onRetry={fetchEpisodes}
          loadingMessage="加载记忆流…"
          loadingIconClassName="text-info"
          emptyIcon={RiBookOpenLine}
          emptyMessage={
            epSearch || tierFilter !== "all"
              ? "无匹配结果"
              : "暂无记忆流"
          }
          isEmpty={epState === "success" && filteredEpisodes.length === 0}
        >
          <div className="border-t border-border pt-gm-4 space-y-gm-1">
            {filteredEpisodes.map((ep) => {
              const isExpanded = expandedEpIds.has(ep.id);
              return (
                <div
                  key={ep.id}
                  className="rounded-gm-sm border border-border/50 hover:bg-surface-alt/50 transition-colors"
                >
                  <div
                    className="flex items-center gap-gm-2 p-gm-3 cursor-pointer"
                    onClick={() => toggleSetItem(setExpandedEpIds, ep.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSetItem(setExpandedEpIds, ep.id);
                      }
                    }}
                    aria-expanded={isExpanded}
                  >
                    <span
                      className="text-text-muted transition-colors shrink-0"
                      aria-hidden="true"
                    >
                      {isExpanded ? (
                        <RiArrowDownSLine className="w-4 h-4" />
                      ) : (
                        <RiArrowRightSLine className="w-4 h-4" />
                      )}
                    </span>
                    <span className="text-gm-xs text-text-secondary line-clamp-2 flex-1">
                      {ep.content}
                    </span>
                    {/* Tier 分级徽章 */}
                    {ep.tier && TIER_STYLES[ep.tier] && (
                      <span
                        className={`text-gm-xs px-gm-1 py-gm-0.5 rounded-gm-xs border tabular-nums shrink-0 ${TIER_STYLES[ep.tier]}`}
                      >
                        {TIER_LABELS[ep.tier] ?? ep.tier}
                      </span>
                    )}
                    <span className="text-gm-xs text-text-muted tabular-nums shrink-0">
                      {ep.importance.toFixed(2)}
                    </span>
                    <span className="text-gm-xs text-text-muted/60 shrink-0 w-24 text-right truncate">
                      {fmtTime(ep.timestamp)}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border/30 px-gm-4 py-gm-3 bg-surface-alt/30">
                      <div className="grid grid-cols-2 gap-gm-2 text-gm-xs">
                        <div>
                          <span className="text-text-muted">ID：</span>
                          <span className="text-text-secondary tabular-nums">
                            {ep.id}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">
                            initial_strength：
                          </span>
                          <span className="text-text-secondary tabular-nums">
                            {ep.initial_strength.toFixed(3)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">importance：</span>
                          <span className="text-text-secondary tabular-nums">
                            {ep.importance.toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">lambda：</span>
                          <span className="text-text-secondary tabular-nums">
                            {ep.lambda.toFixed(3)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">access_count：</span>
                          <span className="text-text-secondary tabular-nums">
                            {ep.access_count}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">tier：</span>
                          <span
                            className={`text-gm-xs px-gm-1 py-gm-0.5 rounded-gm-xs border ${TIER_STYLES[ep.tier] ?? "text-text-secondary"}`}
                          >
                            {TIER_LABELS[ep.tier] ?? ep.tier ?? "warm"}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">faiss_id：</span>
                          <span className="text-text-secondary tabular-nums">
                            {ep.faiss_id ?? "N/A"}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">last_recall：</span>
                          <span className="text-text-secondary tabular-nums">
                            {ep.last_recall ? fmtTime(ep.last_recall) : "从未召回"}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">timestamp：</span>
                          <span className="text-text-secondary">
                            {fmtTime(ep.timestamp)}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-text-muted">content：</span>
                          <p className="text-text-secondary mt-gm-0.5">
                            {ep.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DataState>
      ) : (
        /* ── Facts Tab Content ── */
        <DataState
          state={fctState}
          error={fctError}
          onRetry={fetchFacts}
          loadingMessage="加载知识碎片…"
          loadingIconClassName="text-info"
          emptyIcon={RiBookOpenLine}
          emptyMessage={fctSearch ? "无匹配结果" : "暂无知识碎片"}
          isEmpty={fctState === "success" && filteredFacts.length === 0}
        >
          <div className="border-t border-border pt-gm-4 space-y-gm-1">
            {filteredFacts.map((f) => {
              const isExpanded = expandedFctIds.has(f.id);
              const hasTriple = f.subject && f.relation && f.object;
              return (
                <div
                  key={f.id}
                  className="rounded-gm-sm border border-border/50 hover:bg-surface-alt/50 transition-colors"
                >
                  <div
                    className="flex items-center gap-gm-2 p-gm-3 cursor-pointer"
                    onClick={() => toggleSetItem(setExpandedFctIds, f.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSetItem(setExpandedFctIds, f.id);
                      }
                    }}
                    aria-expanded={isExpanded}
                  >
                    <span
                      className="text-text-muted transition-colors shrink-0"
                      aria-hidden="true"
                    >
                      {isExpanded ? (
                        <RiArrowDownSLine className="w-4 h-4" />
                      ) : (
                        <RiArrowRightSLine className="w-4 h-4" />
                      )}
                    </span>
                    <span className="text-gm-xs text-text-secondary line-clamp-2 flex-1">
                      {f.content}
                    </span>
                    {hasTriple && (
                      <span className="flex items-center gap-gm-1 text-gm-xs shrink-0">
                        <span className="px-gm-1 py-gm-0.5 rounded-gm-xs bg-info/10 text-info">
                          {f.subject}
                        </span>
                        <span className="text-text-muted/60">
                          {f.relation}
                        </span>
                        <span className="px-gm-1 py-gm-0.5 rounded-gm-xs bg-accent/10 text-accent">
                          {f.object}
                        </span>
                      </span>
                    )}
                    <span className="text-gm-xs text-text-muted tabular-nums shrink-0">
                      {(f.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border/30 px-gm-4 py-gm-3 bg-surface-alt/30">
                      <div className="grid grid-cols-2 gap-gm-2 text-gm-xs">
                        <div>
                          <span className="text-text-muted">ID：</span>
                          <span className="text-text-secondary tabular-nums">
                            {f.id}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">confidence：</span>
                          <span className="text-text-secondary tabular-nums">
                            {f.confidence.toFixed(3)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">subject：</span>
                          <span className="text-text-secondary">
                            {f.subject || "N/A"}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">relation：</span>
                          <span className="text-text-secondary">
                            {f.relation || "N/A"}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">object：</span>
                          <span className="text-text-secondary">
                            {f.object || "N/A"}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">
                            source_episode_id：
                          </span>
                          <span className="text-text-secondary tabular-nums">
                            {f.source_episode_id ?? "N/A"}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-muted">timestamp：</span>
                          <span className="text-text-secondary">
                            {fmtTime(f.timestamp)}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-text-muted">content：</span>
                          <p className="text-text-secondary mt-gm-0.5">
                            {f.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DataState>
      )}
    </section>
  );
}

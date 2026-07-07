"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Drawer from "@/components/ui/Drawer";
import {
  RiCloseLine,
  RiLoader4Line,
  RiErrorWarningLine,
  RiInformationLine,
  RiChat3Line,
  RiHistoryLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiRefreshLine,
  RiThumbUpLine,
  RiThumbDownLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import type { TagDetailResponse } from "@/lib/api/types";
import { fmtTimestamp } from "@/lib/formatTime";

/** 抽屉滑入动画参数。duration=600ms 与 ProcessDrawer 对齐（--gm-duration-drawer-slow）。 */

interface TagDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  subject: string;
  relation: string;
}

/**
 * 标签溯源抽屉。
 *
 * 当用户在 TagCloud 中点击一个标签时从右侧滑入，展示该标签的完整溯源信息：
 * 所有关联事实、每条事实的来源对话、置信度变更日志。
 * 自主管理 fetch 状态（loading / error / empty / data）。
 *
 * 对标 ProcessDrawer 的抽屉模式：右侧滑入 + 毛玻璃 backdrop + 三阶段进出动画。
 */
export default function TagDetailDrawer({
  isOpen,
  onClose,
  subject,
  relation,
}: TagDetailDrawerProps) {
  // ── 数据加载 ──
  const [data, setData] = useState<TagDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(
    new Set(),
  );
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [mutating, setMutating] = useState<Set<number>>(new Set());
  const [mutationErrors, setMutationErrors] = useState<Map<number, string>>(
    new Map(),
  );
  const errorTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Phase 66 B105 — 即时 tooltip 替代原生 title (T8: 关闭按钮)
  const [closeTooltip, setCloseTooltip] = useState<{ x: number; y: number } | null>(null);

  // Phase 66 B106 — 即时 tooltip (T13+T14: 纠正/加星按钮, 共享 state text 区分)
  const [actionTooltip, setActionTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  /** 调用 API 加载标签详情。subject / relation 任一为空则跳过。 */
  const fetchDetail = useCallback(async () => {
    if (!subject || !relation) return;
    setData(null);
    setError(null);
    setExpandedEpisodes(new Set());
    setExpandedLogs(new Set());
    setMutating(new Set());
    setMutationErrors(new Map());
    setLoading(true);
    try {
      const result = await api.getTagDetail(subject, relation);
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载标签详情失败");
    } finally {
      setLoading(false);
    }
  }, [subject, relation]);

  /** 纠正事实 — 降低置信度 0.3，reason="user_correction"。 */
  const handleCorrect = useCallback(
    async (factId: number) => {
      setMutating((prev) => new Set(prev).add(factId));
      setMutationErrors((prev) => {
        const next = new Map(prev);
        next.delete(factId);
        return next;
      });
      try {
        await api.updateFactConfidence(factId, {
          delta: -0.3,
          reason: "user_correction",
        });
        await fetchDetail();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "纠正失败";
        setMutationErrors((prev) => new Map(prev).set(factId, msg));
        errorTimers.current.set(
          factId,
          setTimeout(() => {
            setMutationErrors((prev) => {
              const next = new Map(prev);
              next.delete(factId);
              return next;
            });
          }, 3000),
        );
      } finally {
        setMutating((prev) => {
          const next = new Set(prev);
          next.delete(factId);
          return next;
        });
      }
    },
    [fetchDetail],
  );

  /** 加星事实 — 提升置信度 0.2，reason="user_star"。 */
  const handleStar = useCallback(
    async (factId: number) => {
      setMutating((prev) => new Set(prev).add(factId));
      setMutationErrors((prev) => {
        const next = new Map(prev);
        next.delete(factId);
        return next;
      });
      try {
        await api.updateFactConfidence(factId, {
          delta: 0.2,
          reason: "user_star",
        });
        await fetchDetail();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "加星失败";
        setMutationErrors((prev) => new Map(prev).set(factId, msg));
        errorTimers.current.set(
          factId,
          setTimeout(() => {
            setMutationErrors((prev) => {
              const next = new Map(prev);
              next.delete(factId);
              return next;
            });
          }, 3000),
        );
      } finally {
        setMutating((prev) => {
          const next = new Set(prev);
          next.delete(factId);
          return next;
        });
      }
    },
    [fetchDetail],
  );

  // 打开时加载标签详情（通过 setTimeout 避免同步 setState 触发 React 19 警告）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对标 B89 消除模式，抽屉打开时同步触发加载
    if (isOpen) fetchDetail();
  }, [isOpen, fetchDetail]);

  // ── 工具函数 ──

  const toggleEpisode = (factId: number) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(factId)) next.delete(factId);
      else next.add(factId);
      return next;
    });
  };

  const toggleLog = (factId: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(factId)) next.delete(factId);
      else next.add(factId);
      return next;
    });
  };

  /** 置信度 → 颜色档位。与 TagCloud 规则一致：>0.7 success / >0.4 warning / ≤0.4 muted。 */
  const confidenceBadgeClass = (c: number) => {
    if (c > 0.7) return "text-success bg-success/10 border-success/20";
    if (c > 0.4) return "text-warning bg-warning/10 border-warning/20";
    return "text-text-muted bg-surface-lowered border-border";
  };

  const showData = !loading && !error && data && data.facts.length > 0;
  const showEmpty = !loading && !error && data && data.facts.length === 0;

  return (
    <>
    <Drawer isOpen={isOpen} onClose={onClose} maxWidth={480} duration={600} ariaLabel={`标签详情: ${relation}`}>
        {/* ═══ Header ═══ */}
        <div
          className="shrink-0 flex items-center justify-between
                     px-gm-5 py-gm-4"
          style={{
            background: "var(--gm-surface-elevated)",
            borderBottom: "1px solid var(--gm-border)",
          }}
        >
          <div className="flex items-center gap-gm-2 min-w-0">
            <RiInformationLine className="w-5 h-5 text-brand shrink-0" />
            <h2 className="text-gm-base font-semibold text-text truncate">
              {relation}
            </h2>
            {data && data.facts.length > 0 && (
              <span
                className={`shrink-0 rounded-gm-xs border px-gm-2
                           py-gm-0_5 text-gm-xs font-medium
                           ${confidenceBadgeClass(data.max_confidence)}`}
              >
                {Math.round(data.max_confidence * 100)}%
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-gm-1 rounded-gm-sm text-text-muted
                       hover:text-text hover:bg-surface-lowered
                       transition-colors shrink-0"
            aria-label="关闭"
            onMouseEnter={(e) => setCloseTooltip({ x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setCloseTooltip((prev) => prev ? { x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => setCloseTooltip(null)}
          >
            <RiCloseLine className="w-5 h-5" />
          </button>
        </div>

        {/* ═══ Body — 可滚动内容区 ═══ */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {/* Loading */}
          {loading && (
            <div
              className="flex flex-col items-center justify-center gap-gm-3
                         py-gm-16"
            >
              <RiLoader4Line className="w-8 h-8 text-brand animate-spin" />
              <p className="text-gm-sm text-text-muted">加载标签详情中…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div
              className="flex flex-col items-center justify-center gap-gm-4
                         py-gm-16 px-gm-6"
            >
              <RiErrorWarningLine className="w-10 h-10 text-danger/60" />
              <p className="text-gm-sm text-text-secondary text-center">
                {error}
              </p>
              <button
                onClick={fetchDetail}
                className="rounded-gm-sm bg-surface-elevated border border-border
                           px-gm-4 py-gm-2 text-gm-sm text-text-secondary
                           hover:text-text hover:bg-surface transition-colors
                           flex items-center gap-gm-1_5"
              >
                <RiRefreshLine className="w-4 h-4" />
                重试
              </button>
            </div>
          )}

          {/* Empty */}
          {showEmpty && (
            <div
              className="flex flex-col items-center justify-center gap-gm-3
                         py-gm-16 px-gm-6"
            >
              <RiInformationLine className="w-10 h-10 text-text-muted/40" />
              <p className="text-gm-sm text-text-muted">
                该标签暂无关联事实
              </p>
              <p className="text-gm-xs text-text-muted/60 text-center">
                当 AI 从对话中提取到与此标签相关的事实后，会在这里展示
              </p>
            </div>
          )}

          {/* Data — 完整标签溯源 */}
          {showData && data && (
            <>
              {/* Sub-header 统计 */}
              <div
                className="shrink-0 flex items-center gap-gm-4 px-gm-5
                           py-gm-2_5 text-gm-xs text-text-muted"
                style={{ borderBottom: "1px solid var(--gm-border)" }}
              >
                <span>
                  主体:{" "}
                  <span className="text-text-secondary font-medium">
                    {data.subject}
                  </span>
                </span>
                <span>{data.fact_count} 条事实</span>
                <span>{data.distinct_objects} 个关联对象</span>
              </div>

              {/* 事实列表 */}
              <div className="px-gm-5 py-gm-4 space-y-gm-3">
                {data.facts.map((fact) => {
                  const isEpisodeExpanded = expandedEpisodes.has(fact.id);
                  const isLogExpanded = expandedLogs.has(fact.id);

                  return (
                    <div
                      key={fact.id}
                      className="bg-surface-elevated border border-border
                                 rounded-gm-sm px-gm-4 py-gm-3"
                    >
                      {/* 事实内容 */}
                      <p className="text-gm-sm text-text leading-relaxed mb-gm-2">
                        {fact.content}
                      </p>

                      {/* 元信息行：置信度 + 对象 + 操作按钮 */}
                      <div className="flex items-center gap-gm-3 text-gm-xs mb-gm-2">
                        <span className="text-text-muted">置信度:</span>
                        <span
                          className={`rounded-gm-xs border px-gm-1_5
                                     py-gm-0_5 font-medium
                                     ${confidenceBadgeClass(fact.confidence)}`}
                        >
                          {Math.round(fact.confidence * 100)}%
                        </span>
                        <span className="text-text-muted">对象:</span>
                        <span className="text-text-secondary font-medium">
                          {fact.object ?? "—"}
                        </span>

                        {/* 纠正 + 加星 */}
                        <div className="flex items-center gap-gm-1 ml-auto">
                          {mutating.has(fact.id) ? (
                            <RiLoader4Line className="w-3_5 h-3_5 text-text-muted animate-spin" />
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCorrect(fact.id);
                                }}
                                aria-label="纠正 — AI 识别有误"
                                onMouseEnter={(e) => setActionTooltip({ x: e.clientX, y: e.clientY, text: "纠正 — AI 识别有误" })}
                                onMouseMove={(e) => setActionTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                onMouseLeave={() => setActionTooltip(null)}
                                className="p-gm-0_5 rounded-gm-xs text-text-muted
                                           hover:text-danger hover:bg-danger/10
                                           transition-colors"
                              >
                                <RiThumbDownLine className="w-3_5 h-3_5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStar(fact.id);
                                }}
                                aria-label="加星 — AI 识别准确"
                                onMouseEnter={(e) => setActionTooltip({ x: e.clientX, y: e.clientY, text: "加星 — AI 识别准确" })}
                                onMouseMove={(e) => setActionTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                onMouseLeave={() => setActionTooltip(null)}
                                className="p-gm-0_5 rounded-gm-xs text-text-muted
                                           hover:text-success hover:bg-success/10
                                           transition-colors"
                              >
                                <RiThumbUpLine className="w-3_5 h-3_5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* 变更错误提示 */}
                      {mutationErrors.has(fact.id) && (
                        <p className="text-gm-xs text-danger mb-gm-1">
                          {mutationErrors.get(fact.id)}
                        </p>
                      )}

                      {/* 来源对话 — 可折叠 */}
                      <button
                        onClick={() => toggleEpisode(fact.id)}
                        className="flex items-center gap-gm-1_5 w-full
                                   text-gm-xs text-text-muted
                                   hover:text-text-secondary
                                   transition-colors py-gm-1"
                      >
                        <RiChat3Line className="w-3_5 h-3_5 shrink-0" />
                        <span className="flex-1 text-left">来源对话</span>
                        {isEpisodeExpanded ? (
                          <RiArrowUpSLine className="w-3_5 h-3_5 shrink-0" />
                        ) : (
                          <RiArrowDownSLine className="w-3_5 h-3_5 shrink-0" />
                        )}
                      </button>
                      {isEpisodeExpanded && (
                        <div
                          className="mt-gm-1_5 mb-gm-2 ml-gm-5 pl-gm-2
                                     border-l-2 border-border"
                        >
                          {fact.episode_content ? (
                            <>
                              <p className="text-gm-xs text-text-secondary leading-relaxed mb-gm-1">
                                {fact.episode_content}
                              </p>
                              <p className="text-gm-xs text-text-muted">
                                {fmtTimestamp(fact.episode_timestamp)}
                              </p>
                            </>
                          ) : (
                            <p className="text-gm-xs text-text-muted italic">
                              无来源对话记录
                            </p>
                          )}
                        </div>
                      )}

                      {/* 置信度变更日志 — 可折叠 */}
                      <button
                        onClick={() => toggleLog(fact.id)}
                        className="flex items-center gap-gm-1_5 w-full
                                   text-gm-xs text-text-muted
                                   hover:text-text-secondary
                                   transition-colors py-gm-1"
                      >
                        <RiHistoryLine className="w-3_5 h-3_5 shrink-0" />
                        <span className="flex-1 text-left">
                          置信度变更日志 ({fact.confidence_log.length})
                        </span>
                        {isLogExpanded ? (
                          <RiArrowUpSLine className="w-3_5 h-3_5 shrink-0" />
                        ) : (
                          <RiArrowDownSLine className="w-3_5 h-3_5 shrink-0" />
                        )}
                      </button>
                      {isLogExpanded && (
                        <div
                          className="mt-gm-1_5 ml-gm-5 pl-gm-2
                                     border-l-2 border-border space-y-gm-1"
                        >
                          {fact.confidence_log.length === 0 ? (
                            <p className="text-gm-xs text-text-muted italic">
                              暂无变更记录
                            </p>
                          ) : (
                            fact.confidence_log.map((entry, idx) => {
                              const increased =
                                entry.confidence_after >
                                entry.confidence_before;
                              const decreased =
                                entry.confidence_after <
                                entry.confidence_before;
                              const changeClass = increased
                                ? "text-success"
                                : decreased
                                  ? "text-danger"
                                  : "text-text-muted";

                              return (
                                <div
                                  key={idx}
                                  className="text-gm-xs py-gm-0_5"
                                >
                                  <span className="text-text-muted">
                                    {Math.round(
                                      entry.confidence_before * 100,
                                    )}
                                    %
                                  </span>
                                  <span className={`mx-gm-1 ${changeClass}`}>
                                    {increased
                                      ? "↑"
                                      : decreased
                                        ? "↓"
                                        : "→"}
                                  </span>
                                  <span className="text-text-muted">
                                    {Math.round(
                                      entry.confidence_after * 100,
                                    )}
                                    %
                                  </span>
                                  {entry.reason && (
                                    <span className="text-text-secondary ml-gm-1_5">
                                      · {entry.reason}
                                    </span>
                                  )}
                                  <span className="text-text-muted/60 ml-gm-1_5">
                                    {fmtTimestamp(entry.logged_at)}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
    </Drawer>
    {/* Phase 66 B105 — T8: 即时 tooltip 替代原生 title "关闭 (Esc)" */}
    {closeTooltip && (
      <div
        className="fixed z-50 rounded-gm-sm border border-border-strong bg-surface-elevated px-gm-2.5 py-gm-1.5 shadow-gm-md pointer-events-none"
        style={{ left: closeTooltip.x + 12, top: closeTooltip.y - 8 }}
      >
        <p className="text-gm-xs text-text whitespace-nowrap">关闭 (Esc)</p>
      </div>
    )}
    {/* Phase 66 B106 — T13+T14: 即时 tooltip 替代原生 title "纠正"/"加星" */}
    {actionTooltip && (
      <div
        className="fixed z-50 rounded-gm-sm border border-border-strong bg-surface-elevated px-gm-2.5 py-gm-1.5 shadow-gm-md pointer-events-none"
        style={{ left: actionTooltip.x + 12, top: actionTooltip.y - 8 }}
      >
        <p className="text-gm-xs text-text whitespace-nowrap">{actionTooltip.text}</p>
      </div>
    )}
    </>
  );
}

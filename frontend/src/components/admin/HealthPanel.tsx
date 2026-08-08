"use client";

/**
 * HealthPanel — 仪表盘概览面板。
 *
 * 展示 Admin API 返回的工程健康指标：页面标题 + 摘要卡片网格 + 门禁检查明细 + 最近提交。
 * Phase 69 Batch 1 美化：页面标题区 + 图标 + 间距/字体优化。
 *
 * @module components/admin/HealthPanel
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RiRefreshLine,
  RiGitBranchLine,
  RiCheckDoubleLine,
  RiErrorWarningLine,
  RiShieldCheckLine,
  RiCalendarCheckLine,
  RiArticleLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import { fmtDate } from "./utils";
import DailyHeatmap from "./DailyHeatmap";
import type { AdminHealthResponse, DocListItem } from "@/lib/api/types";

export default function HealthPanel({ docs }: { docs?: DocListItem[] }) {
  const [data, setData] = useState<AdminHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await api.getAdminHealth();
      if (!cancelledRef.current) {
        setData(json);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : "加载失败");
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    return () => { cancelledRef.current = true; };
  }, [refresh]);

  // ── 加载态 ──
  if (loading) {
    return (
      <div className="space-y-gm-5">
        <PageHeader lastUpdated={null} onRefresh={refresh} loading />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-gm-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-gm-lg bg-surface-elevated border border-border p-gm-5">
              <div className="w-12 h-4 rounded-gm-sm gm-skeleton-shimmer mb-gm-3" />
              <div className="w-24 h-7 rounded-gm-sm gm-skeleton-shimmer mb-gm-2" />
              <div className="w-32 h-3 rounded-gm-sm gm-skeleton-shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── 错误态 ──
  if (error) {
    return (
      <div className="space-y-gm-5">
        <PageHeader lastUpdated={null} onRefresh={refresh} />
        <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
          <p className="text-gm-sm text-text-muted">仪表盘数据加载失败</p>
          <p className="text-gm-xs text-red-500 mt-gm-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ── 摘要卡片数据 ──

  interface SummaryCard {
    label: string;
    value: string;
    sub: string;
    ok: boolean;
    icon: React.ReactNode;
  }

  const summaryCards: SummaryCard[] = [
    {
      label: "当前 Phase",
      value: data.current_phase ? `Phase ${data.current_phase}` : "—",
      sub: data.current_batch ? `Batch ${data.current_batch}` : "",
      ok: true,
      icon: <RiGitBranchLine size={16} />,
    },
    {
      label: "L5 拉通间隔",
      value: `${data.l5.batches_since_last} 批`,
      sub: data.l5.blocked ? "⚠️ 已阻断" : data.l5.last_l5_batch || "",
      ok: !data.l5.blocked,
      icon: <RiCheckDoubleLine size={16} />,
    },
    {
      label: "违纪状态",
      value: data.violations.is_blocked ? "已阻断" : "正常",
      sub: data.violations.summary.replace(/^📊 违纪统计: /, ""),
      ok: !data.violations.is_blocked,
      icon: <RiErrorWarningLine size={16} />,
    },
    {
      label: "硬阻断",
      value: data.hard_failures === 0 ? "零阻断" : `${data.hard_failures} 项阻断`,
      sub: data.hard_failures === 0 ? "所有门禁通过" : "需要修复",
      ok: data.hard_failures === 0,
      icon: <RiShieldCheckLine size={16} />,
    },
    {
      label: "日报状态",
      value: data.daily.today_exists ? "今日已写" : data.daily.yesterday_exists ? "今日未写" : "缺失",
      sub: data.daily.yesterday_date ? `昨日: ${fmtDate(data.daily.yesterday_date)}` : "",
      ok: data.daily.today_exists,
      icon: <RiCalendarCheckLine size={16} />,
    },
    {
      label: "需求日志",
      value: data.doc_freshness.requirements_last_date
        ? `最后更新 ${fmtDate(data.doc_freshness.requirements_last_date)}`
        : "—",
      sub: "",
      ok: true,
      icon: <RiArticleLine size={16} />,
    },
  ];

  // ── 门禁清单 ──
  const checkEntries = Object.entries(data.checks);

  return (
    <div className="space-y-gm-5">
      {/* 页面标题 */}
      <PageHeader lastUpdated={lastUpdated} onRefresh={refresh} />

      {/* 摘要卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-gm-3">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-gm-lg border p-gm-5 ${
              card.ok
                ? "bg-surface-elevated border-border"
                : "bg-surface-elevated border-red-200"
            }`}
          >
            {/* 图标 + 标签 */}
            <div className="flex items-center gap-gm-2 mb-gm-2_5">
              <span className={card.ok ? "text-text-muted" : "text-red-400"}>
                {card.icon}
              </span>
              <span className="text-gm-xs text-text-muted font-medium">
                {card.label}
              </span>
            </div>

            {/* 数值 */}
            <p className={`text-gm-xl font-bold leading-tight mb-gm-1 ${
              card.ok ? "text-text" : "text-red-500"
            }`}>
              {card.value}
            </p>

            {/* 副标题 */}
            {card.sub && (
              <p className={`text-gm-xs truncate ${
                card.ok ? "text-text-muted" : "text-red-300"
              }`}>
                {card.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 日报热力图 */}
      {docs && docs.length > 0 && <DailyHeatmap docs={docs} />}

      {/* 门禁明细 */}
      <section className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
        <div className="px-gm-5 py-gm-3 border-b border-border">
          <h2 className="text-gm-sm font-semibold text-text">门禁检查明细</h2>
        </div>
        <div className="divide-y divide-border">
          {checkEntries.map(([name, check]) => (
            <div key={name} className="px-gm-5 py-gm-3 hover:bg-surface-alt/30 transition-colors">
              <div className="flex items-start gap-gm-3">
                <span className={`mt-0.5 shrink-0 text-gm-sm ${check.exit_code === 0 ? "text-green-500" : "text-red-500"}`}>
                  {check.exit_code === 0 ? "✅" : "❌"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-gm-1.5 flex-wrap">
                    <p className={`text-gm-sm font-medium ${check.exit_code === 0 ? "text-text" : "text-red-500"}`}>
                      {name}
                    </p>
                    {check.is_critical && (
                      <span className="text-gm-2xs text-red-500 font-medium">[阻断]</span>
                    )}
                  </div>
                  {check.lines.length > 0 && check.lines[0] && (
                    <p className="text-gm-xs text-text-muted mt-gm-0.5 line-clamp-2">{check.lines[0]}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {checkEntries.length === 0 && (
            <div className="px-gm-5 py-gm-4 text-center text-gm-xs text-text-muted">无检查项</div>
          )}
        </div>
      </section>

      {/* 最近提交 */}
      <section className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
        <div className="px-gm-5 py-gm-3 border-b border-border">
          <h2 className="text-gm-sm font-semibold text-text">最近提交</h2>
        </div>
        <div className="divide-y divide-border">
          {data.recent_commits.slice(0, 5).map((commit, i) => (
            <div key={i} className="px-gm-5 py-gm-2_5 hover:bg-surface-alt/30 transition-colors">
              <p className="text-gm-xs text-text font-mono leading-relaxed break-all">{commit}</p>
            </div>
          ))}
          {data.recent_commits.length === 0 && (
            <div className="px-gm-5 py-gm-4 text-center text-gm-xs text-text-muted">无提交记录</div>
          )}
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PageHeader — 页面标题区
// ═══════════════════════════════════════════════════════════════════════

function PageHeader({
  lastUpdated,
  onRefresh,
  loading = false,
}: {
  lastUpdated: Date | null;
  onRefresh: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-gm-lg font-bold text-text">仪表盘</h1>
        <p className="text-gm-xs text-text-muted mt-gm-0.5">工程健康概览</p>
      </div>

      <div className="flex items-center gap-gm-3">
        {lastUpdated && (
          <span className="text-gm-xs text-text-muted hidden sm:inline">
            最后更新：{lastUpdated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-gm-1.5 rounded-gm-md border border-border bg-surface-elevated px-gm-3 py-gm-1.5 text-gm-xs text-text-secondary hover:bg-surface-alt transition-all disabled:opacity-50"
        >
          <RiRefreshLine className={`text-gm-icon ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>
    </div>
  );
}

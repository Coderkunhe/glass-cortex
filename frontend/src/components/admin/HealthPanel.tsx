"use client";

/**
 * HealthPanel — 健康概览面板。
 *
 * 展示 Admin API 返回的工程健康指标：摘要卡片网格 + 门禁检查明细 + 最近提交。
 * 从 AdminShell 拆出为独立组件，内部自行 fetch 数据。
 *
 * @module components/admin/HealthPanel
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { RiRefreshLine } from "@remixicon/react";
import { api } from "@/lib/api/client";
import { fmtDate } from "./utils";
import type { AdminHealthResponse } from "@/lib/api/types";

export default function HealthPanel() {
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
    // refresh() 内部 setState 是 mount 时初始加载的预期行为，
    // 对标 AdminShell L45 的 suppress comment。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    return () => { cancelledRef.current = true; };
  }, [refresh]);

  if (loading) {
    return (
      <div className="space-y-gm-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-gm-lg bg-surface-elevated border border-border p-gm-5">
            <div className="w-40 h-4 rounded-gm-sm gm-skeleton-shimmer mb-gm-3" />
            <div className="w-full h-20 rounded-gm-md gm-skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">健康数据加载失败</p>
        <p className="text-gm-xs text-red-500 mt-gm-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  // ── 摘要卡片 ──
  const summaryCards = [
    {
      label: "当前 Phase",
      value: data.current_phase ? `Phase ${data.current_phase}` : "—",
      sub: data.current_batch ? `Batch ${data.current_batch}` : "",
      ok: true,
    },
    {
      label: "L5 拉通间隔",
      value: `${data.l5.batches_since_last} 批`,
      sub: data.l5.blocked ? "⚠️ 已阻断" : data.l5.last_l5_batch || "",
      ok: !data.l5.blocked,
    },
    {
      label: "违纪状态",
      value: data.violations.is_blocked ? "🔴 已阻断" : "✅ 正常",
      sub: data.violations.summary.replace(/^📊 违纪统计: /, ""),
      ok: !data.violations.is_blocked,
    },
    {
      label: "硬阻断",
      value: data.hard_failures === 0 ? "✅ 零阻断" : `❌ ${data.hard_failures} 项`,
      sub: data.hard_failures === 0 ? "所有门禁通过" : "需要修复",
      ok: data.hard_failures === 0,
    },
    {
      label: "日报状态",
      value: data.daily.today_exists ? "✅ 今日已写" : data.daily.yesterday_exists ? "⚠️ 今日未写" : "❌ 缺失",
      sub: data.daily.yesterday_date ? `昨日: ${fmtDate(data.daily.yesterday_date)}` : "",
      ok: data.daily.today_exists,
    },
    {
      label: "需求日志",
      value: data.doc_freshness.requirements_last_date
        ? `最后更新 ${fmtDate(data.doc_freshness.requirements_last_date)}`
        : "—",
      sub: "",
      ok: true,
    },
  ];

  // ── 门禁清单 ──
  const checkEntries = Object.entries(data.checks);

  return (
    <div className="space-y-gm-5">
      {/* 操作栏：刷新 + 最后更新时间 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-gm-3">
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-gm-1.5 rounded-gm-md border border-border bg-surface-elevated px-gm-3 py-gm-1.5 text-gm-xs text-text-secondary hover:bg-surface-alt transition-all disabled:opacity-50"
          >
            <RiRefreshLine className={`text-gm-icon ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          {lastUpdated && (
            <span className="text-gm-xs text-text-muted">
              最后更新：{lastUpdated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {/* 摘要卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-gm-3">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-gm-lg border p-gm-4 transition-colors ${
              card.ok
                ? "bg-surface-elevated border-border"
                : "bg-red-50/10 border-red-200"
            }`}
          >
            <p className="text-gm-xs text-text-muted mb-gm-1">{card.label}</p>
            <p className={`text-gm-base font-semibold ${card.ok ? "text-text" : "text-red-500"}`}>
              {card.value}
            </p>
            {card.sub && (
              <p className="text-gm-xs text-text-muted mt-gm-0.5 truncate">{card.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* 门禁明细 */}
      <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
        <div className="px-gm-5 py-gm-3 border-b border-border bg-surface-lowered/50">
          <h2 className="text-gm-sm font-semibold text-text">门禁检查明细</h2>
        </div>
        <div className="divide-y divide-border">
          {checkEntries.map(([name, check]) => (
            <div key={name} className="px-gm-5 py-gm-3 hover:bg-surface-alt/30 transition-colors">
              <div className="flex items-start gap-gm-2">
                <span className={`mt-px text-gm-sm ${check.exit_code === 0 ? "text-green-500" : "text-red-500"}`}>
                  {check.exit_code === 0 ? "✅" : "❌"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-gm-sm font-medium ${check.exit_code === 0 ? "text-text" : "text-red-500"}${check.is_critical ? "" : ""}`}>
                    {name}
                    {check.is_critical && (
                      <span className="ml-gm-1.5 text-gm-xs text-red-400 font-normal">[阻断]</span>
                    )}
                  </p>
                  {check.lines.length > 0 && check.lines[0] && (
                    <p className="text-gm-xs text-text-muted mt-gm-0.5 line-clamp-2">{check.lines[0]}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 最近提交 */}
      <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
        <div className="px-gm-5 py-gm-3 border-b border-border bg-surface-lowered/50">
          <h2 className="text-gm-sm font-semibold text-text">最近提交</h2>
        </div>
        <div className="divide-y divide-border">
          {data.recent_commits.slice(0, 5).map((commit, i) => (
            <div key={i} className="px-gm-5 py-gm-2.5 hover:bg-surface-alt/30 transition-colors">
              <p className="text-gm-xs text-text font-mono leading-relaxed break-all">{commit}</p>
            </div>
          ))}
          {data.recent_commits.length === 0 && (
            <div className="px-gm-5 py-gm-4 text-center text-gm-xs text-text-muted">无提交记录</div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api/client";
import type { ProfileInfo, TokenSummary } from "@/lib/api/types";
import { useSessionStats } from "@/components/chat/ChatParamsContext";
import ErrorDisplay from "@/components/ui/ErrorDisplay";

/** 格式化秒数为可读时长。 */
function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** SessionHarvest — 会话收获摘要 (162.1) + 记忆召回摘要 (162.2)。
 *
 *  挂载时并行获取 token 指标和当前 profile 元数据，
 *  结合 ChatParamsContext 中的前端会话统计做聚合展示。 */
export default function SessionHarvest() {
  const { stats } = useSessionStats();
  const [tokenData, setTokenData] = useState<TokenSummary | null>(null);
  const [profileData, setProfileData] = useState<ProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tokens, profile] = await Promise.all([
        api.getTokens(),
        api.getCurrentProfile(),
      ]);
      setTokenData(tokens);
      setProfileData(profile);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取会话数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchData(), 0);
    return () => clearTimeout(id);
  }, [fetchData]);

  // 会话时长——useState 惰性初始化，避免 effect setState 警告
  const [durationSec] = useState(() =>
    Math.floor((Date.now() - stats.sessionStart) / 1000),
  );

  // ── 加载态 ──
  if (loading) {
    return (
      <div
        className="shrink-0 rounded-gm-sm bg-surface-elevated
                   border border-border p-gm-3 animate-pulse"
      >
        <div className="h-4 w-24 bg-surface-lowered rounded mb-gm-2" />
        <div className="grid grid-cols-2 gap-gm-2">
          <div className="h-10 bg-surface-lowered rounded" />
          <div className="h-10 bg-surface-lowered rounded" />
          <div className="h-10 bg-surface-lowered rounded" />
          <div className="h-10 bg-surface-lowered rounded" />
        </div>
      </div>
    );
  }

  // ── 错误态：使用统一 ErrorDisplay ──
  if (error) {
    return (
      <div className="shrink-0">
        <ErrorDisplay
          variant="card"
          error={error}
          onRetry={fetchData}
          heading="会话收获加载失败"
        />
      </div>
    );
  }

  // ── 成功态 ──
  const totalTokens = tokenData?.total_tokens ?? 0;
  const factCount = profileData?.fact_count ?? 0;
  const episodeCount = profileData?.episode_count ?? 0;
  const thisSessionMemories = stats.memoryCount;

  return (
    <div
      role="region"
      aria-label="会话收获"
      className="shrink-0 gm-card-lift rounded-gm-sm bg-surface-elevated
                 border border-border p-gm-3"
    >
      {/* ── 162.1 会话收获摘要 ── */}
      <p className="text-gm-xs font-semibold text-text-secondary mb-gm-2">
        会话收获
      </p>
      <div className="grid grid-cols-2 gap-gm-2 mb-gm-3">
        <HarvestMetric label="轮次" value={stats.messageCount} />
        <HarvestMetric label="事实" value={factCount} />
        <HarvestMetric label="Token" value={fmtToken(totalTokens)} />
        <HarvestMetric label="时长" value={fmtDuration(durationSec)} />
      </div>

      {/* ── 162.2 记忆召回摘要 ── */}
      <p className="text-gm-xs font-semibold text-text-secondary mb-gm-2">
        记忆召回
      </p>
      <div className="grid grid-cols-2 gap-gm-2">
        <div className="rounded-gm-xs bg-accent/10 px-gm-2 py-gm-1_5 text-center">
          <p className="text-gm-xs font-semibold text-accent">
            {thisSessionMemories}
          </p>
          <p className="text-gm-2xs text-text-muted">本次会话</p>
        </div>
        <div className="rounded-gm-xs bg-surface-lowered px-gm-2 py-gm-1_5 text-center">
          <p className="text-gm-xs font-semibold text-text">{episodeCount}</p>
          <p className="text-gm-2xs text-text-muted">历史总计</p>
        </div>
      </div>
    </div>
  );
}

/** 单个收获指标——标签 + 数值。 */
function HarvestMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-gm-xs bg-surface-lowered px-gm-2 py-gm-1_5 text-center">
      <p className="text-gm-xs font-semibold text-text">{value}</p>
      <p className="text-gm-2xs text-text-muted">{label}</p>
    </div>
  );
}

/** Token 数值人性化：>1k 用 k 后缀。 */
function fmtToken(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

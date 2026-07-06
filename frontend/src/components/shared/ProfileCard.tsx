"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api/client";
import type { ProfileListResponse, TagSummaryItem } from "@/lib/api/types";
import ErrorDisplay from "@/components/ui/ErrorDisplay";

/** Sidebar Profile 动态卡片 — 头像 + 标签云 + 入口链接。 */
export default function ProfileCard() {
  const [profile, setProfile] = useState<ProfileListResponse | null>(null);
  const [tags, setTags] = useState<TagSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, t] = await Promise.all([
        api.listProfiles(),
        api.getTagSummary(8),
      ]);
      setProfile(p);
      setTags(t);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取 Profile 数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchData(), 0);
    return () => clearTimeout(id);
  }, [fetchData]);

  const currentName = profile?.current || "default";
  const initial = (currentName[0] || "?").toUpperCase();

  // ── 加载态 ──
  if (loading) {
    return (
      <div
        className="shrink-0 rounded-gm-sm bg-surface-elevated
                   border border-border p-gm-3 animate-pulse"
      >
        <div className="flex items-center gap-gm-3 mb-gm-3">
          <div className="w-10 h-10 rounded-full bg-surface-lowered" />
          <div className="flex-1">
            <div className="h-4 w-20 bg-surface-lowered rounded" />
            <div className="h-3 w-12 bg-surface-lowered rounded mt-gm-1" />
          </div>
        </div>
        <div className="h-5 w-full bg-surface-lowered rounded" />
      </div>
    );
  }

  // ── 错误态：保留身份标识 + 统一 ErrorDisplay ──
  if (error) {
    return (
      <div
        className="shrink-0 rounded-gm-sm bg-surface-elevated
                   border border-border p-gm-3"
      >
        <div className="flex items-center gap-gm-3 mb-gm-2">
          <div
            className="w-10 h-10 rounded-full bg-brand flex items-center
                       justify-center shrink-0"
          >
            <span className="text-gm-sm font-bold text-text-inverse">
              {initial}
            </span>
          </div>
          <div>
            <p className="text-gm-sm font-semibold text-text">{currentName}</p>
            <p className="text-gm-xs text-text-muted">Profile</p>
          </div>
        </div>
        <ErrorDisplay variant="inline" error={error} onRetry={fetchData} />
      </div>
    );
  }

  // ── 成功态 ──
  return (
    <div
      className="shrink-0 gm-card-lift rounded-gm-sm bg-surface-elevated
                 border border-border p-gm-3"
    >
      {/* 头像 + 名字 */}
      <div className="flex items-center gap-gm-3 mb-gm-3">
        <div
          className="w-10 h-10 rounded-full bg-brand flex items-center
                     justify-center shrink-0"
        >
          <span className="text-gm-sm font-bold text-text-inverse">
            {initial}
          </span>
        </div>
        <div>
          <p className="text-gm-sm font-semibold text-text">{currentName}</p>
          <p className="text-gm-xs text-text-muted">Profile</p>
        </div>
      </div>

      {/* 标签云 */}
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-gm-1 mb-gm-3">
          {tags.slice(0, 5).map((t, i) => (
            <TagPill key={`${t.subject}-${t.relation}-${i}`} tag={t} />
          ))}
          {tags.length > 5 && (
            <span className="text-gm-xs text-text-muted ml-gm-1 self-center">
              +{tags.length - 5}
            </span>
          )}
        </div>
      ) : (
        <p className="text-gm-xs text-text-muted mb-gm-3">
          AI 还在了解你…
        </p>
      )}

      {/* 完整画像入口 */}
      <Link
        href="/profile"
        className="block w-full text-center rounded-gm-xs bg-surface-lowered
                   hover:bg-surface border border-border
                   px-gm-3 py-gm-1_5 text-gm-xs text-text-secondary
                   hover:text-text transition-colors"
      >
        完整画像 →
      </Link>
    </div>
  );
}

/** 单个标签 pill — 颜色随置信度分三档。 */
function TagPill({ tag }: { tag: TagSummaryItem }) {
  const c = tag.max_confidence;
  const variant: "high" | "mid" | "low" =
    c > 0.7 ? "high" : c > 0.4 ? "mid" : "low";

  const colors: Record<typeof variant, string> = {
    high: "bg-success/15 text-success border-success/20",
    mid: "bg-warning/15 text-warning border-warning/20",
    low: "bg-surface-lowered text-text-muted border-border",
  };

  return (
    <span
      className={`inline-block rounded-full px-gm-2 py-gm-1
                  text-gm-xs font-medium border ${colors[variant]}`}
    >
      {tag.relation}
    </span>
  );
}

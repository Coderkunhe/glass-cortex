"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RiUserSettingsLine,
  RiAddLine,
  RiDeleteBinLine,
  RiCheckLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import { fmtNum } from "@/lib/formatNum";
import { getConfidenceTier } from "@/lib/confidence";
import type { ConfidenceTier } from "@/lib/confidence";
import type {
  ProfileInfo,
  ProfileListResponse,
  TagSummaryItem,
} from "@/lib/api/types";
import { formatBytes } from "@/lib/formatBytes";
import ProfileModal from "./ProfileModal";
import TagDetailDrawer from "./TagDetailDrawer";
import ConfirmModal from "@/components/ui/ConfirmModal";
import ErrorDisplay from "@/components/ui/ErrorDisplay";

/** Profile 画像页面主组件。左栏身份+标签云，右栏 profile 管理。 */
export default function ProfileShell() {
  const [profileList, setProfileList] = useState<ProfileListResponse | null>(
    null,
  );
  const [currentProfile, setCurrentProfile] = useState<ProfileInfo | null>(
    null,
  );
  const [tags, setTags] = useState<TagSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tagDetailSubject, setTagDetailSubject] = useState<string | null>(null);
  const [tagDetailRelation, setTagDetailRelation] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);

  // B106 自检补漏 — 即时 tooltip 替代 Profile 删除按钮原生 title
  const [deleteTooltip, setDeleteTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [pl, cp, t] = await Promise.all([
        api.listProfiles(),
        api.getCurrentProfile(),
        api.getTagSummary(30),
      ]);
      setProfileList(pl);
      setCurrentProfile(cp);
      setTags(t);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("加载 Profile 数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对标 B89 消除模式，setState 在 useCallback 内部执行
    fetchAll();
  }, [fetchAll]);

  const handleCreate = async (name: string) => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setActionError(null);
    try {
      await api.createProfile(name.trim());
      setShowCreateModal(false);
      await fetchAll();
    } catch (e: unknown) {
      setActionError(
        e instanceof Error ? e : new Error("创建失败，请检查 profile 名称"),
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProfile(deleteTarget);
      setDeleteTarget(null);
      await fetchAll();
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e : new Error("删除失败，请稍后重试"));
    } finally {
      setDeleting(false);
    }
  };

  const handleSwitch = async (name: string) => {
    if (name === profileList?.current) return;
    setActionError(null);
    try {
      await api.switchProfile({ name });
      await fetchAll();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e : new Error("切换失败，请稍后重试"));
    }
  };

  // ── 加载态 ──
  if (loading) {
    return (
      <div className="flex flex-col h-full p-gm-6 space-y-gm-6">
        <Skeleton />
      </div>
    );
  }

  // ── 错误态：使用统一 ErrorDisplay ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-gm-6">
        <ErrorDisplay variant="card" error={error} onRetry={fetchAll} />
      </div>
    );
  }

  const profiles = profileList?.profiles ?? [];
  const currentName = profileList?.current ?? "default";
  const currentInfo =
    currentProfile ??
    profiles.find((p) => p.name === currentName) ??
    profiles[0];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── 操作错误横幅 ── */}
      {actionError && (
        <div className="shrink-0 mx-gm-6 mt-gm-4">
          <ErrorDisplay variant="inline" error={actionError} />
          <div className="text-right mt-gm-1">
            <button
              onClick={() => setActionError(null)}
              className="text-gm-xs text-text-muted underline hover:no-underline"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* ── 两栏主体 ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0">
        {/* ═══ 左栏：身份 + 标签云 ═══ */}
        <div className="flex flex-col border-r border-border">
          {/* 身份横幅 */}
          <div className="px-gm-6 pt-gm-6 pb-gm-5">
            {/* 头像 + 名字 */}
            <div className="flex items-center gap-gm-4 mb-gm-4">
              <div
                className="w-14 h-14 rounded-full bg-brand flex items-center
                           justify-center shrink-0 shadow-gm-sm"
              >
                <span className="text-gm-xl font-bold text-text-inverse">
                  {(currentName[0] || "?").toUpperCase()}
                </span>
              </div>
              <div>
                <h1 className="text-gm-xl font-bold text-text">
                  {currentName}
                </h1>
                <p className="text-gm-sm text-text-muted">
                  AI 认知画像
                </p>
              </div>
            </div>

            {/* 统计条 */}
            {currentInfo && (
              <div className="flex flex-wrap gap-gm-4">
                <StatChip
                  label="对话片段"
                  value={currentInfo.episode_count}
                />
                <StatChip
                  label="知识碎片"
                  value={currentInfo.fact_count}
                />
                <StatChip
                  label="索引向量"
                  value={currentInfo.index_vectors}
                />
                <StatChip
                  label="数据库"
                  value={formatBytes(currentInfo.db_size_bytes)}
                />
              </div>
            )}
          </div>

          {/* 分隔 */}
          <div className="border-t border-border" />

          {/* 标签云 — 核心视觉区 */}
          <div className="flex-1 px-gm-6 py-gm-5">
            {tags.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-gm-3">
                <RiUserSettingsLine className="w-10 h-10 text-text-muted/40" />
                <p className="text-gm-sm text-text-muted">
                  AI 还在了解你，暂无标签…
                </p>
                <p className="text-gm-xs text-text-muted/60">
                  发送几条消息后，AI 会从对话中提取关于你的知识标签
                </p>
              </div>
            ) : (
              <TagCloud
                tags={tags}
                onTagClick={(subject, relation) => {
                  setTagDetailSubject(subject);
                  setTagDetailRelation(relation);
                }}
              />
            )}
          </div>
        </div>

        {/* ═══ 右栏：Profile 管理 ═══ */}
        <div className="flex flex-col">
          {/* 右栏标题 + 新建按钮 */}
          <div
            className="shrink-0 flex items-center gap-gm-2 px-gm-5 pt-gm-6 pb-gm-3"
          >
            <RiUserSettingsLine className="w-4 h-4 text-text-muted" />
            <h2 className="text-gm-sm font-semibold text-text-secondary flex-1">
              Profile 管理
            </h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="shrink-0 flex items-center gap-gm-1
                         rounded-gm-sm bg-surface-elevated
                         border border-border hover:border-brand/40
                         px-gm-2_5 py-gm-1 text-gm-xs
                         text-text-secondary hover:text-brand
                         transition-colors"
            >
              <RiAddLine className="w-3_5 h-3_5" />
              新建
            </button>
          </div>

          {/* Profile 列表 */}
          <div className="flex-1 overflow-y-auto px-gm-4 pb-gm-3 space-y-gm-1">
            {profiles.length === 0 ? (
              <p className="text-gm-sm text-text-muted text-center py-gm-6">
                暂无 Profile
              </p>
            ) : (
              profiles.map((p) => {
                const isCurrent = p.name === currentName;
                return (
                  <div
                    key={p.name}
                    className={`group flex items-center gap-gm-2 rounded-gm-sm
                              px-gm-3 py-gm-2 transition-colors cursor-pointer
                              ${isCurrent
                                ? "bg-success/5 ring-1 ring-success/15"
                                : "hover:bg-surface"
                              }`}
                    onClick={() => handleSwitch(p.name)}
                  >
                    {/* 头像 */}
                    <div
                      className={`w-7 h-7 rounded-full flex items-center
                                 justify-center shrink-0 text-gm-xs font-bold
                                 ${isCurrent
                                   ? "bg-success text-text-inverse"
                                   : "bg-surface-lowered text-text-muted"
                                 }`}
                    >
                      {(p.name[0] || "?").toUpperCase()}
                    </div>

                    {/* 信息 */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-gm-sm font-medium truncate
                                  ${isCurrent ? "text-text" : "text-text-secondary"}`}
                      >
                        {p.name}
                      </p>
                      <p className="text-gm-xs text-text-muted truncate">
                        {p.episode_count} 对话 · {p.fact_count} 知识
                      </p>
                    </div>

                    {/* 操作 */}
                    <div
                      className="flex items-center gap-gm-1 opacity-0
                                 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                      {isCurrent ? (
                        <span
                          className="text-gm-xs text-success font-medium
                                     flex items-center gap-gm-0_5"
                        >
                          <RiCheckLine className="w-3 h-3" />
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(p.name);
                          }}
                          className="p-gm-1 rounded-gm-xs text-text-muted
                                     hover:text-danger hover:bg-danger/10
                                     transition-colors"
                          aria-label={`删除 ${p.name}`}
                          onMouseEnter={(e) => setDeleteTooltip({ x: e.clientX, y: e.clientY, text: `删除 ${p.name}` })}
                          onMouseMove={(e) => setDeleteTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                          onMouseLeave={() => setDeleteTooltip(null)}
                        >
                          <RiDeleteBinLine className="w-3_5 h-3_5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>
      </div>

      {/* 新建 Profile 模态窗 */}
      <ProfileModal
        isOpen={showCreateModal}
        onClose={() => {
          if (!creating) setShowCreateModal(false);
        }}
        onCreate={handleCreate}
        creating={creating}
        error={actionError}
        onClearError={() => setActionError(null)}
      />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={handleDelete}
        title="删除 Profile"
        message={`确定要删除 profile "${deleteTarget ?? ""}" 吗？此操作不可撤销。`}
        confirmLabel="确认删除"
        variant="danger"
        isLoading={deleting}
        error={deleteError?.message}
      />

      {/* 标签溯源抽屉 */}
      <TagDetailDrawer
        isOpen={tagDetailSubject !== null && tagDetailRelation !== null}
        onClose={() => {
          setTagDetailSubject(null);
          setTagDetailRelation(null);
        }}
        subject={tagDetailSubject ?? ""}
        relation={tagDetailRelation ?? ""}
      />
      {/* B106 自检补漏 — 即时 tooltip 替代 Profile 删除按钮原生 title */}
      {deleteTooltip && (
        <div
          className="fixed z-50 rounded-gm-sm border border-border-strong
                     bg-surface-elevated px-gm-2.5 py-gm-1.5
                     shadow-gm-md pointer-events-none"
          style={{
            left: deleteTooltip.x + 12,
            top: deleteTooltip.y - 8,
          }}
        >
          <p className="text-gm-xs text-text whitespace-nowrap">{deleteTooltip.text}</p>
        </div>
      )}
    </div>
  );
}

// ── 子组件 ──

/** 内联统计 chip — 标签+数值水平排列，替代原来的 StatCard 网格。 */
function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-gm-1_5">
      <span className="text-gm-2xl font-bold text-text tabular-nums">
        {typeof value === "number" ? fmtNum(value) : value}
      </span>
      <span className="text-gm-xs text-text-muted">{label}</span>
    </div>
  );
}

// ── 标签云 ──

/** 字体大小档位 — 从数据范围线性映射到视觉层级。 */
const FONT_SIZES = [
  "text-gm-sm",
  "text-gm-md",
  "text-gm-base",
  "text-gm-lg",
  "text-gm-xl",
  "text-gm-2xl",
  "text-gm-3xl",
] as const;

/**
 * 权重驱动标签云。
 *
 * 字体大小随 max_confidence 线性缩放，颜色按置信度分三档。
 * 居中流式布局，纯文本 + 加权字号 = 真正的"云"感。
 * 每个标签附带 title tooltip 展示底层统计。
 */
function TagCloud({
  tags,
  onTagClick,
}: {
  tags: TagSummaryItem[];
  onTagClick: (subject: string, relation: string) => void;
}) {
  const minC = Math.min(...tags.map((t) => t.max_confidence));
  const maxC = Math.max(...tags.map((t) => t.max_confidence));
  const range = maxC - minC || 1;

  // ── 即时 tooltip state — 替代原生 title 属性 1-2s 延迟 ──
  const [tooltipState, setTooltipState] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  return (
    <div
      className="flex flex-wrap items-center justify-center
                 gap-x-gm-4 gap-y-gm-2_5 leading-relaxed
                 min-h-[200px] content-center relative"
    >
      {tags.map((t, i) => {
        const idx = Math.round(
          ((t.max_confidence - minC) / range) * (FONT_SIZES.length - 1),
        );
        const sizeClass = FONT_SIZES[Math.min(idx, FONT_SIZES.length - 1)];

        const c = t.max_confidence;
        const tier = getConfidenceTier(c);
        const TAG_COLORS: Record<ConfidenceTier, string> = {
          high: "text-success hover:text-success/80",
          medium: "text-warning hover:text-warning/80",
          low: "text-text-muted hover:text-text-secondary",
        };
        const colorClass = TAG_COLORS[tier];

        const tooltipText = [
          t.subject,
          `×${t.fact_count} 条事实`,
          `${t.distinct_objects} 个关联`,
        ].join(" · ");

        return (
          <span
            key={`${t.subject}-${t.relation}-${i}`}
            role="button"
            tabIndex={0}
            onClick={() => onTagClick(t.subject, t.relation)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTagClick(t.subject, t.relation);
              }
            }}
            onMouseEnter={(e) =>
              setTooltipState({
                x: e.clientX,
                y: e.clientY,
                text: tooltipText,
              })
            }
            onMouseMove={(e) =>
              setTooltipState((prev) =>
                prev ? { ...prev, x: e.clientX, y: e.clientY } : null,
              )
            }
            onMouseLeave={() => setTooltipState(null)}
            className={`${sizeClass} font-semibold cursor-pointer
                        transition-all duration-200 hover:scale-110
                        ${colorClass}`}
          >
            {t.relation}
          </span>
        );
      })}

      {/* 即时 tooltip — 替代原生 title 延迟 */}
      {tooltipState && (
        <div
          className="fixed z-50 rounded-gm-sm border border-border-strong
                     bg-surface-elevated px-gm-2.5 py-gm-1.5
                     shadow-gm-md pointer-events-none"
          style={{
            left: tooltipState.x + 12,
            top: tooltipState.y - 8,
          }}
        >
          <p className="text-gm-xs text-text">{tooltipState.text}</p>
        </div>
      )}
    </div>
  );
}

// ── Loading 骨架 ──

function Skeleton() {
  return (
    <>
      {/* 身份横幅骨架 */}
      <div className="flex items-center gap-gm-4 animate-pulse mb-gm-6">
        <div className="w-14 h-14 rounded-full bg-surface-lowered" />
        <div>
          <div className="h-7 w-24 bg-surface-lowered rounded mb-gm-1" />
          <div className="h-4 w-16 bg-surface-lowered rounded" />
        </div>
      </div>
      {/* 标签云骨架 */}
      <div className="flex flex-wrap gap-gm-3 animate-pulse">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-5 bg-surface-lowered rounded"
            style={{ width: `${40 + ((i * 53) % 80)}px` }}
          />
        ))}
      </div>
    </>
  );
}


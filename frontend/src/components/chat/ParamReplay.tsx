"use client";

import { useParamState } from "@/components/chat/ChatParamsContext";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

/** 参数推演面板 (162.4) —— 纯前端计算，基于当前参数值推导影响投影。
 *
 *  使用 <details> 可折叠块，与 ParamSliders 的 CollapsibleSection 风格一致。
 *  所有计算都在客户端完成，不发起 API 请求。 */
export default function ParamReplay() {
  const { l2, l3, l6 } = useParamState();

  // ── 投影计算 ──
  const topK = l2.top_k;
  const threshold = l2.recall_threshold;
  const truncation = l2.truncation_threshold;
  const windowSize = l3.window_size;
  const lambda = l6.lambda;

  // 1. 召回量预估：最大 top_k 条，threshold 过滤弱项
  const recallEstimate =
    threshold > 0.1
      ? `≤ ${topK}（threshold ${threshold} 滤除低分项）`
      : `≤ ${topK}`;

  // 2. 截断行为
  const truncationNote =
    truncation > 0
      ? `composite_score < ${truncation} 的条目在注入前丢弃`
      : "截断关闭 — 所有召回条目直通上下文";

  // 3. 窗口使用率：常量 + 估算 = 百分比
  const baseOverhead = 300; // system prompt 固定开销
  const perItemTokens = 80; // 每条召回记忆估算 token
  const estimatedUser = 50;
  const estimatedUsed = baseOverhead + estimatedUser + topK * perItemTokens;
  const usagePct = Math.min(Math.round((estimatedUsed / windowSize) * 100), 100);

  // 4. 30 天保留率：Ebbinghaus e^(-λ * 720h)
  const retention = Math.exp(-lambda * 30 * 24);
  const retentionPct = Math.round(retention * 100);

  return (
    <div role="region" aria-label="参数推演">
      <CollapsibleSection
        className="shrink-0"
        variant="bordered"
        title="参数推演"
      >
      <div className="space-y-gm-2">
        {/* 1. 召回预估 */}
        <ProjectionRow label="预估召回量" value={recallEstimate} />

        {/* 2. 截断行为 */}
        <ProjectionRow label="截断行为" value={truncationNote} />

        {/* 3. 窗口使用率 + mini bar */}
        <div>
          <div className="flex justify-between text-gm-2xs mb-gm-1">
            <span className="text-text-muted">窗口使用率</span>
            <span
              className={
                usagePct > 90 ? "text-danger font-semibold" : "text-text"
              }
            >
              ~{estimatedUsed} / {windowSize} token
            </span>
          </div>
          <div className="h-1_5 rounded-full bg-surface-lowered overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                usagePct > 90
                  ? "bg-danger"
                  : usagePct > 70
                    ? "bg-warning"
                    : "bg-success"
              }`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <p className="text-gm-2xs text-text-muted mt-gm-1">
            {usagePct > 90
              ? "⚠ 窗口紧张，overflow 可能触发"
              : `${usagePct}% 使用率`}
          </p>
        </div>

        {/* 4. 30 天保留率 */}
        <div>
          <div className="flex justify-between text-gm-2xs mb-gm-1">
            <span className="text-text-muted">30 天保留率</span>
            <span className="text-text font-semibold">{retentionPct}%</span>
          </div>
          <div className="h-1_5 rounded-full bg-surface-lowered overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.max(retentionPct, 2)}%` }}
            />
          </div>
          <p className="text-gm-2xs text-text-muted mt-gm-1">
            λ = {lambda} · e<sup>-λ·720h</sup>
          </p>
        </div>
      </div>
    </CollapsibleSection>
    </div>
  );
}

/** 单行投影展示——标签 + 值。 */
function ProjectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-gm-2">
      <span className="text-gm-2xs text-text-muted shrink-0">{label}</span>
      <span className="text-gm-2xs text-text text-right">{value}</span>
    </div>
  );
}

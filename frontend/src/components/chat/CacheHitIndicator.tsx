/**
 * CacheHitIndicator — 语义缓存命中指示器。
 *
 * 当 ChatResponse.from_cache === true 时显示绿色闪电图标 +
 * "缓存命中 · 相似度 97%" 文案，让用户感知响应来源（绕过 LLM 全管线）。
 *
 * @module components/chat/CacheHitIndicator
 */

"use client";

export default function CacheHitIndicator({
  similarity,
}: {
  similarity: number;
}) {
  const pct = Math.round(similarity * 100);

  return (
    <span
      role="status"
      aria-label="缓存命中指示器"
      className="inline-flex items-center gap-gm-1 text-gm-xs text-success select-none"
      data-testid="cache-hit-indicator"
      title={`语义缓存命中 — 与历史查询的相似度为 ${pct}%`}
    >
      <i
        className="ri-flashlight-line text-gm-icon"
      />
      <span>缓存命中 · 相似度 {pct}%</span>
    </span>
  );
}

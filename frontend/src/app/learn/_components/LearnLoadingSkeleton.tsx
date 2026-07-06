/**
 * LearnLoadingSkeleton — ContentDashboard 布局匹配的加载骨架。
 *
 * 在 /learn 页面数据加载期间（Suspense fallback）渲染，
 * 布局与 ContentDashboard 对齐以消除布局偏移（CLS）。
 *
 * B63 细化：微光动画（gm-shimmer）替代 pulse，更现代流畅。
 *
 * 四区段：
 *   1. 环形进度 placeholder（SVG circle + 文字占位）
 *   2. 继续阅读 placeholder（匹配 ContentDashboard 的 CTA 卡片）
 *   3. 8 条章节行骨架（微光动画）
 *   4. 推荐阅读占位行
 */
export default function LearnLoadingSkeleton() {
  return (
    <div
      className="flex flex-col items-center gap-gm-5 w-full max-w-3xl mx-auto py-gm-6"
      data-testid="learn-loading-skeleton"
      role="status"
      aria-label="内容加载中"
      aria-busy="true"
    >
      {/* ── 环形总进度 placeholder ── */}
      <div className="flex items-center gap-gm-6 w-full">
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-surface-alt"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-12 h-7 rounded-gm-sm gm-skeleton-shimmer" />
          </div>
        </div>
        <div className="flex flex-col gap-gm-1_5 flex-1">
          <div className="w-24 h-5 rounded-gm-sm gm-skeleton-shimmer" />
          <div className="w-36 h-3.5 rounded-gm-sm gm-skeleton-shimmer" />
          <div className="w-28 h-3.5 rounded-gm-sm gm-skeleton-shimmer" />
        </div>
      </div>

      {/* ── 继续阅读 CTA placeholder（匹配 ContentDashboard 布局）── */}
      <div className="w-full rounded-gm-lg border border-brand/20 bg-brand/5 px-gm-4 py-gm-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-gm-2">
            <div className="w-gm-icon-md h-gm-icon-md rounded-gm-sm gm-skeleton-shimmer" />
            <div className="w-28 h-4 rounded-gm-sm gm-skeleton-shimmer" />
          </div>
          <div className="w-16 h-4 rounded-gm-sm gm-skeleton-shimmer" />
        </div>
      </div>

      {/* ── 8 条章节行骨架 ── */}
      <div className="w-full space-y-gm-2_5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-gm-3 px-gm-4 py-gm-3 rounded-gm-lg bg-surface-elevated border border-border"
          >
            {/* icon placeholder */}
            <div className="w-gm-icon-md h-gm-icon-md rounded-gm-sm gm-skeleton-shimmer flex-shrink-0" />
            {/* title + progress bar */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-gm-1">
                <div className="w-32 h-4 rounded-gm-sm gm-skeleton-shimmer" />
                <div className="w-8 h-3 rounded-gm-sm gm-skeleton-shimmer ml-gm-2 flex-shrink-0" />
              </div>
              <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full gm-skeleton-shimmer"
                  style={{ width: `${15 + (i % 5) * 12}%` }}
                />
              </div>
            </div>
            {/* status placeholder */}
            <div className="flex-shrink-0 w-16">
              <div className="w-8 h-3.5 rounded-gm-sm gm-skeleton-shimmer ml-auto" />
            </div>
          </div>
        ))}
      </div>

      {/* ── 推荐阅读占位行 ── */}
      <div className="w-full rounded-gm-lg border border-border bg-surface-elevated px-gm-4 py-gm-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-gm-2">
            <div className="w-gm-icon-md h-gm-icon-md rounded-gm-sm gm-skeleton-shimmer" />
            <div className="w-20 h-4 rounded-gm-sm gm-skeleton-shimmer" />
          </div>
          <div className="w-4 h-4 rounded-gm-sm gm-skeleton-shimmer" />
        </div>
        <div className="mt-gm-1">
          <div className="w-56 h-3.5 rounded-gm-sm gm-skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}

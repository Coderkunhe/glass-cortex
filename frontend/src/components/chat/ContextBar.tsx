import type { ContextMeta } from "@/lib/api/types";

interface ContextBarProps {
  meta: ContextMeta;
}

interface Segment {
  label: string;
  tokens: number;
  color: string;
  /** When true, this segment is a reduction from a larger original value */
  compressed?: boolean;
  originalTokens?: number;
}

/** 上下文窗口分区占比水平条 — 增强版。
 *
 * 在基础四色条上新增：
 * - 溢出切断线（虚线标记分隔 recall / 保留区）
 * - 压缩节省气泡（memories_token_before > memories_token_after 时显示）
 * - 工具段（透传 tools_tokens）
 * - hover tooltip 详细 breakdown
 */
export default function ContextBar({ meta }: ContextBarProps) {
  const {
    window_size,
    base_tokens,
    memories_token_before,
    memories_token_after,
    user_message_tokens,
    total_estimated_tokens,
    overflow_applied,
    dropped_count,
  } = meta;
  const toolsTokens = (meta as Record<string, unknown>).tools_tokens as number | undefined;

  const free = Math.max(0, window_size - total_estimated_tokens);
  const usagePct = window_size > 0 ? Math.round((total_estimated_tokens / window_size) * 100) : 0;
  const compressed =
    memories_token_before > 0 && memories_token_before > memories_token_after;
  const saved = Math.max(0, memories_token_before - memories_token_after);

  const segments: Segment[] = [
    { label: "system", tokens: base_tokens, color: "bg-text-muted" },
    {
      label: "recall",
      tokens: memories_token_after,
      color: "bg-brand",
      compressed,
      originalTokens: memories_token_before,
    },
    { label: "消息", tokens: user_message_tokens, color: "bg-success" },
  ];

  if (toolsTokens != null && toolsTokens > 0) {
    segments.push({ label: "tools", tokens: toolsTokens, color: "bg-warning" });
  }

  segments.push({ label: "空闲", tokens: free, color: "bg-transparent" });

  const visible = segments.filter((s) => s.tokens > 0 || s.label === "空闲");

  return (
    <div>
      {/* 水平分段条 */}
      <div className="flex h-2 rounded-gm-xs overflow-hidden bg-bg-subtle">
        {visible.map((seg, i) => {
          const widthPct = window_size > 0 ? (seg.tokens / window_size) * 100 : 0;
          if (widthPct <= 0) return null;

          // Recall 段：若压缩，画虚线切断标记在前
          const isRecall = seg.label === "recall";
          const showCut = isRecall && overflow_applied && dropped_count > 0;

          const segTipId = `cb-seg-${seg.label}`;
          const cutTipId = `cb-cut-${seg.label}`;
          const segTip =
            seg.compressed
              ? `${seg.label}: ${seg.tokens.toLocaleString()} tokens（压缩前 ${seg.originalTokens?.toLocaleString()}，节省 ${saved.toLocaleString()}）`
              : `${seg.label}: ${seg.tokens.toLocaleString()} tokens`;

          return (
            <div
              key={seg.label}
              className={`relative group h-full ${seg.color} ${seg.label === "空闲" ? "" : "min-w-[2px]"} focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none rounded-gm-xs`}
              style={{ width: `${widthPct}%` }}
              tabIndex={0}
              role="button"
              aria-describedby={segTipId}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).click();
                }
              }}
            >
              {/* 键盘可达 tooltip — hover + focus 均可见 */}
              <span
                id={segTipId}
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-gm-1 px-gm-2 py-gm-0_5 rounded-gm-sm bg-text text-text-inverse text-gm-xs whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                style={{ zIndex: "var(--gm-z-overlay, 60)" }}
              >
                {segTip}
              </span>

              {/* 溢出切断线 — 虚线标记 drop 边界 */}
              {showCut && i < visible.length - 1 && (
                <span
                  className="absolute right-0 top-0 bottom-0 w-px border-r border-dashed border-text/30"
                  tabIndex={0}
                  role="button"
                  aria-describedby={cutTipId}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                >
                  <span
                    id={cutTipId}
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full right-0 mb-gm-1 px-gm-2 py-gm-0_5 rounded-gm-sm bg-text text-text-inverse text-gm-xs whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    style={{ zIndex: "var(--gm-z-overlay, 60)" }}
                  >
                    此处截断，丢弃 {dropped_count} 条
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 标注 + 压缩/溢出徽章 */}
      <div className="flex flex-wrap gap-gm-2 mt-gm-1 text-gm-xs text-text-muted items-center">
        <span>
          <span className="text-text font-medium">{total_estimated_tokens.toLocaleString()}</span>
          {" / "}
          {window_size.toLocaleString()} tokens ({usagePct}%)
        </span>
        <span className="flex items-center gap-gm-1">
          <span className="inline-block w-2 h-2 rounded-full bg-text-muted" />
          system&nbsp;{base_tokens.toLocaleString()}
        </span>
        <span className="flex items-center gap-gm-1">
          <span className="inline-block w-2 h-2 rounded-full bg-brand" />
          recall&nbsp;{memories_token_after.toLocaleString()}
        </span>
        <span className="flex items-center gap-gm-1">
          <span className="inline-block w-2 h-2 rounded-full bg-success" />
          消息&nbsp;{user_message_tokens.toLocaleString()}
        </span>
        {toolsTokens != null && toolsTokens > 0 && (
          <span className="flex items-center gap-gm-1">
            <span className="inline-block w-2 h-2 rounded-full bg-warning" />
            tools&nbsp;{toolsTokens.toLocaleString()}
          </span>
        )}
        {free > 0 && (
          <span className="flex items-center gap-gm-1">
            <span className="inline-block w-2 h-2 rounded-full border border-border-light bg-transparent" />
            空闲&nbsp;{free.toLocaleString()}
          </span>
        )}

        {/* 压缩节省徽章 */}
        {compressed && (
          <span className="inline-flex items-center gap-gm-0_5 rounded-gm-xs bg-success/10 px-gm-1_5 py-gm-0_5 text-success font-medium">
            📦 节省 {saved.toLocaleString()}
          </span>
        )}

        {/* 溢出徽章 */}
        {overflow_applied && dropped_count > 0 && (
          <span className="inline-flex items-center gap-gm-0_5 rounded-gm-xs bg-warning/10 px-gm-1_5 py-gm-0_5 text-warning font-medium">
            ⚠️ 溢出 {dropped_count} 条
          </span>
        )}
      </div>
    </div>
  );
}

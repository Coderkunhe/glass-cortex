/**
 * Observability 域内共享工具函数。
 *
 * Phase 1000 B109 从 LogViewer/LogDetailModal（levelColor）
 * 和 HealthCard/StepLatencyCard（latencyColor）消除双副本 DRY 违例。
 * 对标 B88 lib/ 共享提取模式，但保持在 observability 域内（不提升到 lib/）。
 */

/** 日志级别 → Tailwind 文字颜色 class */
export function levelColor(level: string): string {
  switch (level) {
    case "DEBUG":
      return "text-text-muted";
    case "INFO":
      return "text-info";
    case "WARNING":
      return "text-warning";
    case "ERROR":
    case "PARSE_ERROR":
      return "text-danger";
    default:
      return "text-text-secondary";
  }
}

/** 延迟着色：<50ms 绿, 50-200ms 橙, >200ms 红 */
export function latencyColor(ms: number): string {
  if (ms < 50) return "text-success";
  if (ms <= 200) return "text-warning";
  return "text-danger";
}

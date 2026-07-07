/**
 * 相对时间格式化工具。
 *
 * 将毫秒时间戳转换为中文相对时间字符串，
 * 用于聊天消息时间戳显示。
 *
 * @module lib/formatTime
 */

/** 将时间戳转换为中文相对时间描述 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;

  // 时钟偏差保护：未来时间视为"刚刚"
  if (diffMs < 0) return "刚刚";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "刚刚";

  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1分钟前";
  if (minutes < 60) return `${minutes}分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1小时前";
  if (hours < 24) return `${hours}小时前`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;

  // 超过 7 天 → 显示绝对日期
  const d = new Date(timestamp);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}月${day}日`;
}

/**
 * 格式化毫秒数为人类可读字符串。
 *
 * ≥1000ms → "1.2s"；<1000ms → "500ms"。
 * 用于 PipelineTracePanel、StepLatencyPanel、ExperimentComparePanel 等面板。
 */
export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * 格式化 Unix 时间戳（秒）为中文可读日期。
 *
 * 返回 `toLocaleString("zh-CN")` 格式，null/0/负数返回 "N/A"。
 * 用于 PipelineTracePanel、JourneyHistoryBrowser、MemoryBrowserPanel 等面板。
 */
export function fmtTimestamp(ts: number | null): string {
  if (!ts || ts <= 0) return "N/A";
  return new Date(ts * 1000).toLocaleString("zh-CN");
}

/**
 * 将字节数格式化为人类可读的字符串表示。
 *
 * 对标 B88 formatNum / formatTime 共享 lib 模式。
 * 原实现分别在 ProfileShell.tsx 和 LogViewer.tsx 中完全重复，
 * Phase 1000 B108 提取至此以消除 DRY 违例。
 *
 * @param bytes - 原始字节数
 * @returns 格式化字符串，如 "1.5 KB"、"200 B"、"3.2 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeTime } from "@/lib/formatTime";

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 在指定时间戳创建消息，当前时间固定为 2026-07-03 12:00:00 UTC */
  const NOW = new Date("2026-07-03T12:00:00Z").getTime();

  it('returns "刚刚" for timestamps within the last 60 seconds', () => {
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(NOW - 0)).toBe("刚刚");
    expect(formatRelativeTime(NOW - 30_000)).toBe("刚刚");
    expect(formatRelativeTime(NOW - 59_000)).toBe("刚刚");
  });

  it("returns correct minute string for timestamps less than 1 hour ago", () => {
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(NOW - 60_000)).toBe("1分钟前");
    expect(formatRelativeTime(NOW - 5 * 60_000)).toBe("5分钟前");
    expect(formatRelativeTime(NOW - 59 * 60_000)).toBe("59分钟前");
  });

  it("returns correct hour string for timestamps less than 24 hours ago", () => {
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(NOW - 3600_000)).toBe("1小时前");
    expect(formatRelativeTime(NOW - 3 * 3600_000)).toBe("3小时前");
    expect(formatRelativeTime(NOW - 23 * 3600_000)).toBe("23小时前");
  });

  it('returns "昨天" for timestamps 24-48 hours ago', () => {
    vi.setSystemTime(NOW);
    const yesterday = NOW - 24 * 3600_000;
    expect(formatRelativeTime(yesterday)).toBe("昨天");
  });

  it("returns correct day string for timestamps 2-6 days ago", () => {
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(NOW - 2 * 24 * 3600_000)).toBe("2天前");
    expect(formatRelativeTime(NOW - 6 * 24 * 3600_000)).toBe("6天前");
  });

  it("returns absolute date for timestamps 7+ days ago", () => {
    vi.setSystemTime(NOW);
    // July 3 - 7 days = June 26
    const oldDate = NOW - 7 * 24 * 3600_000;
    expect(formatRelativeTime(oldDate)).toBe("6月26日");
  });

  it('returns "刚刚" for future timestamps (clock skew guard)', () => {
    vi.setSystemTime(NOW);
    expect(formatRelativeTime(NOW + 60_000)).toBe("刚刚");
  });
});

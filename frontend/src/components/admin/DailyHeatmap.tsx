"use client";

/**
 * DailyHeatmap — 日报热力图。
 *
 * GitHub 贡献图式 7×N 热力格子，一格子一天。
 * 从 allDocs DocListItem[] 中提取日报目录，按日期映射渲染。
 * 颜色深浅代表日报存在/缺失，今日高亮 ring。
 *
 * Phase 69 Batch 2：工程过程数据可视化第一组件。
 *
 * @module components/admin/DailyHeatmap
 */

import { useMemo } from "react";
import type { DocListItem } from "@/lib/api/types";

// ── 类型 ──────────────────────────────────────────────────────────────

interface HeatCell {
  date: string;
  day: number;
  isToday: boolean;
  hasReport: boolean;
  lines: number;
}

interface HeatWeek {
  cells: (HeatCell | null)[];
}

// ── 常量 ──────────────────────────────────────────────────────────────

/** 只在偶数行显示星期标签（一三五日），对标 GitHub 风格 */
const WEEKDAY_LABELS = ["一", "", "三", "", "五", "", "日"];

const MONTH_NAMES = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];

/** 热力图回溯月数 */
const HEATMAP_MONTHS = 12;

/** 单元格尺寸 (px) — Tailwind 不生成动态尺寸，用 inline style */
const CELL_SIZE = 12;
const CELL_GAP = 2;

// ── 日期工具 ──────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ── Props ─────────────────────────────────────────────────────────────

interface DailyHeatmapProps {
  docs: DocListItem[];
}

// ═══════════════════════════════════════════════════════════════════════
// DailyHeatmap
// ═══════════════════════════════════════════════════════════════════════

export default function DailyHeatmap({ docs }: DailyHeatmapProps) {
  const result = useMemo(() => {
    // 1. 找到日报目录
    const dailyDir = docs.find(
      (d) => d.is_directory && d.name === "daily" && d.group === "日报"
    );
    if (!dailyDir?.children?.length) return null;

    // 2. date → DocListItem
    const dateMap = new Map<string, DocListItem>();
    for (const child of dailyDir.children) {
      const m = child.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (m) dateMap.set(m[1], child);
    }

    if (dateMap.size === 0) return null;

    const dates = Array.from(dateMap.keys()).sort();
    const firstDate = dates[0];
    const now = new Date();
    const today = formatDate(now);

    // 3. 起始：最早日报 vs 12 个月前，取更早的，对齐到周一
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - HEATMAP_MONTHS + 1, 1);
    let start = parseDate(firstDate) > twelveMonthsAgo ? parseDate(firstDate) : twelveMonthsAgo;
    const startDow = start.getDay(); // 0=Sun
    const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + mondayOffset);

    // 4. 结束：昨天
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

    // 5. 构建周网格 + 月份标签
    const weeks: HeatWeek[] = [];
    const monthLabels: { label: string; weekIndex: number }[] = [];
    let cursor = new Date(start);
    let lastMonth = -1;

    while (cursor <= end) {
      const cells: (HeatCell | null)[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + dow);
        const dateStr = formatDate(d);

        if (d > end) {
          cells.push(null);
        } else {
          if (d.getMonth() !== lastMonth && d.getDate() <= 7) {
            lastMonth = d.getMonth();
            monthLabels.push({ label: MONTH_NAMES[lastMonth], weekIndex: weeks.length });
          }
          const hasReport = dateMap.has(dateStr);
          cells.push({
            date: dateStr,
            day: d.getDate(),
            isToday: dateStr === today,
            hasReport,
            lines: hasReport ? (dateMap.get(dateStr)?.lines ?? 0) : 0,
          });
        }
      }
      weeks.push({ cells });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    }

    return { weeks, monthLabels, totalDays: dateMap.size };
  }, [docs]);

  // ── 空态 ──
  if (!result) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-5 text-center">
        <p className="text-gm-xs text-text-muted">暂无日报数据</p>
      </div>
    );
  }

  const { weeks, monthLabels, totalDays } = result;

  return (
    <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
      {/* 标题栏 */}
      <div className="px-gm-5 py-gm-3 border-b border-border flex items-center justify-between">
        <h2 className="text-gm-sm font-semibold text-text">日报热力图</h2>
        <span className="text-gm-xs text-text-muted">{totalDays} 篇日报</span>
      </div>

      <div className="p-gm-5">
        <div className="overflow-x-auto">
          <div className="inline-flex flex-col min-w-fit">
            {/* 月份标签 */}
            <MonthRow weeks={weeks} monthLabels={monthLabels} />

            {/* 主体 */}
            <div className="flex">
              {/* 星期标签 */}
              <div
                className="flex flex-col shrink-0 pr-gm-1.5 select-none"
                style={{ gap: CELL_GAP }}
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <span
                    key={i}
                    className="text-gm-2xs text-text-muted leading-none flex items-center justify-end w-5"
                    style={{ height: CELL_SIZE }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* 格子矩阵 */}
              <div className="flex" style={{ gap: CELL_GAP }}>
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col" style={{ gap: CELL_GAP }}>
                    {week.cells.map((cell, ci) =>
                      cell ? (
                        <div
                          key={ci}
                          title={`${cell.date}${cell.hasReport ? ` · ${cell.lines} 行` : " · 无日报"}`}
                          className={`rounded-sm transition-colors ${
                            cell.hasReport
                              ? "bg-brand/70 hover:bg-brand"
                              : "bg-surface-alt/40"
                          } ${cell.isToday ? "ring-1 ring-brand ring-offset-1 ring-offset-bg" : ""}`}
                          style={{ width: CELL_SIZE, height: CELL_SIZE }}
                        />
                      ) : (
                        <div
                          key={ci}
                          style={{ width: CELL_SIZE, height: CELL_SIZE }}
                        />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 图例 */}
            <div className="flex items-center gap-gm-1.5 mt-gm-2 ml-gm-6 text-gm-2xs text-text-muted select-none">
              <span>无</span>
              <div className="rounded-sm bg-surface-alt/40" style={{ width: CELL_SIZE, height: CELL_SIZE }} />
              <div className="rounded-sm bg-brand/70" style={{ width: CELL_SIZE, height: CELL_SIZE }} />
              <span>有</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MonthRow — 月份标签行
// ═══════════════════════════════════════════════════════════════════════

function MonthRow({
  weeks,
  monthLabels,
}: {
  weeks: HeatWeek[];
  monthLabels: { label: string; weekIndex: number }[];
}) {
  if (monthLabels.length === 0) return null;

  // 计算每个月的起始像素偏移
  const items = monthLabels.map((ml, i) => {
    const nextIdx = i + 1 < monthLabels.length ? monthLabels[i + 1].weekIndex : weeks.length;
    const spanWeeks = nextIdx - ml.weekIndex;
    return { ...ml, spanWeeks };
  });

  const weekWidth = CELL_SIZE + CELL_GAP;

  return (
    <div
      className="text-gm-2xs text-text-muted mb-gm-1 select-none flex"
      style={{ paddingLeft: 20 + CELL_GAP + CELL_GAP }} // 星期标签宽度 + gap
    >
      {items.map((item) => (
        <span
          key={`${item.label}-${item.weekIndex}`}
          className="shrink-0 overflow-visible"
          style={{ width: item.spanWeeks * weekWidth - CELL_GAP }}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}

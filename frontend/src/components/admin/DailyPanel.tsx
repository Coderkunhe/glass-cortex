"use client";

/**
 * DailyPanel — 日报日历面板。
 *
 * 从最早日报到今天的完整日期网格，每月一个 7 列日历。
 * 有日报的日期高亮可点击（显示行数 + 文件大小），无日报的日期灰暗。
 * 日期范围动态计算，不硬编码。
 *
 * @module components/admin/DailyPanel
 */

import { useState, useEffect } from "react";
import { api } from "@/lib/api/client";
import { fmtBytes } from "./utils";
import type { DocListItem } from "@/lib/api/types";

// ── 类型 ────────────────────────────────────────────────────────────────

interface DayCell {
  /** "YYYY-MM-DD" */
  date: string;
  /** 几号 (1-31) */
  day: number;
  isToday: boolean;
  hasReport: boolean;
  item: DocListItem | null;
}

interface MonthGrid {
  year: number;
  /** 0-indexed */
  month: number;
  weeks: (DayCell | null)[][];
}

// ── 常量 ────────────────────────────────────────────────────────────────

/** 周标题 — 中文单字，周一始 */
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 月份名称 */
const MONTH_FORMAT = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" });

// ── 纯函数：日期工具 ───────────────────────────────────────────────────

/** "2026-08-07" → Date (local) */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date → "2026-08-07" */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 某月第一天 */
function startOfMonth(y: number, m: number): Date {
  return new Date(y, m, 1);
}

/** 某月天数 */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/**
 * 提取日报数据：从 API 返回的 DocListItem[] 中找到 group="日报" 的目录项，
 * 取出 children，构建日期→DocListItem 映射。
 * 同时计算最早日期和今天。
 */
function extractDailyData(
  items: DocListItem[]
): { dailyMap: Map<string, DocListItem>; firstDate: string; today: string } | null {
  const dailyDir = items.find(
    (item) => item.is_directory && item.group === "日报"
  );
  if (!dailyDir || !dailyDir.children || dailyDir.children.length === 0) {
    return null;
  }

  const dailyMap = new Map<string, DocListItem>();
  let firstDate = "";

  for (const child of dailyDir.children) {
    // 从文件名解析日期："2026-08-07.md" → "2026-08-07"
    const dateStr = child.name.slice(0, 10);
    dailyMap.set(dateStr, child);

    if (!firstDate || dateStr < firstDate) {
      firstDate = dateStr;
    }
  }

  const today = formatDate(new Date());

  return { dailyMap, firstDate, today };
}

/**
 * 生成指定月份的日历网格。
 * 周一始，含前导/后置空白补齐完整周。
 */
function buildMonthGrid(
  year: number,
  month: number,
  dailyMap: Map<string, DocListItem>,
  today: string
): MonthGrid {
  const firstDay = new Date(year, month, 1);
  // getDay(): 0=Sun … 6=Sat → Monday-start offset: (getDay()+6)%7
  const startPad = (firstDay.getDay() + 6) % 7;
  const totalDays = daysInMonth(year, month);

  const cells: (DayCell | null)[] = [];

  // 前导空白
  for (let i = 0; i < startPad; i++) {
    cells.push(null);
  }

  // 当月每一天
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      date: dateStr,
      day: d,
      isToday: dateStr === today,
      hasReport: dailyMap.has(dateStr),
      item: dailyMap.get(dateStr) ?? null,
    });
  }

  // 后置补齐
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  // 切分为周
  const weeks: (DayCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return { year, month, weeks };
}

/** 生成从 firstDate 所在月到 today 所在月，每个月的 MonthGrid */
function buildAllMonths(
  firstDate: string,
  today: string,
  dailyMap: Map<string, DocListItem>
): MonthGrid[] {
  const [firstYear, firstMonth] = firstDate.split("-").map(Number);
  const start = startOfMonth(firstYear, firstMonth - 1);
  const end = parseDate(today);

  const months: MonthGrid[] = [];
  const cursor = new Date(start);

  while (cursor.getFullYear() < end.getFullYear() ||
    (cursor.getFullYear() === end.getFullYear() && cursor.getMonth() <= end.getMonth())) {
    months.push(
      buildMonthGrid(
        cursor.getFullYear(),
        cursor.getMonth(),
        dailyMap,
        today
      )
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

// ═══════════════════════════════════════════════════════════════════════════
// DailyPanel — 主组件
// ═══════════════════════════════════════════════════════════════════════════

export default function DailyPanel({
  onSelectDoc,
}: {
  onSelectDoc: (item: DocListItem) => void;
}) {
  const [months, setMonths] = useState<MonthGrid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await api.getDocs();
        if (cancelled) return;

        const data = extractDailyData(json);
        if (!data) {
          setMonths([]);
          setLoading(false);
          return;
        }

        const grids = buildAllMonths(data.firstDate, data.today, data.dailyMap);
        setMonths(grids);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Loading ──
  if (loading) {
    return (
      <div className="space-y-gm-6 overflow-y-auto">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="w-32 h-5 rounded-gm-sm gm-skeleton-shimmer mb-gm-3" />
            <div className="grid grid-cols-7 gap-gm-1">
              {Array.from({ length: 7 }).map((_, j) => (
                <div
                  key={j}
                  className="w-full h-7 rounded-gm-sm gm-skeleton-shimmer"
                />
              ))}
              {Array.from({ length: 28 }).map((_, j) => (
                <div
                  key={`d-${j}`}
                  className="aspect-square rounded-gm-sm gm-skeleton-shimmer"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">日报数据加载失败</p>
        <p className="text-gm-xs text-red-500 mt-gm-1">{error}</p>
      </div>
    );
  }

  // ── Empty ──
  if (months.length === 0) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">暂无日报</p>
      </div>
    );
  }

  // ── Data ──
  return (
    <div className="space-y-gm-6 overflow-y-auto">
      {months.map((grid) => (
        <MonthCalendar key={`${grid.year}-${grid.month}`} grid={grid} onSelectDoc={onSelectDoc} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MonthCalendar — 单月日历
// ═══════════════════════════════════════════════════════════════════════════

function MonthCalendar({
  grid,
  onSelectDoc,
}: {
  grid: MonthGrid;
  onSelectDoc: (item: DocListItem) => void;
}) {
  const monthLabel = MONTH_FORMAT.format(new Date(grid.year, grid.month, 1));

  return (
    <div className="rounded-gm-lg bg-surface-elevated border border-border shadow-gm-sm overflow-hidden">
      {/* 月份标题 */}
      <div className="px-gm-5 py-gm-3 border-b border-border bg-surface-alt/30">
        <h3 className="text-gm-sm font-semibold text-text">{monthLabel}</h3>
      </div>

      {/* 周标题 */}
      <div className="grid grid-cols-7 border-b border-border bg-surface-alt/20">
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label}
            className={`text-center py-gm-2 text-gm-xs font-medium ${
              i >= 5 ? "text-text-muted/60" : "text-text-muted"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid grid-cols-7 gap-px bg-border">
        {grid.weeks.flat().map((cell, idx) =>
          cell ? (
            <DayCell
              key={cell.date}
              cell={cell}
              onClick={
                cell.hasReport
                  ? () => onSelectDoc(cell.item!)
                  : undefined
              }
            />
          ) : (
            <div key={`pad-${idx}`} className="bg-surface-elevated" />
          )
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DayCell — 单个日期格子
// ═══════════════════════════════════════════════════════════════════════════

function DayCell({
  cell,
  onClick,
}: {
  cell: DayCell;
  onClick?: () => void;
}) {
  const base =
    "flex flex-col gap-gm-0_5 p-gm-2 bg-surface-elevated min-h-[4.5rem] transition-colors";

  if (!cell.hasReport) {
    return (
      <div className={`${base} text-text-muted/30 select-none`}>
        <span className="text-gm-xs tabular-nums">{cell.day}</span>
      </div>
    );
  }

  const isToday = cell.isToday;
  const containerClass = [
    base,
    "cursor-pointer hover:bg-brand-50/30",
    isToday ? "ring-2 ring-brand ring-inset rounded-gm-sm relative z-10" : "",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={containerClass}
    >
      {/* 日期数字 */}
      <span
        className={`text-gm-sm font-semibold tabular-nums leading-none ${
          isToday ? "text-brand" : "text-text"
        }`}
      >
        {cell.day}
      </span>

      {/* 元信息：行数 + 文件大小 */}
      {cell.item && (
        <div className="flex flex-col gap-gm-0_5 mt-auto">
          <span className="text-gm-2xs text-text-muted leading-none">
            {cell.item.lines} 行
          </span>
          <span className="text-gm-2xs text-text-muted/60 leading-none">
            {fmtBytes(cell.item.size_bytes)}
          </span>
        </div>
      )}
    </button>
  );
}

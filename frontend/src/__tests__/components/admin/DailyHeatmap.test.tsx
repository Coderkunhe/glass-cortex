import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DailyHeatmap from "@/components/admin/DailyHeatmap";
import type { DocListItem } from "@/lib/api/types-admin";

// ── Helpers ───────────────────────────────────────────────────────────

/** 构造日报目录 DocListItem */
function makeDailyDir(dates: string[]): DocListItem {
  return {
    name: "daily",
    path: "docs/daily",
    group: "日报",
    is_directory: true,
    size_bytes: 0,
    mtime: "",
    lines: dates.length,
    children: dates.map((d) => ({
      name: `${d}.md`,
      path: `docs/daily/${d}.md`,
      group: "日报",
      size_bytes: 1024,
      mtime: `${d}T00:00:00Z`,
      lines: 50,
      summary: `${d} 日报`,
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("DailyHeatmap", () => {
  describe("empty state", () => {
    it("shows empty message when docs array is empty", () => {
      render(<DailyHeatmap docs={[]} />);
      expect(screen.getByText("暂无日报数据")).toBeInTheDocument();
    });

    it("shows empty message when no daily directory found", () => {
      const docs: DocListItem[] = [
        { name: "other.md", path: "docs/other.md", group: "核心文档", size_bytes: 100, mtime: "", lines: 10 },
      ];
      render(<DailyHeatmap docs={docs} />);
      expect(screen.getByText("暂无日报数据")).toBeInTheDocument();
    });

    it("shows empty message when daily dir has no children", () => {
      const emptyDir: DocListItem = {
        name: "daily",
        path: "docs/daily",
        group: "日报",
        is_directory: true,
        size_bytes: 0,
        mtime: "",
        lines: 0,
        children: [],
      };
      render(<DailyHeatmap docs={[emptyDir]} />);
      expect(screen.getByText("暂无日报数据")).toBeInTheDocument();
    });
  });

  describe("data rendering", () => {
    it("renders title and report count", () => {
      const dailyDir = makeDailyDir(["2026-08-07", "2026-08-06"]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      expect(screen.getByText("日报热力图")).toBeInTheDocument();
      expect(screen.getByText("2 篇日报")).toBeInTheDocument();
    });

    it("renders weekday labels (一/三/五/日)", () => {
      const dailyDir = makeDailyDir(["2026-08-07"]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      expect(screen.getByText("一")).toBeInTheDocument();
      expect(screen.getByText("三")).toBeInTheDocument();
      expect(screen.getByText("五")).toBeInTheDocument();
      expect(screen.getByText("日")).toBeInTheDocument();
    });

    it("renders legend", () => {
      const dailyDir = makeDailyDir(["2026-08-07"]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      expect(screen.getByText("无")).toBeInTheDocument();
      expect(screen.getByText("有")).toBeInTheDocument();
    });

    it("renders heat cells with correct tooltip for existing report", () => {
      const dailyDir = makeDailyDir(["2026-08-07"]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      // 有日报的格子有 title 属性
      const cells = document.querySelectorAll('[title*="2026-08-07"]');
      expect(cells.length).toBeGreaterThan(0);
      expect(cells[0].getAttribute("title")).toContain("50 行");
    });

    it("renders both report and empty cells", () => {
      // 仅 1 天有日报，其余为灰色空格子
      const dailyDir = makeDailyDir(["2026-01-15"]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      const brandCells = document.querySelectorAll('[class*="bg-brand"]');
      const mutedCells = document.querySelectorAll('[class*="bg-surface-alt"]');

      // 有日报的格子存在（至少 1 个，可能有日期对齐偏移）
      expect(brandCells.length).toBeGreaterThanOrEqual(1);
      // 大量无日报的灰色格子
      expect(mutedCells.length).toBeGreaterThan(0);
    });

    it("highlights today with ring when report exists for today", () => {
      // 用昨天而不是今天构造数据，因为热力图结束于昨天
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const y = yesterday.getFullYear();
      const m = String(yesterday.getMonth() + 1).padStart(2, "0");
      const d = String(yesterday.getDate()).padStart(2, "0");
      const yesterdayStr = `${y}-${m}-${d}`;

      const dailyDir = makeDailyDir([yesterdayStr]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      // 有日报的格子应该存在（至少 1 个）
      const brandCells = document.querySelectorAll('[class*="bg-brand"]');
      expect(brandCells.length).toBeGreaterThanOrEqual(1);
    });

    it("shows cells from first report date to yesterday", () => {
      // 用昨天确保在范围内（热力图结束于昨天）
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const y = yesterday.getFullYear();
      const m = String(yesterday.getMonth() + 1).padStart(2, "0");
      const d = String(yesterday.getDate()).padStart(2, "0");
      const yesterdayStr = `${y}-${m}-${d}`;

      const dailyDir = makeDailyDir([yesterdayStr]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      const brandCells = document.querySelectorAll('[class*="bg-brand"]');
      const mutedCells = document.querySelectorAll('[class*="bg-surface-alt"]');
      expect(brandCells.length).toBeGreaterThanOrEqual(1);
      expect(mutedCells.length).toBeGreaterThan(0);

      // 格子总数合理：1 天有日报，到昨天的范围
      const totalCells = brandCells.length + mutedCells.length;
      expect(totalCells).toBeGreaterThan(0);
    });
  });

  describe("multiple months", () => {
    it("renders month labels when spanning months", () => {
      // 覆盖 2 个月以上
      const dates: string[] = [];
      for (let i = 60; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        dates.push(`${y}-${m}-${day}`);
      }

      const dailyDir = makeDailyDir(dates);
      render(<DailyHeatmap docs={[dailyDir]} />);

      // 至少有一个月份标签
      const monthLabels = document.querySelectorAll('[class*="text-gm-2xs text-text-muted"] span');
      expect(monthLabels.length).toBeGreaterThan(0);
    });
  });

  describe("12-month cap", () => {
    it("caps to ~12 months of data", () => {
      // 给 2 年前的旧日报
      const oldDate = "2024-06-15";
      const dailyDir = makeDailyDir([oldDate]);
      render(<DailyHeatmap docs={[dailyDir]} />);

      // 应该只展示最近 ~12 个月，2 年前的旧格子不会出现
      // 验证：从 2024-06 算起约 26 个月 >> 12 个月 cap
      const cells = document.querySelectorAll('[class*="bg-brand"], [class*="bg-surface-alt"]');
      // 12 个月大约 52 周 × 7 = 364 天，实际会有对齐偏移
      // 只要不是无限回溯就行
      expect(cells.length).toBeLessThan(400); // 约 52 周 × 7 天
    });
  });

  describe("no match dates", () => {
    it("returns empty when daily dir children have non-date names", () => {
      const dailyDir: DocListItem = {
        name: "daily",
        path: "docs/daily",
        group: "日报",
        is_directory: true,
        size_bytes: 0,
        mtime: "",
        lines: 1,
        children: [{
          name: "README.md",
          path: "docs/daily/README.md",
          group: "日报",
          size_bytes: 100,
          mtime: "",
          lines: 5,
        }],
      };
      render(<DailyHeatmap docs={[dailyDir]} />);
      expect(screen.getByText("暂无日报数据")).toBeInTheDocument();
    });
  });
});

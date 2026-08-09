/**
 * L5TimelineDetail 组件测试。
 *
 * 覆盖：加载/空/数据三态 · 时间轴渲染 · 最近 3 条高亮 · 顺序验证。
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import L5TimelineDetail from "@/components/admin/L5TimelineDetail";
import type { L5HistoryEntry } from "@/lib/api/types";

// ── 测试数据 ──────────────────────────────────────────────────────────

const MOCK_HISTORY: L5HistoryEntry[] = [
  {
    date: "2026-08-08",
    label: "拉通自检",
    phase: 69,
    covered: "B3→B4",
  },
  {
    date: "2026-08-08",
    label: "跨批一致性拉通",
    phase: 69,
    covered: "B1→B2",
  },
  {
    date: "2026-08-07",
    label: "跨批一致性拉通",
    phase: 1000,
    covered: "B140→B141",
  },
  {
    date: "2026-08-05",
    label: "拉通自检",
    phase: 68,
    covered: "B24→B25",
  },
  {
    date: "2026-08-03",
    label: "跨批一致性拉通",
    phase: 68,
    covered: "B22→B23",
  },
];

// ── 渲染辅助 ──────────────────────────────────────────────────────────

function renderTimeline(history: L5HistoryEntry[] | undefined) {
  return render(<L5TimelineDetail history={history} />);
}

afterEach(cleanup);

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe("L5TimelineDetail", () => {
  // ── 加载态 ────────────────────────────────────────────────────────

  describe("loading state", () => {
    it("renders skeleton placeholders when history is undefined", () => {
      renderTimeline(undefined);
      const skeletons = document.querySelectorAll(".gm-skeleton-shimmer");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("does not render the timeline data container", () => {
      renderTimeline(undefined);
      expect(screen.queryByTestId("l5-timeline")).toBeNull();
    });
  });

  // ── 空态 ───────────────────────────────────────────────────────────

  describe("empty state", () => {
    it("shows empty guidance text when history is empty", () => {
      renderTimeline([]);
      expect(screen.getByText("暂无 L5 拉通记录")).toBeInTheDocument();
    });

    it("shows hint about when records will appear", () => {
      renderTimeline([]);
      expect(
        screen.getByText(/首个 Batch 完成后/)
      ).toBeInTheDocument();
    });
  });

  // ── 数据态 — 基本渲染 ──────────────────────────────────────────────

  describe("data rendering", () => {
    it("renders the timeline container", () => {
      renderTimeline(MOCK_HISTORY);
      expect(screen.getByTestId("l5-timeline")).toBeInTheDocument();
    });

    it("shows the review count", () => {
      renderTimeline(MOCK_HISTORY);
      expect(screen.getByText("5 次审查")).toBeInTheDocument();
    });

    it("renders all history entries", () => {
      renderTimeline(MOCK_HISTORY);
      // Two entries share date "2026-08-08" — use getAllByText
      expect(screen.getAllByText("2026-08-08")).toHaveLength(2);
      expect(screen.getByText("2026-08-07")).toBeInTheDocument();
      expect(screen.getByText("2026-08-05")).toBeInTheDocument();
      expect(screen.getByText("2026-08-03")).toBeInTheDocument();
    });

    it("displays phase badges", () => {
      renderTimeline(MOCK_HISTORY);
      expect(screen.getAllByText("Phase 69")).toHaveLength(2);
      expect(screen.getByText("Phase 1000")).toBeInTheDocument();
      expect(screen.getAllByText("Phase 68")).toHaveLength(2);
    });

    it("displays covered batch ranges", () => {
      renderTimeline(MOCK_HISTORY);
      expect(screen.getByText("B3→B4")).toBeInTheDocument();
      expect(screen.getByText("B1→B2")).toBeInTheDocument();
      expect(screen.getByText("B140→B141")).toBeInTheDocument();
    });

    it("displays label text for each entry", () => {
      renderTimeline(MOCK_HISTORY);
      expect(screen.getAllByText("拉通自检")).toHaveLength(2);
      expect(screen.getAllByText("跨批一致性拉通")).toHaveLength(3);
    });
  });

  // ── 最近高亮 ────────────────────────────────────────────────────────

  describe("recent highlight", () => {
    it("renders brand dots for the most recent 3 entries", () => {
      renderTimeline(MOCK_HISTORY);
      const brandDots = document.querySelectorAll(".bg-brand.border-brand");
      // 3 recent entries × 2 classes (bg + border)
      expect(brandDots.length).toBe(3);
    });

    it("renders hollow dots for entries beyond cutoff", () => {
      renderTimeline(MOCK_HISTORY);
      const hollowDots = document.querySelectorAll(
        ".bg-surface-elevated.border-border-strong"
      );
      expect(hollowDots.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 顺序验证 ────────────────────────────────────────────────────────

  describe("entry ordering", () => {
    it("displays most recent entry first (preserves input order)", () => {
      renderTimeline(MOCK_HISTORY);
      const dates = document.querySelectorAll(".font-mono");
      // First font-mono element is the date of the first entry
      expect(dates[0].textContent).toContain("2026-08-08");
    });
  });

  // ── 边界 ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles single-entry history", () => {
      renderTimeline([MOCK_HISTORY[0]]);
      expect(screen.getByTestId("l5-timeline")).toBeInTheDocument();
      expect(screen.getByText("1 次审查")).toBeInTheDocument();
    });

    it("handles entry with empty label gracefully", () => {
      renderTimeline([
        { date: "2026-08-09", label: "", phase: 69, covered: "B4→B5" },
      ]);
      expect(screen.getByTestId("l5-timeline")).toBeInTheDocument();
      // Should not crash — the component renders even with empty label
      expect(screen.getByText("2026-08-09")).toBeInTheDocument();
    });
  });
});

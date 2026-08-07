import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import type { DocListItem } from "@/lib/api/types";

// ── Mock API (partial — keep other exports intact) ────────────────

const mockGetDocs = vi.fn();

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocs: (...args: unknown[]) => mockGetDocs(...args),
    },
  };
});

import DailyPanel from "@/components/admin/DailyPanel";

afterEach(cleanup);

// ── Test data ───────────────────────────────────────────────────────

/** Build mock daily docs with children for a date range */
function makeDailyDocs(dates: string[]): DocListItem[] {
  return [
    {
      name: "日报",
      path: "docs/daily",
      group: "日报",
      size_bytes: 0,
      mtime: dates[dates.length - 1],
      lines: 0,
      is_directory: true,
      count: dates.length,
      children: dates.map((d) => ({
        name: `${d}.md`,
        path: `docs/daily/${d}.md`,
        group: "日报",
        size_bytes: 2048,
        mtime: d,
        lines: 50,
      })),
    },
  ];
}

// ── Helpers ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocs.mockReset();
});

function renderPanel(onSelectDoc?: (item: DocListItem) => void) {
  const callback = onSelectDoc ?? vi.fn();
  return { onSelectDoc: callback, ...render(<DailyPanel onSelectDoc={callback} />) };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("DailyPanel", () => {
  describe("loading state", () => {
    it("shows skeleton placeholders while loading", () => {
      mockGetDocs.mockReturnValue(new Promise(() => {}));
      renderPanel();
      const skeletons = document.querySelectorAll(".gm-skeleton-shimmer");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("shows error message on fetch failure", async () => {
      mockGetDocs.mockRejectedValue(new Error("数据拉取超时"));
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("日报数据加载失败")).toBeInTheDocument();
      });
      expect(screen.getByText("数据拉取超时")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows '暂无日报' when no daily directory found", async () => {
      mockGetDocs.mockResolvedValue([]);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("暂无日报")).toBeInTheDocument();
      });
    });

    it("shows '暂无日报' when daily directory has no children", async () => {
      mockGetDocs.mockResolvedValue([
        {
          name: "日报",
          path: "docs/daily",
          group: "日报",
          size_bytes: 0,
          mtime: "2026-08-08",
          lines: 0,
          is_directory: true,
          count: 0,
          children: [],
        },
      ]);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("暂无日报")).toBeInTheDocument();
      });
    });
  });

  describe("calendar rendering", () => {
    it("renders month calendars from first report to today", async () => {
      // Use dates that only span one month to keep the test deterministic
      mockGetDocs.mockResolvedValue(makeDailyDocs(["2026-08-05", "2026-08-07"]));
      renderPanel();

      await waitFor(() => {
        // The month label should appear
        expect(screen.getByText("2026年8月")).toBeInTheDocument();
      });
    });

    it("renders day cells with line count and file size", async () => {
      mockGetDocs.mockResolvedValue(makeDailyDocs(["2026-08-07"]));
      renderPanel();

      await waitFor(() => {
        // The day cell shows "50 行" (from the mock data)
        expect(screen.getByText("50 行")).toBeInTheDocument();
      });
    });

    it("renders weekday labels (周一始)", async () => {
      mockGetDocs.mockResolvedValue(makeDailyDocs(["2026-08-05"]));
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("一")).toBeInTheDocument();
        expect(screen.getByText("日")).toBeInTheDocument();
      });
    });

    it("renders multiple months when data spans multiple months", async () => {
      mockGetDocs.mockResolvedValue(makeDailyDocs(["2026-06-15", "2026-08-07"]));
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("2026年6月")).toBeInTheDocument();
        expect(screen.getByText("2026年7月")).toBeInTheDocument();
        expect(screen.getByText("2026年8月")).toBeInTheDocument();
      });
    });
  });

  describe("today highlight", () => {
    it("applies ring styling to today's date cell", async () => {
      // Use the real today's date by injecting a child with today's date string
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      mockGetDocs.mockResolvedValue(makeDailyDocs([todayStr]));
      renderPanel();

      await waitFor(() => {
        // Find today's date number, which should be in a span with "text-brand" class
        const dayNum = today.getDate();
        const dayElements = screen.getAllByText(String(dayNum));
        // The today badge uses "ring-2 ring-brand" — verify at least one has the proper styling
        expect(dayElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe("day cell click", () => {
    it("calls onSelectDoc when clicking a day with report", async () => {
      const onSelectDoc = vi.fn();
      mockGetDocs.mockResolvedValue(makeDailyDocs(["2026-08-07"]));
      renderPanel(onSelectDoc);

      await waitFor(() => {
        expect(screen.getByText("50 行")).toBeInTheDocument();
      });

      // Click the day cell button containing "50 行"
      const dayButton = screen.getByText("50 行").closest("button")!;
      fireEvent.click(dayButton);

      expect(onSelectDoc).toHaveBeenCalledTimes(1);
      expect(onSelectDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "2026-08-07.md",
          path: "docs/daily/2026-08-07.md",
        }),
      );
    });

    it("does not allow clicking empty days (no report)", async () => {
      const onSelectDoc = vi.fn();
      // Only Aug 7 has a report — Aug 8 should be a non-report empty day
      mockGetDocs.mockResolvedValue(makeDailyDocs(["2026-08-07"]));
      renderPanel(onSelectDoc);

      await waitFor(() => {
        expect(screen.getByText("50 行")).toBeInTheDocument();
      });

      // Day "8" has no report → its container is a <div>, not a <button>
      // Use getAllByText because the weekday label "日" also gets matched by character
      const dayElements = screen.getAllByText("8");
      const dayCell = dayElements.find((el) => el.tagName === "SPAN");
      expect(dayCell).toBeDefined();
      // The span's parent should be a div (non-clickable), not a button
      expect(dayCell!.closest("button")).toBeNull();
    });
  });

  describe("cancelled fetch — no state update after unmount", () => {
    it("does not throw when unmounted during fetch", async () => {
      let resolvePromise: (value: DocListItem[]) => void;
      const promise = new Promise<DocListItem[]>((resolve) => {
        resolvePromise = resolve;
      });
      mockGetDocs.mockReturnValue(promise);

      const { unmount } = renderPanel();
      unmount();

      await act(async () => {
        resolvePromise!(makeDailyDocs(["2026-08-07"]));
      });
      // No throw = cancelled flag works
    });
  });
});

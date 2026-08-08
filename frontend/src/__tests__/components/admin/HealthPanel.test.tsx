import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import type { AdminHealthResponse } from "@/lib/api/types";

// ── Mock API (partial — keep other exports intact) ────────────────

const mockGetAdminHealth = vi.fn();

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getAdminHealth: (...args: unknown[]) => mockGetAdminHealth(...args),
    },
  };
});

import HealthPanel from "@/components/admin/HealthPanel";

afterEach(cleanup);

// ── Test data ───────────────────────────────────────────────────────

const MOCK_HEALTH: AdminHealthResponse = {
  timestamp: "2026-08-08T00:00:00Z",
  hard_failures: 0,
  current_phase: "1000",
  current_batch: "137",
  recent_commits: [
    "bfc0332 chore(Phase 1000): B135→B137 收盘",
    "88f22dc docs(Phase 1000): B135→B137 文档闭环",
  ],
  l5: {
    batches_since_last: 0,
    last_l5_batch: "B135",
    blocked: false,
  },
  daily: {
    yesterday_exists: true,
    yesterday_date: "2026-08-07",
    today_exists: true,
    today_date: "2026-08-08",
  },
  violations: {
    summary: "📊 违纪统计: 触发日志 8 条 · VIO 活跃 0 条 · 已闭环 1 条",
    is_blocked: false,
  },
  doc_freshness: {
    requirements_last_date: "2026-08-07",
    doc_dates: {},
  },
  checks: {
    "check-docs": {
      exit_code: 0,
      is_critical: true,
      lines: ["✅ check-docs 完成"],
    },
    "check-comments": {
      exit_code: 1,
      is_critical: false,
      lines: ["❌ 缺少 docstring: foo.py:42"],
    },
  },
};

const MOCK_HEALTH_BLOCKED: AdminHealthResponse = {
  ...MOCK_HEALTH,
  hard_failures: 2,
  l5: {
    batches_since_last: 3,
    last_l5_batch: "B132",
    blocked: true,
  },
  violations: {
    summary: "📊 违纪统计: 触发日志 10 条 · VIO 活跃 1 条 (🔴 1 / 🟡 0)",
    is_blocked: true,
  },
  daily: {
    yesterday_exists: false,
    yesterday_date: null,
    today_exists: false,
    today_date: null,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetAdminHealth.mockReset();
});

function renderPanel() {
  return render(<HealthPanel />);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("HealthPanel", () => {
  describe("loading state", () => {
    it("shows skeleton placeholders while loading", () => {
      // Don't resolve — stay in loading state
      mockGetAdminHealth.mockReturnValue(new Promise(() => {}));
      renderPanel();
      // Skeleton shimmer divs should exist
      const skeletons = document.querySelectorAll(".gm-skeleton-shimmer");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("shows error message on fetch failure", async () => {
      mockGetAdminHealth.mockRejectedValue(new Error("网络错误"));
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("仪表盘数据加载失败")).toBeInTheDocument();
      });
      expect(screen.getByText("网络错误")).toBeInTheDocument();
    });
  });

  describe("data rendering", () => {
    it("renders summary cards with health data", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("当前 Phase")).toBeInTheDocument();
      });
      expect(screen.getByText("Phase 1000")).toBeInTheDocument();
      expect(screen.getByText("零阻断")).toBeInTheDocument();
      expect(screen.getByText("今日已写")).toBeInTheDocument();
      expect(screen.getByText("正常")).toBeInTheDocument();
    });

    it("shows warning state when L5 is blocked", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH_BLOCKED);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("⚠️ 已阻断")).toBeInTheDocument();
      });
    });

    it("shows violation blocked state", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH_BLOCKED);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("已阻断")).toBeInTheDocument();
      });
    });

    it("shows hard failure count when > 0", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH_BLOCKED);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("2 项阻断")).toBeInTheDocument();
      });
    });

    it("shows daily missing warning", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH_BLOCKED);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("缺失")).toBeInTheDocument();
      });
    });
  });

  describe("check details", () => {
    it("renders check entries with pass/fail indicators", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("门禁检查明细")).toBeInTheDocument();
      });
      expect(screen.getByText("check-docs")).toBeInTheDocument();
      expect(screen.getByText("check-comments")).toBeInTheDocument();
    });

    it("shows [阻断] tag for critical checks", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("[阻断]")).toBeInTheDocument();
      });
    });

    it("shows check output lines", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("✅ check-docs 完成")).toBeInTheDocument();
      });
    });
  });

  describe("recent commits", () => {
    it("renders recent commits section", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("最近提交")).toBeInTheDocument();
      });
      expect(screen.getByText("bfc0332 chore(Phase 1000): B135→B137 收盘")).toBeInTheDocument();
    });

    it("shows empty message when no commits", async () => {
      mockGetAdminHealth.mockResolvedValue({
        ...MOCK_HEALTH,
        recent_commits: [],
      });
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("无提交记录")).toBeInTheDocument();
      });
    });
  });

  describe("refresh button", () => {
    it("calls getAdminHealth again on refresh click", async () => {
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText("当前 Phase")).toBeInTheDocument();
      });

      // Reset mock to track second call
      mockGetAdminHealth.mockClear();
      mockGetAdminHealth.mockResolvedValue(MOCK_HEALTH);

      const refreshBtn = screen.getByText("刷新");
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(mockGetAdminHealth).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("cancelledRef — no state update after unmount", () => {
    it("does not throw when unmounted during fetch", async () => {
      // Create a promise we control
      let resolvePromise: (value: AdminHealthResponse) => void;
      const promise = new Promise<AdminHealthResponse>((resolve) => {
        resolvePromise = resolve;
      });
      mockGetAdminHealth.mockReturnValue(promise);

      const { unmount } = renderPanel();
      // Unmount before resolving
      unmount();

      // Resolve after unmount — should not throw
      await act(async () => {
        resolvePromise!(MOCK_HEALTH);
      });
      // If we got here without error, cancelledRef worked
    });
  });
});

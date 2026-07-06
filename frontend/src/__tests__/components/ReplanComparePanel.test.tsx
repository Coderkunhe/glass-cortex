/**
 * ReplanComparePanel 测试 — Phase 53 Batch 2 (API-driven)
 *
 * 覆盖：加载态 / 空态 / 单计划 / 对比态 / 错误态 / 可访问性。
 * Phase 53 L5 修复：两阶段加载 (getPlans → getPlan) 正确 mock 验证。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import ReplanComparePanel from "@/components/lab/ReplanComparePanel";

// Mock API client — 务必导出 ApiClientError 以兼容其他测试的 mock 引用
vi.mock("@/lib/api/client", () => ({
  api: {
    getPlans: vi.fn(),
    getPlan: vi.fn(),
  },
  ApiClientError: class extends Error {
    constructor(
      public status: number,
      public apiError: Record<string, string>,
    ) {
      super(apiError.detail || apiError.error);
      this.name = "ApiClientError";
    }
  },
}));

import { api } from "@/lib/api/client";

const mockGetPlans = api.getPlans as ReturnType<typeof vi.fn>;
const mockGetPlan = api.getPlan as ReturnType<typeof vi.fn>;

function makePlan(id: number, userMsg: string, subtaskCount: number) {
  return {
    id,
    session_id: "test",
    user_msg: userMsg,
    intent_category: "指令",
    rationale: `理由 ${id}`,
    confidence: 0.8 + id * 0.05,
    subtask_count: subtaskCount,
    dag_edges_json: id === 2 ? '[["1","2"]]' : "[]",
    created_at: 1719700000 + id,
  };
}

function makePlanDetail(id: number, userMsg: string, subtaskDescs: string[]) {
  return {
    ...makePlan(id, userMsg, subtaskDescs.length),
    subtasks: subtaskDescs.map((desc, idx) => ({
      id: idx + 1,
      plan_run_id: id,
      subtask_id: String(idx + 1),
      description: desc,
      depends_on_json: idx > 0 ? `["${idx}"]` : "[]",
      sort_order: idx,
      status: "pending",
      created_at: 1719700000,
    })),
  };
}

/** 设置两阶段 mock：getPlans 返回列表，getPlan 按 id 返回对应 detail */
function setupTwoPhase(plans: { id: number; userMsg: string; subtasks: string[] }[]) {
  mockGetPlans.mockResolvedValue(plans.map((p) => makePlan(p.id, p.userMsg, p.subtasks.length)));
  mockGetPlan.mockImplementation((id: number) => {
    const match = plans.find((pl) => pl.id === id);
    if (match) return Promise.resolve(makePlanDetail(match.id, match.userMsg, match.subtasks));
    return Promise.reject(new Error("Not found"));
  });
}

describe("ReplanComparePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  // ── 基础渲染 ──

  it("renders header without crashing", () => {
    setupTwoPhase([]);
    render(<ReplanComparePanel />);
    expect(screen.getByText("重规划对比")).toBeInTheDocument();
  });

  it("shows header subtitle", () => {
    setupTwoPhase([]);
    render(<ReplanComparePanel />);
    expect(screen.getByText(/最近两次规划并排对比/)).toBeInTheDocument();
  });

  // ── 加载态 ──

  it("shows loading state initially", () => {
    mockGetPlans.mockReturnValue(new Promise(() => {}));
    render(<ReplanComparePanel />);
    expect(screen.getByText(/加载规划数据/)).toBeInTheDocument();
  });

  // ── 空态 ──

  it("shows empty state when no plans exist", async () => {
    setupTwoPhase([]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("暂无规划数据")).toBeInTheDocument();
    });
  });

  it("shows empty state hint text", async () => {
    setupTwoPhase([]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText(/发送消息后规划结果将在此展示/)).toBeInTheDocument();
    });
  });

  // ── 单计划态 ──

  it("shows single plan when only one exists", async () => {
    setupTwoPhase([{ id: 1, userMsg: "做一件事", subtasks: ["任务1"] }]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("当前计划")).toBeInTheDocument();
      expect(screen.getByText(/仅有 1 次规划记录/)).toBeInTheDocument();
    });
  });

  // ── 对比态（2+ plans）──

  it("shows two plans side-by-side", async () => {
    setupTwoPhase([
      { id: 2, userMsg: "最新消息", subtasks: ["任务A", "任务B"] },
      { id: 1, userMsg: "较早消息", subtasks: ["任务X"] },
    ]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("较旧计划")).toBeInTheDocument();
      expect(screen.getByText("最新计划")).toBeInTheDocument();
    });
  });

  it("shows diff summary column in compare mode", async () => {
    setupTwoPhase([
      { id: 2, userMsg: "最新", subtasks: ["任务A", "任务B"] },
      { id: 1, userMsg: "较早", subtasks: ["任务X"] },
    ]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("差异摘要")).toBeInTheDocument();
    });
  });

  it("shows intent labels in compare mode", async () => {
    setupTwoPhase([
      { id: 2, userMsg: "最新", subtasks: ["任务A", "任务B"] },
      { id: 1, userMsg: "较早", subtasks: ["任务X"] },
    ]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      const intents = screen.getAllByText("指令");
      expect(intents.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows subtask counts for both plans", async () => {
    setupTwoPhase([
      { id: 2, userMsg: "最新", subtasks: ["任务A", "任务B", "任务C"] },
      { id: 1, userMsg: "较早", subtasks: ["任务X"] },
    ]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("子任务 (1)")).toBeInTheDocument();
      expect(screen.getByText("子任务 (3)")).toBeInTheDocument();
    });
  });

  it("shows confidence change in diff column", async () => {
    setupTwoPhase([
      { id: 2, userMsg: "最新", subtasks: ["任务A"] },
      { id: 1, userMsg: "较早", subtasks: ["任务A"] },
    ]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("置信度变化")).toBeInTheDocument();
    });
  });

  it("shows added and removed items when subtasks differ", async () => {
    setupTwoPhase([
      { id: 2, userMsg: "最新", subtasks: ["新任务A", "新任务B"] },
      { id: 1, userMsg: "较早", subtasks: ["旧任务X"] },
    ]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText(/新增/)).toBeInTheDocument();
      expect(screen.getByText(/删除/)).toBeInTheDocument();
      // 新任务A 同时出现在 plan column 和 diff added 列表中 → getAllByText
      const items = screen.getAllByText("新任务A");
      expect(items.length).toBeGreaterThanOrEqual(1);
      // 旧任务X 出现在 plan column 和 diff removed 中
      const removed = screen.getAllByText("旧任务X");
      expect(removed.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows no change when subtasks are identical", async () => {
    setupTwoPhase([
      { id: 2, userMsg: "最新", subtasks: ["任务A"] },
      { id: 1, userMsg: "较早", subtasks: ["任务A"] },
    ]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("子任务无显著变化")).toBeInTheDocument();
    });
  });

  // ── 错误态 ──

  it("shows error state when fetch fails", async () => {
    mockGetPlans.mockRejectedValue(new Error("fail"));
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
    });
  });

  it("allows retry from error", async () => {
    mockGetPlans.mockRejectedValueOnce(new Error("fail"));
    render(<ReplanComparePanel />);
    await waitFor(() => expect(screen.getByText(/加载失败/)).toBeInTheDocument());

    setupTwoPhase([]);
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(screen.getByText("暂无规划数据")).toBeInTheDocument();
    });
  });

  it("shows error state when getPlan fails", async () => {
    // getPlans 成功但 getPlan 失败
    mockGetPlans.mockResolvedValue([
      makePlan(1, "测试", 1),
    ]);
    mockGetPlan.mockRejectedValue(new Error("detail fetch failed"));
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
    });
  });

  // ── 底部引用 ──

  it("references backend engine at bottom", async () => {
    setupTwoPhase([]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      expect(screen.getByText(/src\/planner\/plan\.py/)).toBeInTheDocument();
    });
  });

  // ── 可访问性 ──

  it("renders within a section landmark", async () => {
    setupTwoPhase([]);
    render(<ReplanComparePanel />);
    await waitFor(() => {
      const section = document.querySelector("section");
      expect(section).not.toBeNull();
    });
  });
});

/**
 * SidebarReflectionCard 组件测试 — Phase 53 Batch 2 (API-driven)
 *
 * 验证：挂载加载 / 空计划状态 / 触发反思 / 反思结果展示 / 错误与重试。
 * Phase 53 L5 修复：handleReflect 先 getPlan 获取 subtasks 再 reflect。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import SidebarReflectionCard from "@/components/layout/SidebarReflectionCard";

// Mock API client
vi.mock("@/lib/api/client", () => ({
  api: {
    getPlans: vi.fn(),
    getPlan: vi.fn(),
    reflect: vi.fn(),
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
const mockReflect = api.reflect as ReturnType<typeof vi.fn>;

/** 构造不含 subtasks 的 PlanRun（列表端点返回） */
function makePlanRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, session_id: "sess", user_msg: "测试消息",
    intent_category: "提问", rationale: "理清原理",
    confidence: 0.85, subtask_count: 2,
    dag_edges_json: '[["1","2"]]', created_at: 1719700000,
    ...overrides,
  };
}

/** 构造含 subtasks 的 PlanDetail（详情端点返回） */
function makePlanDetail(subtaskDescs: string[]) {
  return {
    ...makePlanRun({ subtask_count: subtaskDescs.length }),
    subtasks: subtaskDescs.map((desc, idx) => ({
      id: idx + 1,
      plan_run_id: 1,
      subtask_id: String(idx + 1),
      description: desc,
      depends_on_json: idx > 0 ? `["${idx}"]` : "[]",
      sort_order: idx,
      status: "pending",
      created_at: 1719700000,
    })),
  };
}

describe("SidebarReflectionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  // ── 基础渲染 ──

  it("renders without crashing", () => {
    mockGetPlans.mockResolvedValue([]);
    render(<SidebarReflectionCard />);
    expect(screen.getByText("规划反思")).toBeInTheDocument();
  });

  it("renders as a <section> landmark", () => {
    mockGetPlans.mockResolvedValue([]);
    render(<SidebarReflectionCard />);
    const section = document.querySelector("section");
    expect(section).toBeInTheDocument();
    expect(section?.getAttribute("aria-label")).toBe("规划反思");
  });

  // ── 加载计划阶段 ──

  it("shows loading state while fetching latest plan", () => {
    mockGetPlans.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SidebarReflectionCard />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("shows no-plan message when no plans exist", async () => {
    mockGetPlans.mockResolvedValue([]);
    render(<SidebarReflectionCard />);
    await waitFor(() => {
      expect(screen.getByText(/发送消息后规划结果将在此展示/)).toBeInTheDocument();
    });
  });

  // ── idle 状态（有 plan 可反思）──

  it("shows trigger button when latest plan exists", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    render(<SidebarReflectionCard />);
    await waitFor(() => {
      expect(screen.getByText("触发反思")).toBeInTheDocument();
    });
  });

  // ── 触发反思 → reflecting → done ──

  it("shows reflecting state after click", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    // getPlan 和 reflect 均 pending
    mockGetPlan.mockReturnValue(new Promise(() => {}));
    mockReflect.mockReturnValue(new Promise(() => {}));

    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText("触发反思")).toBeInTheDocument());

    fireEvent.click(screen.getByText("触发反思"));
    // 进入 reflecting 态（getPlan 也处于 pending 但不显示独立 loading）
    await waitFor(() => {
      expect(screen.getByText("反思中…")).toBeInTheDocument();
    });
  });

  it("shows reflection results after reflect succeeds", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    mockGetPlan.mockResolvedValue(makePlanDetail(["子任务1", "子任务2"]));
    mockReflect.mockResolvedValue({
      reflections: ["反思点1", "反思点2"],
      improvement_suggestions: ["改进建议1"],
      plan_quality_score: 0.75,
      confidence: 0.82,
      trace: {},
    });

    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText("触发反思")).toBeInTheDocument());
    fireEvent.click(screen.getByText("触发反思"));

    await waitFor(() => {
      expect(screen.getByText("反思发现")).toBeInTheDocument();
      expect(screen.getByText("改进建议")).toBeInTheDocument();
      expect(screen.getByText("反思点1")).toBeInTheDocument();
      expect(screen.getByText("改进建议1")).toBeInTheDocument();
    });
  });

  it("renders plan quality and confidence scores", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    mockGetPlan.mockResolvedValue(makePlanDetail(["任务1"]));
    mockReflect.mockResolvedValue({
      reflections: [], improvement_suggestions: [],
      plan_quality_score: 0.72, confidence: 0.81,
      trace: {},
    });

    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText("触发反思")).toBeInTheDocument());
    fireEvent.click(screen.getByText("触发反思"));

    await waitFor(() => {
      expect(screen.getByText("72%")).toBeInTheDocument();
      expect(screen.getByText("81%")).toBeInTheDocument();
      expect(screen.getByText("计划质量")).toBeInTheDocument();
      expect(screen.getByText("置信度")).toBeInTheDocument();
    });
  });

  // ── 错误与重试 ──

  it("shows error state when plan fetch fails", async () => {
    mockGetPlans.mockRejectedValue(new Error("Network error"));
    render(<SidebarReflectionCard />);
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
    });
  });

  it("allows retry from error state", async () => {
    mockGetPlans.mockRejectedValueOnce(new Error("fail"));
    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText(/加载失败/)).toBeInTheDocument());

    mockGetPlans.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(screen.getByText(/发送消息后规划结果将在此展示/)).toBeInTheDocument();
    });
  });

  it("shows error state when getPlan fails during reflect", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    mockGetPlan.mockRejectedValue(new Error("detail fetch failed"));
    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText("触发反思")).toBeInTheDocument());

    fireEvent.click(screen.getByText("触发反思"));
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
    });
  });

  // ── 重置 ──

  it("allows resetting back to idle after reflect done", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    mockGetPlan.mockResolvedValue(makePlanDetail(["任务1"]));
    mockReflect.mockResolvedValue({
      reflections: ["r1"], improvement_suggestions: [],
      plan_quality_score: 0.8, confidence: 0.8, trace: {},
    });

    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText("触发反思")).toBeInTheDocument());
    fireEvent.click(screen.getByText("触发反思"));
    await waitFor(() => expect(screen.getByText("反思发现")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("重新触发反思"));
    expect(screen.getByText("触发反思")).toBeInTheDocument();
  });

  // ── 后端引用 ──

  it("references backend engine in done state", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    mockGetPlan.mockResolvedValue(makePlanDetail(["任务1"]));
    mockReflect.mockResolvedValue({
      reflections: [], improvement_suggestions: [],
      plan_quality_score: 0.7, confidence: 0.7, trace: {},
    });

    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText("触发反思")).toBeInTheDocument());
    fireEvent.click(screen.getByText("触发反思"));

    await waitFor(() => {
      expect(screen.getByText(/src\/planner\/reflection\.py/)).toBeInTheDocument();
    });
  });

  // ── 验证 subtasks 被正确传入 reflect ──

  it("passes real subtasks to reflect API", async () => {
    mockGetPlans.mockResolvedValue([makePlanRun()]);
    mockGetPlan.mockResolvedValue(makePlanDetail(["收集需求", "设计方案"]));
    mockReflect.mockResolvedValue({
      reflections: [], improvement_suggestions: [],
      plan_quality_score: 0.5, confidence: 0.5, trace: {},
    });

    render(<SidebarReflectionCard />);
    await waitFor(() => expect(screen.getByText("触发反思")).toBeInTheDocument());
    fireEvent.click(screen.getByText("触发反思"));

    await waitFor(() => {
      // 验证 reflect 被调用时 plan_json 包含真实 subtasks
      expect(mockReflect).toHaveBeenCalled();
      const callArg = mockReflect.mock.calls[0][0];
      const planJson = JSON.parse(callArg.plan_json);
      expect(planJson.subtasks).toHaveLength(2);
      expect(planJson.subtasks[0].description).toBe("收集需求");
      expect(planJson.subtasks[1].description).toBe("设计方案");
    });
  });
});

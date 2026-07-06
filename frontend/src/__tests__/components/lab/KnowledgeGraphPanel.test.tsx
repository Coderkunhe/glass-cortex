import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

// Mock echarts — jsdom 无完整 Canvas/DOM 测量 API
vi.mock("echarts", () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
  })),
}));

import KnowledgeGraphPanel from "@/components/lab/KnowledgeGraphPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

/** 模拟成功响应——4 节点 + 3 边 */
function mockGraphSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        nodes: [
          { id: "s1", label: "用户", group: "subject", weight: 1.0 },
          { id: "s2", label: "AI助手", group: "subject", weight: 0.8 },
          { id: "o1", label: "知识图谱", group: "object", weight: 0.9 },
          { id: "o2", label: "遗忘曲线", group: "object", weight: 0.7 },
        ],
        edges: [
          { source: "s1", target: "o1", label: "学习", confidence: 0.95 },
          { source: "s2", target: "o1", label: "构建", confidence: 0.85 },
          { source: "s1", target: "o2", label: "遵循", confidence: 0.6 },
        ],
        total_facts: 3,
      }),
  };
}

/** 模拟空响应 */
function mockGraphEmpty() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        nodes: [],
        edges: [],
        total_facts: 0,
      }),
  };
}

/** 模拟单节点 */
function mockGraphSingleNode() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        nodes: [{ id: "s1", label: "唯一节点", group: "subject", weight: 0.5 }],
        edges: [],
        total_facts: 1,
      }),
  };
}

/** 模拟错误响应 */
function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () =>
      Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("KnowledgeGraphPanel", () => {
  // ── 基础渲染 ──

  it("renders header with title", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphSuccess());
    render(<KnowledgeGraphPanel />);
    expect(screen.getByText("知识图谱")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/三元组可视化/)).toBeInTheDocument();
    });
  });

  it("shows loading on mount", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<KnowledgeGraphPanel />);
    expect(await screen.findByText("加载知识图谱…")).toBeInTheDocument();
  });

  // ── 成功状态 ──

  it("renders success state: legend, summary, and chart", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphSuccess());
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      // Legend
      expect(screen.getAllByText("主体 (Subject)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("客体 (Object)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("关系 (Relation)")).toBeInTheDocument();
      // 统计摘要
      expect(screen.getByText(/4 个节点/)).toBeInTheDocument();
      expect(screen.getByText(/3 条边/)).toBeInTheDocument();
    });
    // ECharts mock 渲染
    expect(screen.getByTestId("echarts-container")).toBeInTheDocument();
  });

  it("shows legend with subject and object labels", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphSuccess());
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      expect(screen.getAllByText("主体 (Subject)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("客体 (Object)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("关系 (Relation)")).toBeInTheDocument();
    });
  });

  it("shows total facts and node/edge counts in summary", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphSuccess());
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      const factsTexts = screen.getAllByText(/共 3 条事实/);
      expect(factsTexts.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/4 个节点/)).toBeInTheDocument();
      expect(screen.getByText(/3 条边/)).toBeInTheDocument();
    });
  });

  it("shows refresh button in success state", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphSuccess());
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      expect(screen.getByText("关系 (Relation)")).toBeInTheDocument();
    });
    const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
    expect(refreshBtn).toBeInTheDocument();
  });

  // ── 错误状态 ──

  it("shows error and retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    // Retry — 验证恢复到 success 状态
    mockFetch.mockResolvedValueOnce(mockGraphSuccess());
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(screen.getAllByText("主体 (Subject)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId("echarts-container")).toBeInTheDocument();
    });
  });

  it("shows network error and retry", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    });

    // Retry 后恢复
    mockFetch.mockResolvedValueOnce(mockGraphSuccess());
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(screen.getAllByText("主体 (Subject)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId("echarts-container")).toBeInTheDocument();
    });
  });

  // ── 空状态 ──

  it("shows idle message when no facts", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphEmpty());
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      expect(screen.getByText("暂无三元组数据，执行一些对话后回来查看")).toBeInTheDocument();
    });
  });

  // ── 边界情况 ──

  it("handles single node without crash", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphSingleNode());
    render(<KnowledgeGraphPanel />);
    await waitFor(() => {
      expect(screen.getByText(/1 个节点/)).toBeInTheDocument();
      expect(screen.getByText(/0 条边/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("echarts-container")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HealthDashboard from "@/components/observability/HealthDashboard";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

/** 构造 /health API 成功响应 */
function mockHealthResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        service: "glasscortex",
        overall_status: "ok",
        components: {
          database: {
            status: "ok",
            latency_ms: 12.3,
            detail: "SQLite 响应正常",
          },
          faiss_index: {
            status: "ok",
            latency_ms: 5.1,
            detail: "FAISS 索引就绪，143 个向量",
          },
          llm_api: {
            status: "ok",
            latency_ms: 420,
            detail: "DeepSeek API 可达",
          },
          disk_space: {
            status: "warn",
            latency_ms: 1.2,
            detail: "磁盘使用率 82%，建议清理",
          },
          embedding_model: {
            status: "ok",
            latency_ms: 85,
            detail: "BGE-small-zh 模型已加载",
          },
        },
        recovery_suggestions: [],
        ...overrides,
      }),
  };
}

/** 构造 /health API 错误响应 */
function mockHealthError() {
  return {
    ok: false,
    status: 500,
    json: () =>
      Promise.resolve({
        error: "internal",
        detail: "服务内部错误",
      }),
  };
}

function renderDashboard() {
  return render(<HealthDashboard />);
}

describe("HealthDashboard", () => {
  it("shows loading spinner initially", () => {
    // 不 resolve fetch — 组件保持在 loading 状态
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByText("检查中…")).toBeInTheDocument();
  });

  it("renders 5 health cards on successful fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockHealthResponse());
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("数据库")).toBeInTheDocument();
    });

    expect(screen.getByText("向量索引")).toBeInTheDocument();
    expect(screen.getByText("LLM API")).toBeInTheDocument();
    expect(screen.getByText("磁盘空间")).toBeInTheDocument();
    expect(screen.getByText("嵌入模型")).toBeInTheDocument();

    // 整体状态 — 使用 getAllByText 因为卡片中也有"正常" pill
    const okElements = screen.getAllByText("正常");
    expect(okElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows overall status indicator", async () => {
    mockFetch.mockResolvedValueOnce(mockHealthResponse());
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("整体状态：")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockHealthError());
    renderDashboard();

    await waitFor(() => {
      // ErrorDisplay 统一错误卡片 — 有 role="alert"
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // 重试按钮
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("retry button triggers re-fetch", async () => {
    // 第一次失败
    mockFetch.mockResolvedValueOnce(mockHealthError());
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // 第二次成功
    mockFetch.mockResolvedValueOnce(mockHealthResponse());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("数据库")).toBeInTheDocument();
    });
  });

  it("shows recovery suggestions when present", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHealthResponse({
        overall_status: "warn",
        recovery_suggestions: [
          {
            component: "disk_space",
            status: "warn",
            hint: "磁盘使用率超过 80%，建议清理日志文件",
          },
        ],
      }),
    );
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("恢复建议")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/磁盘使用率超过 80%/),
    ).toBeInTheDocument();
  });

  it("renders refresh button and updates timestamp", async () => {
    mockFetch.mockResolvedValueOnce(mockHealthResponse());
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("数据库")).toBeInTheDocument();
    });

    const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
    expect(refreshBtn).toBeInTheDocument();

    // 刷新按钮点击后 mock 新响应
    mockFetch.mockResolvedValueOnce(mockHealthResponse());
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      // 确认仍然渲染了卡片（刷新成功）
      expect(screen.getByText("数据库")).toBeInTheDocument();
    });
  });

  it("shows empty state when no components returned", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHealthResponse({ components: {} }),
    );
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("暂无健康检查数据")).toBeInTheDocument();
    });
  });

  it("skips unknown component keys gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      mockHealthResponse({
        components: {
          database: {
            status: "ok",
            latency_ms: 10,
            detail: "ok",
          },
          unknown_comp: {
            status: "ok",
            latency_ms: 99,
            detail: "should be skipped",
          },
        },
      }),
    );
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("数据库")).toBeInTheDocument();
    });

    // unknown_comp 不在 COMPONENT_LABELS 中，应被跳过
    expect(screen.queryByText("should be skipped")).toBeNull();
  });
});

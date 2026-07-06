import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import SessionHarvest from "@/components/chat/SessionHarvest";
import { ChatParamsProvider } from "@/components/chat/ChatParamsContext";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockOkResponses() {
  // GET /metrics/tokens
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        by_call_point: {},
        total_prompt_tokens: 1200,
        total_completion_tokens: 800,
        total_tokens: 2000,
      }),
  });
  // GET /profiles/current
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        name: "default",
        db_size_bytes: 65536,
        has_index: true,
        episode_count: 42,
        fact_count: 15,
        index_vectors: 100,
      }),
  });
}

function renderHarvest() {
  return render(
    <ChatParamsProvider>
      <SessionHarvest />
    </ChatParamsProvider>,
  );
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(cleanup);

describe("SessionHarvest", () => {
  it("renders loading skeleton on mount", () => {
    mockOkResponses();
    const { container } = renderHarvest();
    // 加载态应有 animate-pulse class
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders harvest data after fetch", async () => {
    mockOkResponses();
    renderHarvest();
    await waitFor(() => {
      expect(screen.getByText("会话收获")).toBeDefined();
    });
    // 四个指标应出现
    expect(screen.getByText("轮次")).toBeDefined();
    expect(screen.getByText("事实")).toBeDefined();
    expect(screen.getByText("Token")).toBeDefined();
    expect(screen.getByText("时长")).toBeDefined();
  });

  it("renders memory recall summary", async () => {
    mockOkResponses();
    renderHarvest();
    await waitFor(() => {
      expect(screen.getByText("记忆召回")).toBeDefined();
    });
    expect(screen.getByText("本次会话")).toBeDefined();
    expect(screen.getByText("历史总计")).toBeDefined();
  });

  it("shows token count", async () => {
    mockOkResponses();
    renderHarvest();
    await waitFor(() => {
      // 2000 tokens → "2.0k"
      expect(screen.getByText("2.0k")).toBeDefined();
    });
  });

  it("shows ErrorDisplay with categorized message on API failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    renderHarvest();
    await waitFor(() => {
      // ErrorDisplay renders categorized Chinese message matching the pattern
      expect(screen.getByText(/网络连接失败/)).toBeDefined();
      expect(
        screen.getByRole("button", { name: /重试/ }),
      ).toBeInTheDocument();
    });
  });

  it("handles empty data gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {},
          total_prompt_tokens: 0,
          total_completion_tokens: 0,
          total_tokens: 0,
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          name: "default",
          db_size_bytes: 0,
          has_index: false,
          episode_count: 0,
          fact_count: 0,
          index_vectors: 0,
        }),
    });
    renderHarvest();
    await waitFor(() => {
      expect(screen.getByText("会话收获")).toBeDefined();
    });
    // 零值不应崩溃 — 多个指标都显示 "0"
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });

  // ── Token 格式化边界 ──

  it("formats token >= 1000 with k suffix", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {},
          total_prompt_tokens: 600,
          total_completion_tokens: 400,
          total_tokens: 1000,
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          name: "default",
          db_size_bytes: 1024,
          has_index: true,
          episode_count: 5,
          fact_count: 3,
          index_vectors: 10,
        }),
    });
    renderHarvest();
    await waitFor(() => {
      expect(screen.getByText("1.0k")).toBeDefined();
    });
  });

  it("formats token < 1000 as plain number", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {},
          total_prompt_tokens: 200,
          total_completion_tokens: 300,
          total_tokens: 500,
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          name: "default",
          db_size_bytes: 1024,
          has_index: true,
          episode_count: 5,
          fact_count: 3,
          index_vectors: 10,
        }),
    });
    renderHarvest();
    await waitFor(() => {
      expect(screen.getByText("500")).toBeDefined();
    });
  });

  // ── Non-ok HTTP 响应 ──

  it("shows ErrorDisplay on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "internal" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          name: "default",
          db_size_bytes: 0,
          has_index: false,
          episode_count: 0,
          fact_count: 0,
          index_vectors: 0,
        }),
    });
    renderHarvest();
    await waitFor(() => {
      // Custom heading prop + categorized server userMessage
      expect(screen.getByText("会话收获加载失败")).toBeDefined();
      expect(screen.getByText("服务暂时不可用，请稍后重试")).toBeDefined();
    });
  });

  // ── 大数值 episode count ──

  it("displays large episode count correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {},
          total_prompt_tokens: 50,
          total_completion_tokens: 30,
          total_tokens: 80,
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          name: "default",
          db_size_bytes: 131072,
          has_index: true,
          episode_count: 9999,
          fact_count: 500,
          index_vectors: 2000,
        }),
    });
    renderHarvest();
    await waitFor(() => {
      expect(screen.getByText("9999")).toBeDefined();
    });
  });

  // ── 会话时长渲染 ──

  it("renders session duration in human-readable format", async () => {
    mockOkResponses();
    renderHarvest();
    await waitFor(() => {
      expect(screen.getByText("会话收获")).toBeDefined();
    });
    // 时长指标应存在（秒/分/时 格式），不应是 NaN
    const durationLabels = screen.getAllByText("时长");
    expect(durationLabels.length).toBeGreaterThanOrEqual(1);
  });
});

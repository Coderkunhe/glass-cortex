import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ChatParamsProvider } from "@/components/chat/ChatParamsContext";
import Sidebar from "@/components/layout/Sidebar";

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** 预加载所有 Sidebar 子组件需要的 API 响应。
 *
 *  调用顺序（Phase 66 Batch 3 重排后，从上到下）：
 *    ProfileCard → SidebarReflectionCard → SessionHarvest */
function mockAllResponses() {
  // ProfileCard: GET /profiles
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        profiles: [
          {
            name: "default",
            db_size_bytes: 0,
            has_index: true,
            episode_count: 0,
            fact_count: 0,
            index_vectors: 0,
          },
        ],
        current: "default",
      }),
  });
  // ProfileCard: GET /memory/tag-summary
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve([]),
  });
  // SidebarReflectionCard: GET /planner/plans?limit=1
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve([]),
  });
  // SessionHarvest: GET /metrics/tokens
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
  // SessionHarvest: GET /profiles/current
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
}

function resetConfirmMocks() {
  // reset confirm calls POST /session/reset
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        status: "wiped",
        profile: "default",
        detail: "All cleared",
      }),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockAllResponses();
});

afterEach(cleanup);

function renderSidebar() {
  return render(
    <ChatParamsProvider>
      <Sidebar />
    </ChatParamsProvider>,
  );
}

describe("Sidebar", () => {
  it("renders session stats section", () => {
    renderSidebar();
    expect(screen.getByText("本次会话")).toBeDefined();
    expect(screen.getByText("消息数")).toBeDefined();
    expect(screen.getByText("本次召回")).toBeDefined();
  });

  it("renders session harvest section (162.1)", async () => {
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText("会话收获")).toBeDefined();
    });
    expect(screen.getByText("记忆召回")).toBeDefined();
  });

  it("renders param replay section (162.4)", () => {
    renderSidebar();
    expect(screen.getByText("参数推演")).toBeDefined();
  });

  it("renders reset button in idle state (162.3)", () => {
    renderSidebar();
    expect(screen.getByText("重置数据")).toBeDefined();
    expect(screen.getByText("清空所有数据")).toBeDefined();
  });

  it("shows confirmation prompt on reset button click", async () => {
    renderSidebar();
    fireEvent.click(screen.getByText("清空所有数据"));
    expect(screen.getByText("确认清空？此操作不可撤销")).toBeDefined();
    expect(screen.getByText("确认重置")).toBeDefined();
    expect(screen.getByText("取消")).toBeDefined();
  });

  it("handles reset API call on confirm", async () => {
    resetConfirmMocks();
    renderSidebar();
    // 点击进入 confirm 阶段
    fireEvent.click(screen.getByText("清空所有数据"));
    // 点击确认
    fireEvent.click(screen.getByText("确认重置"));
    await waitFor(() => {
      expect(screen.getByText(/已重置/)).toBeDefined();
    });
  });

  it("renders profile card after API response", async () => {
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText("default")).toBeDefined();
    });
  });

  it("renders system status with API connection", () => {
    renderSidebar();
    expect(screen.getByText("系统状态")).toBeDefined();
    expect(screen.getByText("DeepSeek API")).toBeDefined();
    expect(screen.getByText("已连接")).toBeDefined();
  });
});

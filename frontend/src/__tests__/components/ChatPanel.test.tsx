import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { DrawerProvider } from "@/components/chat/DrawerContext";
import { ChatParamsProvider } from "@/components/chat/ChatParamsContext";
import ChatPanel from "@/components/chat/ChatPanel";

afterEach(cleanup);

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

/** 在 DrawerProvider + ChatParamsProvider 内渲染 ChatPanel */
function renderChatPanel() {
  return render(
    <DrawerProvider>
      <ChatParamsProvider>
        <ChatPanel />
      </ChatParamsProvider>
    </DrawerProvider>,
  );
}

describe("ChatPanel", () => {
  it("shows empty state when no messages", () => {
    renderChatPanel();
    expect(screen.getByText(/欢迎来到 GlassCortex/)).toBeInTheDocument();
  });

  it("sends message and displays response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          response_text: "这是 AI 的回复",
          episode_id: 1,
          intent: null,
          context_meta: {
            window_size: 4096,
            base_tokens: 0,
            memories_before: 0,
            memories_token_before: 0,
            memories_after: 0,
            overflow_applied: false,
            strategy: "prioritize",
            dropped_count: 0,
            dropped_items: [],
            user_message_tokens: 2,
            total_estimated_tokens: 2,
          },
          api_trace: {
            caller: "chat",
            model: "deepseek-chat",
            temperature: 0.7,
            max_tokens: 1024,
            elapsed_ms: 500,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
          recall_items: [],
        }),
    });

    renderChatPanel();

    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    // 用户消息立即可见
    await waitFor(() => { expect(screen.getByText("你好")).toBeInTheDocument(); });
    // AI 回复在 API 调用后出现
    await waitFor(() => { expect(screen.getByText("这是 AI 的回复")).toBeInTheDocument(); });
  });

  it("shows error state on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({ error: "llm_unavailable", detail: "API 不可用" }),
    });

    renderChatPanel();

    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    expect(await screen.findByText(/服务暂时不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    // Error lens trigger should appear alongside ErrorDisplay
    expect(screen.getByText("🤔 为什么这样处理？")).toBeInTheDocument();
  });

  // ── Loading state ──

  it("shows loading indicator while waiting for API response", async () => {
    // Promise that never resolves — loading state persists
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));

    renderChatPanel();

    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    expect(await screen.findByText("正在理解问题…")).toBeInTheDocument();
  });

  // ── Enter key submit ──

  it("sends message on Enter key press", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          response_text: "Enter 发送的回复",
          episode_id: 2,
          intent: null,
          context_meta: {
            window_size: 4096,
            base_tokens: 0,
            memories_before: 0,
            memories_token_before: 0,
            memories_after: 0,
            overflow_applied: false,
            strategy: "prioritize",
            dropped_count: 0,
            dropped_items: [],
            user_message_tokens: 2,
            total_estimated_tokens: 2,
          },
          api_trace: {
            caller: "chat",
            model: "deepseek-chat",
            temperature: 0.7,
            max_tokens: 1024,
            elapsed_ms: 300,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
          recall_items: [],
        }),
    });

    renderChatPanel();

    const input = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => { expect(screen.getByText("你好")).toBeInTheDocument(); });
    await waitFor(() => { expect(screen.getByText("Enter 发送的回复")).toBeInTheDocument(); });
  });

  it("does not send on Shift+Enter (inserts newline)", () => {
    renderChatPanel();

    const input = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    // Fetch should not be called because send wasn't triggered
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Empty message rejection ──

  it("disables send button when input is empty", () => {
    renderChatPanel();
    const sendButton = screen.getByRole("button", { name: /发送/ });
    expect(sendButton).toBeDisabled();
  });

  it("disables send button when input is whitespace only", () => {
    renderChatPanel();
    const input = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /发送/ })).toBeDisabled();
  });

  // ── Malformed response ──

  it("handles malformed API response without crashing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          // response_text intentionally missing — tests rendering without text
          episode_id: 1,
          intent: null,
          context_meta: {
            window_size: 4096,
            base_tokens: 0,
            memories_before: 0,
            memories_token_before: 0,
            memories_after: 0,
            overflow_applied: false,
            strategy: "prioritize",
            dropped_count: 0,
            dropped_items: [],
            user_message_tokens: 2,
            total_estimated_tokens: 2,
            usage_pct: 0,
            memories_token_after: 0,
          },
          api_trace: {
            caller: "chat",
            model: "deepseek-chat",
            temperature: 0.7,
            max_tokens: 1024,
            elapsed_ms: 300,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
          recall_items: [],
        }),
    });

    renderChatPanel();

    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    // User message should still render (no crash)
    await waitFor(() => { expect(screen.getByText("你好")).toBeInTheDocument(); });
    // Error should NOT be shown since ok is true
    expect(screen.queryByText(/服务暂时不可用/)).not.toBeInTheDocument();
  });

  // ── Clear conversation ──

  it("shows clear button when messages exist and hides when empty", () => {
    renderChatPanel();
    // 空状态：无清除按钮
    expect(screen.queryByLabelText("清除对话")).not.toBeInTheDocument();
  });

  it("clears messages and shows welcome view after confirm modal flow", async () => {
    // Mock chat API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          response_text: "AI 回复",
          episode_id: 1,
          intent: null,
          context_meta: {
            window_size: 4096,
            base_tokens: 0,
            memories_before: 0,
            memories_token_before: 0,
            memories_after: 0,
            overflow_applied: false,
            strategy: "prioritize",
            dropped_count: 0,
            dropped_items: [],
            user_message_tokens: 2,
            total_estimated_tokens: 2,
          },
          api_trace: {
            caller: "chat",
            model: "deepseek-chat",
            temperature: 0.7,
            max_tokens: 1024,
            elapsed_ms: 300,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
          recall_items: [],
        }),
    });

    // Mock forget session API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          episodes_deleted: 3,
          facts_deleted: 5,
          faiss_vectors_removed: 2,
          session_id: "test-sid",
        }),
    });

    renderChatPanel();

    // 发送消息 → 用户消息 + AI 回复出现
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));
    await waitFor(() => { expect(screen.getByText("你好")).toBeInTheDocument(); });
    await waitFor(() => { expect(screen.getByText("AI 回复")).toBeInTheDocument(); });

    // 清除按钮出现
    expect(screen.getByLabelText("清除对话")).toBeInTheDocument();

    // 点击清除 → ConfirmModal 出现
    fireEvent.click(screen.getByLabelText("清除对话"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("清除对话记忆？")).toBeInTheDocument();

    // 点击确认清除 → API 调用 → 清空消息
    fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
    await waitFor(() => { expect(screen.getByText(/欢迎来到 GlassCortex/)).toBeInTheDocument(); });
    expect(screen.queryByText("你好")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 回复")).not.toBeInTheDocument();

    // 遗忘成功横幅出现
    expect(screen.getByText(/已清除 3 条对话记录、5 条事实、2 个向量索引/)).toBeInTheDocument();
  });

  // ── a11y: aria-live region ──

  it("renders message container with aria-live polite for screen readers", () => {
    renderChatPanel();
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-label", "聊天消息");
  });
});

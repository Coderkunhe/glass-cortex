import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DrawerProvider } from "@/components/chat/DrawerContext";
import ProcessDrawer from "@/components/chat/ProcessDrawer";
import ChatMessage from "@/components/chat/ChatMessage";
import type { Message } from "@/hooks/useChat";
import type { ApiTrace, IntentResult } from "@/lib/api/types";

afterEach(cleanup);

/** 构建一个包含完整 response 的测试用 Message */
function mockAssistantMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: "2",
    role: "assistant",
    content: "你好！有什么可以帮助你的？",
    createdAt: Date.now(),
    response: {
      response_text: "你好！有什么可以帮助你的？",
      episode_id: 1,
      intent: {
        category: "提问",
        confidence: 0.95,
        rationale: "用户想知道技术问题的答案",
      },
      context_meta: {
        window_size: 4096,
        base_tokens: 200,
        memories_before: 1,
        memories_token_before: 50,
        memories_after: 1,
        overflow_applied: false,
        strategy: "prioritize",
        dropped_count: 0,
        dropped_items: [],
        user_message_tokens: 10,
        total_estimated_tokens: 260,
        usage_pct: 6.3,
        memories_token_after: 50,
      },
      api_trace: {
        caller: "chat",
        model: "deepseek-v4-flash",
        temperature: 0.7,
        max_tokens: 1024,
        elapsed_ms: 350,
        prompt_tokens: 260,
        completion_tokens: 25,
      },
      recall_items: [
        {
          id: 1,
          content: "用户之前讨论过 DeepSeek API 的配置方式",
          importance: 0.8,
          composite_score: 0.85,
          timestamp: Date.now() / 1000,
        },
      ],
    },
    ...overrides,
  };
}

/** 在 DrawerProvider 内渲染 ChatMessage。可选地同时渲染 ProcessDrawer（抽屉 close 测试需要） */
function renderChatMessage(
  message: Message,
  opts?: { userIntent?: IntentResult; userTrace?: ApiTrace | null; withDrawer?: boolean },
) {
  const result = render(
    <DrawerProvider>
      <ChatMessage message={message} userIntent={opts?.userIntent} userTrace={opts?.userTrace} />
      {opts?.withDrawer && <ProcessDrawer />}
    </DrawerProvider>,
  );
  return result;
}

describe("ChatMessage", () => {
  it("renders user message with brand styling", () => {
    const msg: Message = { id: "1", role: "user", content: "你好", createdAt: Date.now() };
    renderChatMessage(msg);
    expect(screen.getByText("你好")).toBeInTheDocument();
  });

  it("renders assistant message", () => {
    const msg: Message = {
      id: "2",
      role: "assistant",
      content: "你好！有什么可以帮助你的？",
      createdAt: Date.now(),
    };
    renderChatMessage(msg);
    expect(
      screen.getByText("你好！有什么可以帮助你的？"),
    ).toBeInTheDocument();
  });

  it("preserves whitespace and newlines", () => {
    const msg: Message = { id: "3", role: "user", content: "行1\n行2\n\n行3", createdAt: Date.now() };
    renderChatMessage(msg);
    const el = screen.getByText(/行1/);
    expect(el).toBeInTheDocument();
  });

  // ── 洋葱面板 ──

  it("shows peel button on assistant messages with response", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    expect(screen.getByText("洋葱面板")).toBeInTheDocument();
  });

  it("does not show peel button on user messages", () => {
    const msg: Message = { id: "1", role: "user", content: "你好", createdAt: Date.now() };
    renderChatMessage(msg);
    expect(screen.queryByText("洋葱面板")).not.toBeInTheDocument();
  });

  it("does not show peel button on assistant messages without response", () => {
    const msg: Message = {
      id: "2",
      role: "assistant",
      content: "你好！",
      createdAt: Date.now(),
    };
    renderChatMessage(msg);
    expect(screen.queryByText("洋葱面板")).not.toBeInTheDocument();
  });

  it("expands onion panel when peel button is clicked", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    fireEvent.click(screen.getByText("洋葱面板"));
    // 面板展开后应该显示意图识别区和上下文窗口
    expect(screen.getByText("🎯 意图识别")).toBeInTheDocument();
    expect(screen.getByText("📐 上下文窗口")).toBeInTheDocument();
  });

  it("collapses onion panel when toggle button is clicked again", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    // 先展开
    fireEvent.click(screen.getByText("洋葱面板"));
    expect(screen.getByText("🎯 意图识别")).toBeInTheDocument();
    // 再点击同一个按钮收起
    fireEvent.click(screen.getByText("洋葱面板"));
    expect(screen.queryByText("🎯 意图识别")).not.toBeInTheDocument();
  });

  // ── 消息旅程 toggle ──

  it("shows journey toggle button on assistant messages with response", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    expect(screen.getByText("消息旅程")).toBeInTheDocument();
  });

  it("does not show journey toggle on user messages", () => {
    const msg: Message = { id: "1", role: "user", content: "你好", createdAt: Date.now() };
    renderChatMessage(msg);
    expect(screen.queryByText("消息旅程")).not.toBeInTheDocument();
  });

  it("does not show journey toggle on assistant messages without response", () => {
    const msg: Message = {
      id: "2",
      role: "assistant",
      content: "你好！",
      createdAt: Date.now(),
    };
    renderChatMessage(msg);
    expect(screen.queryByText("消息旅程")).not.toBeInTheDocument();
  });

  it("expands journey cards when journey toggle is clicked", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    fireEvent.click(screen.getByText("消息旅程"));
    // 旅程展开后应该显示 6 卡片的标题
    expect(screen.getByText("理解")).toBeInTheDocument();
    expect(screen.getByText("召回")).toBeInTheDocument();
    expect(screen.getByText("组装")).toBeInTheDocument();
    expect(screen.getByText("花费")).toBeInTheDocument();
    expect(screen.getByText("回复")).toBeInTheDocument();
    expect(screen.getByText("记忆")).toBeInTheDocument();
  });

  it("collapses journey cards when toggle button is clicked again", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    // 先展开
    fireEvent.click(screen.getByText("消息旅程"));
    expect(screen.getByText("理解")).toBeInTheDocument();
    // "消息旅程" 现在出现两次（toggle 按钮 + JourneyCards header）
    // 取第一个（toggle 按钮在 DOM 中靠前）
    const all = screen.getAllByText("消息旅程");
    fireEvent.click(all[0]);
    expect(screen.queryByText("理解")).not.toBeInTheDocument();
  });

  // ── 深度抽屉（通过 IntentPill onClick 触发）──

  it("opens drawer when intent pill is clicked on user message with userTrace", async () => {
    const userMsg: Message = { id: "1", role: "user", content: "你好", createdAt: Date.now() };
    const trace = {
      caller: "chat",
      model: "deepseek-v4-flash",
      temperature: 0.7,
      max_tokens: 1024,
      elapsed_ms: 350,
      prompt_tokens: 260,
      completion_tokens: 25,
    };
    renderChatMessage(userMsg, {
      userIntent: { category: "闲聊", confidence: 0.95, rationale: "打招呼" },
      userTrace: trace,
      withDrawer: true,
    });
    // Click the intent pill (now a button)
    fireEvent.click(screen.getByText("闲聊"));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  // ── 对话历史 toggle ──

  it("shows history toggle button on assistant messages with response", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    expect(screen.getByText("对话历史")).toBeInTheDocument();
  });

  it("does not show history toggle on user messages", () => {
    const msg: Message = { id: "1", role: "user", content: "你好", createdAt: Date.now() };
    renderChatMessage(msg);
    expect(screen.queryByText("对话历史")).not.toBeInTheDocument();
  });

  it("does not show history toggle on assistant messages without response", () => {
    const msg: Message = {
      id: "2",
      role: "assistant",
      content: "你好！",
      createdAt: Date.now(),
    };
    renderChatMessage(msg);
    expect(screen.queryByText("对话历史")).not.toBeInTheDocument();
  });

  it("expands history browser on toggle click", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch;

    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    fireEvent.click(screen.getByText("对话历史"));

    // JourneyHistoryBrowser renders its header, then shows empty state after fetch
    await waitFor(() => {
      expect(screen.getByText("暂无对话历史")).toBeInTheDocument();
    });
  });

  // ── 用户消息显示意图标签 ──
  it("shows intent pill above user message when userIntent is provided", () => {
    const msg: Message = {
      id: "1",
      role: "user",
      content: "你好",
      createdAt: Date.now(),
    };
    renderChatMessage(msg, {
      userIntent: { category: "闲聊", confidence: 0.95, rationale: "打招呼" },
    });
    expect(screen.getByText("闲聊")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("does not show intent pill when userIntent is undefined", () => {
    const msg: Message = {
      id: "1",
      role: "user",
      content: "你好",
      createdAt: Date.now(),
    };
    renderChatMessage(msg);
    expect(screen.queryByText("95%")).not.toBeInTheDocument();
  });

  // ── 面板头部点击收起 (Phase 35 Batch 3) ──

  it("collapses onion panel when header收起 is clicked", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    // 展开洋葱面板
    fireEvent.click(screen.getByText("洋葱面板"));
    expect(screen.getByText("🎯 意图识别")).toBeInTheDocument();
    // 点击 OnionPanel 顶部的收起洋葱面板按钮（由 onCollapse 渲染）
    fireEvent.click(screen.getByText("收起洋葱面板"));
    expect(screen.queryByText("🎯 意图识别")).not.toBeInTheDocument();
  });

  it("collapses journey cards when header is clicked", () => {
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    // 展开消息旅程
    fireEvent.click(screen.getByText("消息旅程"));
    expect(screen.getByText("理解")).toBeInTheDocument();
    // "消息旅程" 出现两次：toggle 按钮 + JourneyCards header
    // DOM 顺序：按钮行在前 → header 在后，取最后一个即为 header
    const all = screen.getAllByText("消息旅程");
    fireEvent.click(all[all.length - 1]);
    expect(screen.queryByText("理解")).not.toBeInTheDocument();
  });

  it("collapses history browser when header is clicked", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch;
    const msg = mockAssistantMsg();
    renderChatMessage(msg);
    // 展开对话历史
    fireEvent.click(screen.getByText("对话历史"));
    await waitFor(() => {
      expect(screen.getByText("暂无对话历史")).toBeInTheDocument();
    });
    // "对话历史" 出现两次：toggle 按钮 + JourneyHistoryBrowser header
    // DOM 顺序：按钮行在前 → header 在后，取最后一个
    const allHistory = screen.getAllByText("对话历史");
    fireEvent.click(allHistory[allHistory.length - 1]);
    // JourneyHistoryBrowser should be gone
    expect(screen.queryByText("暂无对话历史")).not.toBeInTheDocument();
  });
});

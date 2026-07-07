import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import IntentTestPanel from "@/components/lab/IntentTestPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockSuccessResponse(overrides = {}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        category: "提问",
        confidence: 0.92,
        rationale: "用户在询问事实性知识",
        trace: {
          system_prompt: "你是一个意图分类器...",
          raw_response:
            '{"category": "提问", "confidence": 0.92, "rationale": "用户在询问事实性知识"}',
          token_usage: { prompt_tokens: 180, completion_tokens: 25 },
        },
        ...overrides,
      }),
  };
}

function mockErrorResponse() {
  return {
    ok: false,
    status: 503,
    json: () =>
      Promise.resolve({ error: "planner_unavailable", detail: "Planner 不可用" }),
  };
}

describe("IntentTestPanel", () => {
  it("renders textarea and button in idle state", () => {
    render(<IntentTestPanel />);

    expect(screen.getByText("意图分类测试")).toBeInTheDocument();
    expect(screen.getByText("测试分类")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/输入待分类的文本/),
    ).toBeInTheDocument();
    // Idle prompt
    expect(
      screen.getByText(/输入文本后点击/),
    ).toBeInTheDocument();
  });

  it("disables button when textarea is empty", () => {
    render(<IntentTestPanel />);

    const button = screen.getByText("测试分类");
    expect(button).toBeDisabled();
  });

  it("enables button when text is entered", () => {
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "什么是量子计算？" } },
    );

    expect(screen.getByText("测试分类")).not.toBeDisabled();
  });

  it("submits classification and shows IntentPill result", async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "什么是量子计算？" } },
    );
    fireEvent.click(screen.getByText("测试分类"));

    await waitFor(() => {
      // IntentPill renders category + confidence
      expect(screen.getByText("提问")).toBeInTheDocument();
      expect(screen.getByText("92%")).toBeInTheDocument();
    });

    // Rationale visible
    expect(
      screen.getByText("用户在询问事实性知识"),
    ).toBeInTheDocument();
  });

  it("shows trace details with system prompt and raw response", async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "test" } },
    );
    fireEvent.click(screen.getByText("测试分类"));

    await waitFor(() => {
      expect(screen.getByText("分类过程")).toBeInTheDocument();
    });
  });

  it("shows error state with retry", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "test" } },
    );
    fireEvent.click(screen.getByText("测试分类"));

    await waitFor(() => {
      expect(screen.getByText("Planner 不可用")).toBeInTheDocument();
    });
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("retries after error succeeds", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "test" } },
    );
    fireEvent.click(screen.getByText("测试分类"));

    await waitFor(() => {
      expect(screen.getByText("重试")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("提问")).toBeInTheDocument();
    });
  });

  // ── 低置信度 ──

  it("shows low confidence percentage correctly", async () => {
    mockFetch.mockResolvedValueOnce(
      mockSuccessResponse({ category: "闲聊", confidence: 0.35, rationale: "用户输入较模糊" }),
    );
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "嗯" } },
    );
    fireEvent.click(screen.getByText("测试分类"));

    await waitFor(() => {
      expect(screen.getByText("闲聊")).toBeInTheDocument();
      expect(screen.getByText("35%")).toBeInTheDocument();
    });
  });

  // ── Ctrl+Enter 快捷键 ──

  it("submits on Ctrl+Enter keyboard shortcut", async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse());
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "快捷键测试" } },
    );
    fireEvent.keyDown(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { key: "Enter", ctrlKey: true },
    );

    await waitFor(() => {
      expect(screen.getByText("提问")).toBeInTheDocument();
    });
  });

  // ── 纯空白禁用 ──

  it("button remains disabled for whitespace-only input", () => {
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "   " } },
    );

    expect(screen.getByText("测试分类")).toBeDisabled();
  });

  // ── Token 用量在 trace 中显示 ──

  it("shows token usage in trace debug section", async () => {
    // 构造带有 token_usage 的 trace 数据（在 trace 对象内部）
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          category: "提问",
          confidence: 0.92,
          rationale: "分析完成",
          trace: {
            system_prompt: "你是意图分类器",
            raw_response: "{}",
            token_usage: { prompt_tokens: 180, completion_tokens: 25 },
          },
        }),
    });
    render(<IntentTestPanel />);

    fireEvent.change(
      screen.getByPlaceholderText(/输入待分类的文本/),
      { target: { value: "test" } },
    );
    fireEvent.click(screen.getByText("测试分类"));

    await waitFor(() => {
      expect(screen.getByText("分类过程")).toBeInTheDocument();
    });
    // Token Usage summary label — the details element shows this when data.trace.token_usage is truthy
    expect(screen.getByText("Token Usage")).toBeInTheDocument();
  });
});

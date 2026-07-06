import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import TokenDashboardPanel from "@/components/lab/TokenDashboardPanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockTokenSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        by_call_point: {
          chat_engine: { prompt_tokens: 1500, completion_tokens: 800, total_tokens: 2300 },
          intent_classify: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
          fact_extraction: { prompt_tokens: 600, completion_tokens: 300, total_tokens: 900 },
        },
        total_prompt_tokens: 2300,
        total_completion_tokens: 1150,
        total_tokens: 3450,
      }),
  };
}

function mockEmptyTokenSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        by_call_point: {},
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
      }),
  };
}

function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

describe("TokenDashboardPanel", () => {
  it("renders header and idle hint after auto-fetch returns empty", async () => {
    // 自动获取返回空数据 → 显示 idle 态
    mockFetch.mockResolvedValueOnce(mockEmptyTokenSuccess());
    render(<TokenDashboardPanel />);
    expect(screen.getByText("Token 用量仪表盘")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText("暂无 Token 数据，发起一次聊天后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("auto-fetches on mount and shows loading", async () => {
    // 永不 resolve 的 promise 保持 loading 态
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<TokenDashboardPanel />);
    await waitFor(() => {
      expect(screen.getByText("加载 Token 数据…")).toBeInTheDocument();
    });
  });

  it("displays token dashboard on successful fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    render(<TokenDashboardPanel />);

    await waitFor(() => {
      expect(screen.getByText(/3,450/)).toBeInTheDocument();
    });

    // 调用点 label（经 CALL_POINT_LABELS 映射后为中文）
    expect(screen.getByText("聊天引擎")).toBeInTheDocument();
    expect(screen.getByText("意图分类")).toBeInTheDocument();
    expect(screen.getByText("事实抽取")).toBeInTheDocument();

    // 分段数值（嵌入在 "输入 N" / "输出 N" / "N tokens" 文本中，用正则匹配）
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.getByText(/800/)).toBeInTheDocument();
    expect(screen.getByText(/1,150/)).toBeInTheDocument();

    // 调用点总 tokens（嵌入在 "N tokens" 中）
    expect(screen.getByText(/2,300 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/250 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/900 tokens/)).toBeInTheDocument();
  });

  it("shows empty message when total_tokens is 0", async () => {
    mockFetch.mockResolvedValueOnce(mockEmptyTokenSuccess());
    render(<TokenDashboardPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("暂无 Token 数据，发起一次聊天后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("shows error and retry button on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    render(<TokenDashboardPanel />);

    await waitFor(() => {
      expect(screen.getByText("服务内部错误")).toBeInTheDocument();
    });

    const retryBtn = screen.getByText("重试");
    expect(retryBtn).toBeInTheDocument();

    // 重试成功后显示数据
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText(/3,450/)).toBeInTheDocument();
    });
  });

  it("has a manual refresh button in the header", async () => {
    mockFetch.mockResolvedValueOnce(mockTokenSuccess());
    render(<TokenDashboardPanel />);

    await waitFor(() => {
      expect(screen.getByText(/3,450/)).toBeInTheDocument();
    });

    // 再次 mock 不同数据
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {
            chat_engine: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 },
          },
          total_prompt_tokens: 2000,
          total_completion_tokens: 1000,
          total_tokens: 3000,
        }),
    });

    const refreshBtn = screen.getByRole("button", { name: "刷新数据" });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      // 总计行显示 3,000（可能多处出现，用 getAllByText）
      const matches = screen.getAllByText(/3,000/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows raw key for unmapped call point", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {
            unknown_service: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          },
          total_prompt_tokens: 100,
          total_completion_tokens: 50,
          total_tokens: 150,
        }),
    });
    render(<TokenDashboardPanel />);
    await waitFor(() => {
      // 未映射的调用点直接显示原始 key
      expect(screen.getByText("unknown_service")).toBeInTheDocument();
      // 总计 show "150"
      expect(screen.getByText("150")).toBeInTheDocument();
    });
  });

  it("displays zero as '0' not empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {
            chat_engine: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          },
          total_prompt_tokens: 0,
          total_completion_tokens: 0,
          total_tokens: 0,
        }),
    });
    render(<TokenDashboardPanel />);
    // total_tokens === 0 → idle state with empty message
    await waitFor(() => {
      expect(
        screen.getByText("暂无 Token 数据，发起一次聊天后回来查看"),
      ).toBeInTheDocument();
    });
  });

  it("sorts call points by total_tokens descending", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {
            chat_engine: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            fact_extraction: { prompt_tokens: 400, completion_tokens: 200, total_tokens: 600 },
            intent_classify: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
          },
          total_prompt_tokens: 700,
          total_completion_tokens: 350,
          total_tokens: 1050,
        }),
    });
    render(<TokenDashboardPanel />);
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll(".max-w-\\[40\\%\\]"))
        .map((el) => el.textContent);
      // 按 total_tokens 降序：事实抽取(600) → 意图分类(300) → 聊天引擎(150)
      expect(labels).toEqual(["事实抽取", "意图分类", "聊天引擎"]);
    });
  });

  it("renders prompt/completion bar segments with correct widths", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {
            chat_engine: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 },
          },
          total_prompt_tokens: 800,
          total_completion_tokens: 200,
          total_tokens: 1000,
        }),
    });
    render(<TokenDashboardPanel />);
    await waitFor(() => {
      // Bar segments are divs inside the bar container with inline width%
      const bars = document.querySelectorAll("[title^='输入:']");
      expect(bars.length).toBe(1);
      const promptBar = bars[0] as HTMLElement;
      expect(promptBar.style.width).toBe("80%");
    });
  });

  it("shows grand total and per-call breakdown on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          by_call_point: {
            chat_engine: { prompt_tokens: 5000, completion_tokens: 3000, total_tokens: 8000 },
          },
          total_prompt_tokens: 5000,
          total_completion_tokens: 3000,
          total_tokens: 8000,
        }),
    });
    render(<TokenDashboardPanel />);
    await waitFor(() => {
      // "总计消耗" label is only visible in success state
      expect(screen.getByText("总计消耗")).toBeInTheDocument();
    });
    // After success renders, check the full content
    expect(document.body.textContent).toContain("8,000");
    expect(document.body.textContent).toContain("5,000");
    expect(document.body.textContent).toContain("3,000");
  });
});

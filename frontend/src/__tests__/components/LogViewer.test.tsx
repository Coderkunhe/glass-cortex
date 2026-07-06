import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LogViewer from "@/components/observability/LogViewer";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

/** 构造 /logs API 成功响应 */
function mockLogResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        entries: [
          {
            timestamp: "2026-06-23T08:30:00",
            level: "INFO",
            logger: "src.chat.engine",
            message: "ChatEngine initialized",
            raw: '{"level":"INFO","logger":"src.chat.engine","msg":"ChatEngine initialized"}',
          },
          {
            timestamp: "2026-06-23T08:30:01",
            level: "WARNING",
            logger: "src.memory.store",
            message: "Disk usage at 82%",
            raw: '{"level":"WARNING","logger":"src.memory.store","msg":"Disk usage at 82%"}',
          },
          {
            timestamp: "2026-06-23T08:30:02",
            level: "ERROR",
            logger: "src.chat.engine",
            message: "LLM API timeout after 30s",
            raw: '{"level":"ERROR","logger":"src.chat.engine","msg":"LLM API timeout after 30s"}',
          },
        ],
        total_lines: 3,
        file_size_bytes: 4096,
        page: 1,
        page_size: 50,
        ...overrides,
      }),
  };
}

/** 构造错误响应 */
function mockErrorResponse() {
  return {
    ok: false,
    status: 500,
    json: () =>
      Promise.resolve({ error: "internal", detail: "服务内部错误" }),
  };
}

function renderLogViewer() {
  return render(<LogViewer />);
}

describe("LogViewer", () => {
  it("shows loading spinner initially", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderLogViewer();
    expect(screen.getByText("加载日志…")).toBeInTheDocument();
  });

  it("renders log entries on successful fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockLogResponse());
    renderLogViewer();

    await waitFor(() => {
      expect(screen.getByText("ChatEngine initialized")).toBeInTheDocument();
    });

    expect(screen.getByText("Disk usage at 82%")).toBeInTheDocument();
    expect(screen.getByText("LLM API timeout after 30s")).toBeInTheDocument();
  });

  it("shows level color coding in log rows", async () => {
    mockFetch.mockResolvedValueOnce(mockLogResponse());
    renderLogViewer();

    await waitFor(() => {
      expect(screen.getByText("ChatEngine initialized")).toBeInTheDocument();
    });

    // INFO level badge
    const infoBadge = screen.getByText("[INFO]");
    expect(infoBadge.className).toContain("text-info");

    // WARNING level badge
    const warnBadge = screen.getByText("[WARN]");
    expect(warnBadge.className).toContain("text-warning");

    // ERROR level badge
    const errorBadge = screen.getByText("[ERROR]");
    expect(errorBadge.className).toContain("text-danger");
  });

  it("shows pagination controls", async () => {
    mockFetch.mockResolvedValueOnce(mockLogResponse());
    renderLogViewer();

    await waitFor(() => {
      expect(screen.getByText("ChatEngine initialized")).toBeInTheDocument();
    });

    expect(screen.getByText("上一页")).toBeInTheDocument();
    expect(screen.getByText("下一页")).toBeInTheDocument();
  });

  it("shows file metadata", async () => {
    mockFetch.mockResolvedValueOnce(mockLogResponse());
    renderLogViewer();

    await waitFor(() => {
      expect(screen.getByText(/glasscortex\.log/)).toBeInTheDocument();
    });

    expect(screen.getByText("4.0 KB")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows empty state when no entries", async () => {
    mockFetch.mockResolvedValueOnce(
      mockLogResponse({ entries: [], total_lines: 0 }),
    );
    renderLogViewer();

    await waitFor(() => {
      expect(screen.getByText("暂无日志记录")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse());
    renderLogViewer();

    await waitFor(() => {
      // ErrorDisplay 统一错误卡片 — 有 role="alert"
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("level filter changes trigger refetch", async () => {
    mockFetch.mockResolvedValueOnce(mockLogResponse());
    renderLogViewer();

    await waitFor(() => {
      expect(screen.getByText("ChatEngine initialized")).toBeInTheDocument();
    });

    // Click ERROR filter
    mockFetch.mockResolvedValueOnce(
      mockLogResponse({
        entries: [
          {
            timestamp: "2026-06-23T08:30:02",
            level: "ERROR",
            logger: "src.chat.engine",
            message: "LLM API timeout after 30s",
            raw: "...",
          },
        ],
        total_lines: 1,
      }),
    );

    fireEvent.click(screen.getByText("ERROR"));

    await waitFor(() => {
      expect(screen.getByText("LLM API timeout after 30s")).toBeInTheDocument();
    });
  });

  it("collapses long messages with details/summary", async () => {
    const longMsg = "A".repeat(400);
    mockFetch.mockResolvedValueOnce(
      mockLogResponse({
        entries: [
          {
            timestamp: "2026-06-23T08:30:00",
            level: "DEBUG",
            logger: "test",
            message: longMsg,
            raw: "...",
          },
        ],
        total_lines: 1,
      }),
    );
    renderLogViewer();

    await waitFor(() => {
      // 长消息应显示前 300 字符 + "…"
      const summary = document.querySelector("summary");
      expect(summary).toBeTruthy();
      if (summary) {
        expect(summary.textContent).toContain("A".repeat(300));
        expect(summary.textContent).toContain("…");
      }
    });
  });

  it("search input clears with button", async () => {
    mockFetch.mockResolvedValueOnce(mockLogResponse());
    renderLogViewer();

    await waitFor(() => {
      expect(screen.getByText("ChatEngine initialized")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("搜索关键字…");
    fireEvent.change(input, { target: { value: "error" } });

    expect(input).toHaveValue("error");

    const clearBtn = screen.getByLabelText("清除搜索");
    expect(clearBtn).toBeInTheDocument();

    mockFetch.mockResolvedValueOnce(mockLogResponse());
    fireEvent.click(clearBtn);

    expect(input).toHaveValue("");
  });
});

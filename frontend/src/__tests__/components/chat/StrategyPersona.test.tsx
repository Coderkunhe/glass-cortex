import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import type { StrategyPersona as StrategyPersonaType } from "@/lib/api/types";

// ── Mock API (partial — keep other exports like ApiClientError intact) ─

const mockGetStrategyPersonas = vi.fn();

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getStrategyPersonas: (...args: unknown[]) =>
        mockGetStrategyPersonas(...args),
    },
  };
});

import StrategyPersona from "@/components/chat/StrategyPersona";

afterEach(cleanup);

// ── Test data ─────────────────────────────────────────────────────────

const MOCK_PERSONAS: StrategyPersonaType[] = [
  {
    id: "prioritize",
    name: "优先级策略",
    subtitle: "保留重要信息",
    icon: "RiStarLine",
    description: "按相关性得分排序，丢弃低分内容，适合大多数对话场景。",
    color: "#3b82f6",
  },
  {
    id: "truncate",
    name: "截断策略",
    subtitle: "FIFO 先进先出",
    icon: "RiScissorsLine",
    description: "最简单的方式——最早的消息最先被丢弃，无差别对待所有内容。",
    color: "#f59e0b",
  },
  {
    id: "summarize",
    name: "摘要策略",
    subtitle: "压缩旧对话",
    icon: "RiFileReduceLine",
    description: "将超出窗口的旧对话压缩为摘要，保留语义但丢失细节。",
    color: "#10b981",
  },
];

// ── Tests ─────────────────────────────────────────────────────────────

describe("StrategyPersona", () => {
  beforeEach(() => {
    mockGetStrategyPersonas.mockReset();
  });

  // ── Loading state ──

  it("shows loading text while fetching", () => {
    // Never resolve — stays in loading
    mockGetStrategyPersonas.mockReturnValue(new Promise(() => {}));

    render(<StrategyPersona activeStrategy="prioritize" />);

    expect(screen.getByText("加载策略…")).toBeInTheDocument();
  });

  // ── Error state ──

  it("shows ErrorDisplay on fetch failure", async () => {
    // "Failed to fetch" matches NETWORK_MESSAGE_PATTERNS → category "network"
    mockGetStrategyPersonas.mockRejectedValue(new Error("Failed to fetch"));

    render(<StrategyPersona activeStrategy="prioritize" />);

    await waitFor(() => {
      // categorizeError("Failed to fetch") → category "network" →
      // heading "网络连接失败" + userMessage "网络连接失败，请检查网络后重试"
      expect(screen.getByText("网络连接失败")).toBeInTheDocument();
    });
  });

  it("shows ErrorDisplay with inline variant (role=alert)", async () => {
    // "fetch failed" matches NETWORK_MESSAGE_PATTERNS → category "network"
    mockGetStrategyPersonas.mockRejectedValue(new Error("fetch failed"));

    render(<StrategyPersona activeStrategy="prioritize" />);

    await waitFor(() => {
      // ErrorDisplay inline variant renders role="alert"
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("retries fetch when ErrorDisplay onRetry is clicked", async () => {
    mockGetStrategyPersonas.mockRejectedValueOnce(new Error("Failed to fetch"));
    mockGetStrategyPersonas.mockResolvedValueOnce({
      personas: MOCK_PERSONAS,
    });

    render(<StrategyPersona activeStrategy="prioritize" />);

    // Wait for error — network category heading
    await waitFor(() => {
      expect(screen.getByText("网络连接失败")).toBeInTheDocument();
    });

    // Click retry
    fireEvent.click(screen.getByText("重试"));
    expect(mockGetStrategyPersonas).toHaveBeenCalledTimes(2);

    // Should load successfully
    await waitFor(() => {
      expect(screen.getByText("优先级策略")).toBeInTheDocument();
    });
  });

  // ── Loaded state ──

  it("renders all persona names after load", async () => {
    mockGetStrategyPersonas.mockResolvedValue({
      personas: MOCK_PERSONAS,
    });

    render(<StrategyPersona activeStrategy="prioritize" />);

    await waitFor(() => {
      expect(screen.getByText("优先级策略")).toBeInTheDocument();
      expect(screen.getByText("截断策略")).toBeInTheDocument();
      expect(screen.getByText("摘要策略")).toBeInTheDocument();
    });
  });

  it("renders subtitles for all personas", async () => {
    mockGetStrategyPersonas.mockResolvedValue({
      personas: MOCK_PERSONAS,
    });

    render(<StrategyPersona activeStrategy="prioritize" />);

    await waitFor(() => {
      expect(screen.getByText("保留重要信息")).toBeInTheDocument();
    });
  });

  // ── Active persona highlighting ──

  it("shows 当前 badge on the active strategy", async () => {
    mockGetStrategyPersonas.mockResolvedValue({
      personas: MOCK_PERSONAS,
    });

    render(<StrategyPersona activeStrategy="truncate" />);

    await waitFor(() => {
      expect(screen.getByText("当前")).toBeInTheDocument();
    });
  });

  it("renders description only for the active persona", async () => {
    mockGetStrategyPersonas.mockResolvedValue({
      personas: MOCK_PERSONAS,
    });

    render(<StrategyPersona activeStrategy="prioritize" />);

    await waitFor(() => {
      // Active description visible
      expect(
        screen.getByText(/按相关性得分排序/),
      ).toBeInTheDocument();
      // Inactive descriptions should NOT be rendered (they're inside conditional)
      expect(
        screen.queryByText(/最简单的方式/),
      ).not.toBeInTheDocument();
    });
  });

  // ── Sorting — active first ──

  it("sorts active strategy to the top of the list", async () => {
    mockGetStrategyPersonas.mockResolvedValue({
      personas: MOCK_PERSONAS,
    });

    // "summarize" is the last in MOCK_PERSONAS array
    render(<StrategyPersona activeStrategy="summarize" />);

    await waitFor(() => {
      const cards = screen.getAllByText(/策略$/);
      // First card should be the active one
      expect(cards[0].textContent).toBe("摘要策略");
    });
  });

  // ── Visual distinction ──

  it("applies active border/bg classes to active persona", async () => {
    mockGetStrategyPersonas.mockResolvedValue({
      personas: MOCK_PERSONAS,
    });

    const { container } = render(
      <StrategyPersona activeStrategy="prioritize" />,
    );

    await waitFor(() => {
      // Active card has border-brand/40 class
      const activeCard = container.querySelector(".border-brand\\/40");
      expect(activeCard).toBeTruthy();
    });
  });

  it("applies muted opacity to inactive persona cards", async () => {
    mockGetStrategyPersonas.mockResolvedValue({
      personas: MOCK_PERSONAS,
    });

    const { container } = render(
      <StrategyPersona activeStrategy="prioritize" />,
    );

    await waitFor(() => {
      // Inactive cards have opacity-60
      const mutedCards = container.querySelectorAll(".opacity-60");
      // Two inactive personas (truncate + summarize)
      expect(mutedCards.length).toBeGreaterThanOrEqual(2);
    });
  });
});

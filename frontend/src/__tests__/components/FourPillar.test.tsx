import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FourPillar from "@/components/chat/FourPillar";
import type { ChatResponse } from "@/lib/api/types";

const baseContextMeta = {
  window_size: 4096,
  base_tokens: 800,
  memories_before: 3,
  memories_token_before: 420,
  memories_after: 3,
  overflow_applied: false,
  strategy: "prioritize",
  dropped_count: 0,
  dropped_items: [],
  user_message_tokens: 15,
  total_estimated_tokens: 1235,
  usage_pct: 30,
  memories_token_after: 420,
};

const baseApiTrace = {
  caller: "chat",
  model: "deepseek-v4-flash",
  temperature: 0.7,
  max_tokens: 1024,
  elapsed_ms: 423,
  prompt_tokens: 1200,
  completion_tokens: 80,
};

function buildResponse(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    response_text: "这是一个测试回复",
    episode_id: 1,
    intent: {
      category: "提问",
      confidence: 0.92,
      rationale: "用户在询问技术问题",
    },
    context_meta: { ...baseContextMeta, ...overrides.context_meta },
    api_trace: { ...baseApiTrace, ...overrides.api_trace },
    recall_items: overrides.recall_items ?? [
      { id: 101, content: "用户喜欢使用 Python 进行后端开发" },
      {
        id: 102,
        content: "FastAPI 是首选框架",
        subject: "FastAPI",
        relation: "首选",
        object: "框架",
      },
    ],
    ...overrides,
  };
}

describe("FourPillar", () => {
  // ── Collapsed state — card rendering ─────────────────────────────────

  it("renders all 4 pillar titles", () => {
    render(<FourPillar response={buildResponse()} />);
    expect(screen.getByText("记忆设计")).toBeDefined();
    expect(screen.getByText("上下文工程")).toBeDefined();
    expect(screen.getByText("Token 效率")).toBeDefined();
    expect(screen.getByText("任务规划")).toBeDefined();
  });

  it("shows recall count as metric", () => {
    render(<FourPillar response={buildResponse()} />);
    expect(screen.getByText("2")).toBeDefined();
  });

  it("shows ep/fact breakdown in subtitle", () => {
    render(
      <FourPillar
        response={buildResponse({
          recall_items: [
            { id: 1, content: "episode without triple" },
            { id: 2, content: "another episode" },
            {
              id: 3,
              content: "a fact",
              subject: "X",
              relation: "Y",
              object: "Z",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("对话 2 · 事实 1")).toBeDefined();
  });

  it("shows context usage percentage as metric", () => {
    render(<FourPillar response={buildResponse()} />);
    expect(screen.getByText("30%")).toBeDefined();
  });

  it("shows token breakdown in context subtitle", () => {
    render(<FourPillar response={buildResponse()} />);
    expect(screen.getByText("1,235/4,096 tokens")).toBeDefined();
  });

  it("shows overflow indicator in context subtitle when overflow_applied", () => {
    render(
      <FourPillar
        response={buildResponse({
          context_meta: {
            ...baseContextMeta,
            overflow_applied: true,
            usage_pct: 95,
          },
        })}
      />
    );
    expect(screen.getByText("95%")).toBeDefined();
    expect(screen.getByText(/1,235\/4,096 tokens · 溢出/)).toBeDefined();
  });

  it("shows per-message token total as metric", () => {
    render(<FourPillar response={buildResponse()} />);
    expect(screen.getByText("1,280")).toBeDefined();
  });

  it("shows intent category as metric", () => {
    render(<FourPillar response={buildResponse()} />);
    expect(screen.getByText("提问")).toBeDefined();
  });

  it("renders all placeholders when response is null", () => {
    render(<FourPillar response={null} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(4);
    expect(screen.getByText("等待召回")).toBeDefined();
    expect(screen.getByText("等待管线")).toBeDefined();
    expect(screen.getByText("等待调用")).toBeDefined();
    expect(screen.getByText("等待分类")).toBeDefined();
  });

  it("applies staggered animation delays", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll(".gm-card-lift");
    expect(cards.length).toBe(4);
    const delays = Array.from(cards).map(
      (el) => (el as HTMLElement).style.animationDelay
    );
    expect(delays).toEqual(["0ms", "80ms", "160ms", "240ms"]);
  });

  it("renders Remix icons in each pillar", () => {
    const { container } = render(<FourPillar response={buildResponse()} />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(4);
  });

  // ── v2: no arcs, no badges ───────────────────────────────────────────

  it("does NOT render SVG arc overlay (removed in v2)", () => {
    const { container } = render(<FourPillar response={buildResponse()} />);
    // No SVG with role="img" (the arcs were the only such SVG)
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("does NOT render cross-dependency badge chips (removed in v2)", () => {
    render(<FourPillar response={buildResponse()} />);
    // Badge text "· 按需展开" existed in v1 badges — should be absent
    const elems = screen.queryAllByText("· 按需展开");
    expect(elems.length).toBe(0);
  });

  it("cards use aria-label for description, no native title (B102: instant tooltip replaces native title)", () => {
    const { container } = render(<FourPillar response={buildResponse()} />);
    const cards = container.querySelectorAll('[role="button"]');
    expect(cards.length).toBe(4);
    cards.forEach((card) => {
      // B102: native title replaced with instant tooltip; description preserved in aria-label
      expect(card.getAttribute("title")).toBeNull();
      const ariaLabel = card.getAttribute("aria-label");
      expect(ariaLabel).toBeTruthy();
      expect(ariaLabel!.length).toBeGreaterThan(10);
    });
  });

  // ── Expanded state — general interaction ─────────────────────────────

  it("does not expand when clicking with null response", () => {
    render(<FourPillar response={null} />);
    const card = document.querySelector('[role="button"]');
    expect(card).not.toBeNull();
    fireEvent.click(card!);
    expect(screen.queryByText("详情")).toBeNull();
  });

  it("expands detail panel on card click", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    expect(screen.getByText("记忆设计 详情")).toBeDefined();
  });

  it("collapses on second click of same card", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    expect(screen.getByText("记忆设计 详情")).toBeDefined();
    fireEvent.click(cards[0]);
    expect(screen.queryByText("记忆设计 详情")).toBeNull();
  });

  it("switches expanded panel when clicking different card", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    expect(screen.getByText("记忆设计 详情")).toBeDefined();
    fireEvent.click(cards[3]);
    expect(screen.queryByText("记忆设计 详情")).toBeNull();
    expect(screen.getByText("任务规划 详情")).toBeDefined();
  });

  it("closes via close button", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    const closeBtn = screen.getByLabelText("关闭详情");
    fireEvent.click(closeBtn);
    expect(screen.queryByText("记忆设计 详情")).toBeNull();
  });

  it("toggles via Enter key", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.keyDown(cards[0], { key: "Enter" });
    expect(screen.getByText("记忆设计 详情")).toBeDefined();
    fireEvent.keyDown(cards[0], { key: "Enter" });
    expect(screen.queryByText("记忆设计 详情")).toBeNull();
  });

  it("sets aria-expanded correctly", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    expect(cards[0].getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(cards[0]);
    expect(cards[0].getAttribute("aria-expanded")).toBe("true");
  });

  // ── Expanded — Memory visual detail ─────────────────────────────────

  it("shows memory items as cards with 事实/对话片段 labels", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    // Chinese labels for memory item types
    expect(screen.getByText("对话片段")).toBeDefined();
    expect(screen.getByText("事实")).toBeDefined();
  });

  it("shows fact triple notation in memory detail", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    // FastAPI → 首选 → 框架
    expect(screen.getByText(/FastAPI/)).toBeDefined();
  });

  it("shows empty state when no recall items", () => {
    render(
      <FourPillar response={buildResponse({ recall_items: [] })} />
    );
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    expect(screen.getByText("本次无召回记忆")).toBeDefined();
  });

  // ── Expanded — Context visual detail ────────────────────────────────

  it("shows context progress bar in expanded detail", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[1]); // context card
    // Progress bar fill div — now uses inline gradient style, check h-full.rounded-full
    const fills = document.querySelectorAll(".h-full.rounded-full");
    expect(fills.length).toBeGreaterThanOrEqual(1);
  });

  it("shows context stat pills", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[1]);
    expect(screen.getByText("prioritize")).toBeDefined();
    expect(screen.getByText("3 → 3")).toBeDefined();
    expect(screen.getByText("未触发")).toBeDefined();
  });

  it("shows overflow warning pill when triggered", () => {
    render(
      <FourPillar
        response={buildResponse({
          context_meta: {
            ...baseContextMeta,
            overflow_applied: true,
            dropped_count: 5,
          },
        })}
      />
    );
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[1]);
    expect(screen.getByText("丢弃 5 条")).toBeDefined();
  });

  // ── Expanded — Token visual detail ──────────────────────────────────

  it("shows token stacked bar in expanded detail", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[2]); // token card
    // Stacked bar segments use inline gradient styles now; find by h-full inside the flex container
    const barContainer = document.querySelector(".h-2.rounded-full.bg-surface-alt.overflow-hidden.flex");
    expect(barContainer).not.toBeNull();
    const segments = barContainer!.querySelectorAll(".h-full");
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("shows token stat pills with model and elapsed", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[2]);
    expect(screen.getByText("deepseek-v4-flash")).toBeDefined();
    expect(screen.getByText("423ms")).toBeDefined();
  });

  // ── Expanded — Planning visual detail ───────────────────────────────

  it("shows planning confidence ring in expanded detail", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[3]); // planning card
    // Confidence ring SVG with aria-label
    const ring = screen.getByLabelText("置信度 92%");
    expect(ring).toBeDefined();
  });

  it("shows planning category and rationale", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[3]);
    // Category and rationale text
    expect(screen.getByText("用户在询问技术问题")).toBeDefined();
  });

  it("shows no-intent placeholder in planning detail", () => {
    render(
      <FourPillar
        response={buildResponse({
          intent: null as unknown as ChatResponse["intent"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)}
      />
    );
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[3]);
    expect(screen.getByText("暂无意图数据")).toBeDefined();
  });

  // ── Flowchart ────────────────────────────────────────────────────────

  it("renders all 4 flow steps in expanded panel", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    expect(screen.getByText("四支柱流程")).toBeDefined();
    // All four labels appear in the flowchart
    expect(screen.getAllByText("记忆设计").length).toBeGreaterThanOrEqual(2); // card + flow
    expect(screen.getAllByText("上下文工程").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Token 效率").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("任务规划").length).toBeGreaterThanOrEqual(2);
  });

  it("shows feedback loop line in flowchart", () => {
    render(<FourPillar response={buildResponse()} />);
    const cards = document.querySelectorAll('[role="button"]');
    fireEvent.click(cards[0]);
    expect(screen.getByText("反馈循环")).toBeDefined();
  });
});

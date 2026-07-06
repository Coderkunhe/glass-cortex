import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import JourneyCards from "@/components/chat/JourneyCards";
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
  model: "deepseek-chat",
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
      {
        id: 101,
        content: "用户喜欢使用 Python 进行后端开发，偏好 FastAPI 框架",
        similarity: 0.78,
        composite_score: 0.76,
      },
      {
        id: 102,
        content: "用户项目名为 GlassCortex",
        subject: "用户",
        relation: "项目",
        object: "GlassCortex",
        similarity: 0.65,
        composite_score: 0.63,
      },
    ],
    ...overrides,
  };
}

/** 按标签名 + 文本内容查找元素 */
function getByTagText(tag: string, needle: string): HTMLElement {
  const els = Array.from(document.querySelectorAll(tag));
  const found = els.filter((el) => el.textContent?.includes(needle) ?? false);
  if (found.length === 0) throw new Error(`No <${tag}> containing "${needle}"`);
  return found[0] as HTMLElement;
}

describe("JourneyCards", () => {
  // ── 6 张卡片存在性 ──

  it("renders all 6 card titles", () => {
    render(<JourneyCards response={buildResponse()} />);
    ["理解", "召回", "组装", "花费", "回复", "记忆"].forEach((title) => {
      // Titles are in uppercase via CSS, but the text content is the raw string
      const el = getByTagText("span", title);
      expect(el.textContent).toContain(title);
    });
  });

  it("renders the header section", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText("六个镜头，一条消息的完整生命周期 — 点击卡片查看详情")).toBeInTheDocument();
  });

  // ── Card 1: 理解 ──

  it("shows intent category as metric on 理解 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText("提问")).toBeInTheDocument();
  });

  it("shows intent confidence on 理解 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    // Confidence is rendered inside "置信度 92%" text
    expect(screen.getByText(/置信度 92%/)).toBeInTheDocument();
  });

  it("shows intent rationale on 理解 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText("用户在询问技术问题")).toBeInTheDocument();
  });

  it("shows fallback when intent is null", () => {
    render(<JourneyCards response={buildResponse({ intent: null })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("等待分类")).toBeInTheDocument();
  });

  // ── Card 2: 召回 ──

  it("shows recall count on 召回 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/从长期记忆找回/)).toBeInTheDocument();
  });

  it("shows episode vs fact breakdown on 召回 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText(/对话 1 · 事实 1/)).toBeInTheDocument();
  });

  it("shows score range on 召回 card when multiple scores", () => {
    render(<JourneyCards response={buildResponse()} />);
    const summary = getByTagText("div", "评分");
    expect(summary.textContent).toMatch(/65% ~ 78%/);
  });

  it("shows empty state when no recall items", () => {
    render(<JourneyCards response={buildResponse({ recall_items: [] })} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/无相关记忆/)).toBeInTheDocument();
  });

  it("classifies items correctly by episode vs fact heuristics", () => {
    render(
      <JourneyCards
        response={buildResponse({
          recall_items: [
            { id: 1, content: "episode content" }, // no subject/relation/object → episode
            { id: 2, content: "fact", subject: "A", relation: "B", object: "C" }, // fact
            { id: 3, content: "mixed", subject: "X", relation: "Y" }, // fact (has subject)
          ],
        })}
      />,
    );
    expect(screen.getByText(/对话 1 · 事实 2/)).toBeInTheDocument();
  });

  // ── Card 3: 组装 ──

  it("shows total estimated tokens on 组装 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText("1,235")).toBeInTheDocument();
  });

  it("shows usage percentage on 组装 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    const summary = getByTagText("div", "上下文使用率");
    expect(summary.textContent).toMatch(/30%/);
  });

  it("shows overflow_applied indicator on 组装 card", () => {
    render(
      <JourneyCards
        response={buildResponse({
          context_meta: { ...baseContextMeta, overflow_applied: true, usage_pct: 95 },
        })}
      />,
    );
    const summary = getByTagText("div", "上下文使用率");
    expect(summary.textContent).toContain("溢出触发");
  });

  it("shows no overflow indicator when not overflowed", () => {
    render(<JourneyCards response={buildResponse()} />);
    const summary = getByTagText("div", "上下文使用率");
    expect(summary.textContent).toContain("无溢出");
  });

  it("shows window size on 组装 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText(/4,096/)).toBeInTheDocument();
  });

  // ── Card 4: 花费 ──

  it("shows total tokens (prompt + completion) on 花费 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    // 1200 + 80 = 1280 — also shown on 回复 card, so getAllByText
    const els = screen.getAllByText("1,280");
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  it("shows estimated cost on 花费 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    const summary = getByTagText("div", "估算成本");
    expect(summary.textContent).toContain("≈ ¥");
    expect(summary.textContent).toContain("(DeepSeek 定价)");
  });

  // ── Card 5: 回复 ──

  it("shows model name on 回复 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    const summary = getByTagText("div", "deepseek-chat");
    expect(summary).toBeInTheDocument();
  });

  it("shows elapsed time on 回复 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    const summary = getByTagText("div", "423ms");
    expect(summary).toBeInTheDocument();
  });

  it("shows completion tokens on 回复 card", () => {
    render(<JourneyCards response={buildResponse()} />);
    const summary = getByTagText("div", "80 输出 token");
    expect(summary).toBeInTheDocument();
  });

  it("shows fallback metric on 回复 card when prompt_tokens is 0 (error)", () => {
    render(
      <JourneyCards
        response={buildResponse({
          api_trace: { ...baseApiTrace, prompt_tokens: 0, completion_tokens: 0 },
        })}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/回复生成失败/)).toBeInTheDocument();
  });

  // ── Card 6: 记忆 ──

  it("shows stored count on 记忆 card (1 message + 0 facts by default)", () => {
    render(<JourneyCards response={buildResponse()} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    const summary = getByTagText("div", "存储了");
    expect(summary.textContent).toContain("1 条消息");
  });

  it("shows fact counts when fact_extraction_trace is present in context_meta", () => {
    render(
      <JourneyCards
        response={buildResponse({
          context_meta: {
            ...baseContextMeta,
            fact_extraction_trace: {
              status: "ok",
              parsed_triples: [{}, {}, {}],
              stored_fact_ids: [1, 2],
              cache_hit: false,
            },
          },
        })}
      />,
    );
    // 1 msg + 2 stored facts = 3
    expect(screen.getByText("3")).toBeInTheDocument();
    const summary = getByTagText("div", "存储了");
    expect(summary.textContent).toContain("2 个事实");
    expect(summary.textContent).toContain("3 个三元组");
  });

  it("shows cache hit indicator on 记忆 card", () => {
    render(
      <JourneyCards
        response={buildResponse({
          context_meta: {
            ...baseContextMeta,
            fact_extraction_trace: {
              status: "ok",
              parsed_triples: [{}],
              stored_fact_ids: [],
              cache_hit: true,
            },
          },
        })}
      />,
    );
    const summary = getByTagText("div", "存储了");
    expect(summary.textContent).toContain("事实缓存命中");
  });

  // ── 动画 ──

  it("has staggered animation delays on cards", () => {
    const { container } = render(<JourneyCards response={buildResponse()} />);
    const cardEls = container.querySelectorAll('[style*="animation-delay"]');
    expect(cardEls.length).toBe(6);
    const delays = Array.from(cardEls).map((el) =>
      (el as HTMLElement).style.animationDelay,
    );
    // Row 1: 0ms, 80ms, 160ms
    expect(delays[0]).toBe("0ms");
    expect(delays[1]).toBe("80ms");
    expect(delays[2]).toBe("160ms");
    // Row 2: 240ms, 320ms, 400ms
    expect(delays[3]).toBe("240ms");
    expect(delays[4]).toBe("320ms");
    expect(delays[5]).toBe("400ms");
  });

  // ── 边缘状态 ──

  it("handles empty recall_items gracefully", () => {
    render(
      <JourneyCards
        response={buildResponse({ recall_items: [] })}
      />,
    );
    // 6 cards still render
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("handles single recall item (no score range)", () => {
    render(
      <JourneyCards
        response={buildResponse({
          recall_items: [
            { id: 1, content: "single item", similarity: 0.5 },
          ],
        })}
      />,
    );
    const summary = getByTagText("div", "从长期记忆找回");
    expect(summary.textContent).not.toContain("~");
    expect(summary.textContent).toContain("50%");
  });
});

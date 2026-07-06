import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OnionPanel from "@/components/chat/OnionPanel";
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

/** 长内容（>120 字符），触发截断逻辑 */
const LONG_CONTENT =
  "用户的 AI 项目名为 GlassCortex，目标是透明化 AI 认知层各个组件的运行过程——" +
  "从记忆形成到上下文工程再到意图识别，涵盖上下文组装、Token 计量、意图分类、" +
  "以及 Planner 任务规划等多个模块，技术栈包括 Python FastAPI 和 Next.js。";

function buildResponse(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    response_text: "这是一个测试回复",
    episode_id: 1,
    intent: {
      category: "提问",
      confidence: 0.92,
      rationale: "用户在询问技术问题",
    },
    context_meta: { ...baseContextMeta },
    api_trace: { ...baseApiTrace },
    recall_items: [
      {
        id: 101,
        content: "用户喜欢使用 Python 进行后端开发，偏好 FastAPI 框架",
        confidence: 0.85,
        source_episode_id: 5,
        subject: "用户",
        relation: "喜欢",
        object: "Python",
        similarity: 0.78,
      },
      {
        id: 102,
        content: LONG_CONTENT,
        confidence: 0.9,
        source_episode_id: 7,
        subject: "用户",
        relation: "项目",
        object: "GlassCortex",
        similarity: 0.65,
      },
    ],
    ...overrides,
  };
}

/** 按标签名 + 部分文本精确查找单个元素 */
function getByTagText(tag: string, needle: string): HTMLElement {
  const els = Array.from(document.querySelectorAll(tag));
  const found = els.filter((el) => el.textContent?.includes(needle) ?? false);
  if (found.length === 0) throw new Error(`No <${tag}> containing "${needle}"`);
  if (found.length > 1) throw new Error(`Multiple <${tag}> containing "${needle}"`);
  return found[0] as HTMLElement;
}

describe("OnionPanel", () => {
  // ── L1: 意图识别 ──
  it("renders L1 intent header", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("🎯 意图识别")).toBeInTheDocument();
  });

  it("shows intent category badge with correct label", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("提问")).toBeInTheDocument();
  });

  it("shows intent confidence as percentage", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("shows intent rationale", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("用户在询问技术问题")).toBeInTheDocument();
  });

  it("shows fallback when intent is null", () => {
    render(<OnionPanel response={buildResponse({ intent: null })} />);
    expect(screen.getByText("未识别")).toBeInTheDocument();
  });

  it("shows correct color for 闲聊 category", () => {
    render(
      <OnionPanel
        response={buildResponse({
          intent: { category: "闲聊", confidence: 0.8, rationale: "打招呼" },
        })}
      />
    );
    expect(screen.getByText("闲聊")).toBeInTheDocument();
  });

  // ── L2: 记忆召回 ──
  it("renders L2 recall header with count", () => {
    render(<OnionPanel response={buildResponse()} />);
    // <p> 包含 "🧠 记忆召回 · 检索到" 文本（与 span.2.条记忆 混合）
    const p = getByTagText("p", "🧠 记忆召回");
    expect(p.textContent).toMatch(/检索到\s+2\s+条相关记忆/);
    // 存在至少一个精确匹配 "2" 的元素（header + narrative 共 2 个）
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });

  it("shows zero recall count correctly", () => {
    render(<OnionPanel response={buildResponse({ recall_items: [] })} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows empty state message when no recall items", () => {
    render(<OnionPanel response={buildResponse({ recall_items: [] })} />);
    expect(screen.getByText(/暂无相关记忆/)).toBeInTheDocument();
  });

  it("renders recall items with truncated content", () => {
    render(<OnionPanel response={buildResponse()} />);
    // First item: short enough, shown in full
    expect(screen.getByText("用户喜欢使用 Python 进行后端开发，偏好 FastAPI 框架")).toBeInTheDocument();
    // Second item: >120 chars, truncated with "…"
    const truncatedEl = getByTagText("button", "GlassCortex");
    expect(truncatedEl.textContent).toContain("…");
    expect(truncatedEl.textContent!.length).toBeLessThan(LONG_CONTENT.length);
  });

  it("renders similarity score for recall items", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("78.0%")).toBeInTheDocument();
    expect(screen.getByText("65.0%")).toBeInTheDocument();
  });

  it("expands recall item row on click", () => {
    render(<OnionPanel response={buildResponse()} />);
    // Full long content NOT visible when collapsed
    expect(screen.queryByText(LONG_CONTENT)).not.toBeInTheDocument();
    // Click the truncated button to expand
    const btn = getByTagText("button", "GlassCortex");
    fireEvent.click(btn);
    // Full content now visible
    expect(screen.getByText(LONG_CONTENT)).toBeInTheDocument();
  });

  it("collapses expanded recall item on second click", () => {
    render(<OnionPanel response={buildResponse()} />);
    const btn = getByTagText("button", "GlassCortex");
    // Expand
    fireEvent.click(btn);
    expect(screen.getByText(LONG_CONTENT)).toBeInTheDocument();
    // Collapse
    fireEvent.click(btn);
    expect(screen.queryByText(LONG_CONTENT)).not.toBeInTheDocument();
  });

  // ── L3: 上下文窗口 ──
  it("renders L3 context window header", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("📐 上下文窗口")).toBeInTheDocument();
  });

  it("renders ContextBar with token info", () => {
    render(<OnionPanel response={buildResponse()} />);
    // "1,235" appears both in ContextWindowPanel header and table body (always in DOM).
    // getAllByText handles duplicates.
    expect(screen.getAllByText("1,235").length).toBeGreaterThanOrEqual(1);
    // ContextBar <span> text includes window_size and percentage
    const span = getByTagText("span", "tokens (30%)");
    expect(span.textContent).toContain("4,096");
    expect(span.textContent).toContain("30%");
  });

  it("shows overflow warning when overflow_applied is true", () => {
    render(
      <OnionPanel
        response={buildResponse({
          context_meta: {
            ...baseContextMeta,
            overflow_applied: true,
            dropped_count: 5,
          },
        })}
      />
    );
    // ContextBar 增强版在 overflow badge 中显示 "溢出 5 条"
    expect(screen.getByText(/溢出 5 条/)).toBeInTheDocument();
  });

  it("does not show overflow warning when overflow_applied is false", () => {
    render(<OnionPanel response={buildResponse()} />);
    // Overflow badge text is "溢出 N 条", not the lens trigger "溢出策略怎么选"
    expect(screen.queryByText(/溢出 \d+ 条/)).not.toBeInTheDocument();
  });

  // ── L4/L5: 模型推理面板 ──
  it("renders L5 model inference panel", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("L5 模型推理")).toBeInTheDocument();
  });

  it("shows model name", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("deepseek-chat")).toBeInTheDocument();
  });

  it("shows elapsed time in milliseconds", () => {
    render(<OnionPanel response={buildResponse()} />);
    // "423ms" in L5 panel summary row
    expect(screen.getByText("423ms")).toBeInTheDocument();
  });

  it("shows token counts with proper formatting", () => {
    render(<OnionPanel response={buildResponse()} />);
    // prompt tokens "1,200" — in <span>, exact match
    expect(screen.getByText("1,200")).toBeInTheDocument();
    // completion "80" — in <span>, exact match
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  // ── Edge cases ──
  it("handles zero elapsed time", () => {
    render(
      <OnionPanel
        response={buildResponse({
          api_trace: { ...baseApiTrace, elapsed_ms: 0 },
        })}
      />
    );
    expect(screen.getByText("0ms")).toBeInTheDocument();
  });

  it("handles recall items with composite_score instead of similarity", () => {
    render(
      <OnionPanel
        response={buildResponse({
          recall_items: [
            {
              id: 201,
              content: "测试记忆内容",
              composite_score: 0.55,
            },
          ],
        })}
      />
    );
    expect(screen.getByText("55.0%")).toBeInTheDocument();
  });

  it("handles recall items with no score at all", () => {
    render(
      <OnionPanel
        response={buildResponse({
          recall_items: [
            { id: 301, content: "没有评分的记忆" },
          ],
        })}
      />
    );
    expect(screen.getByText("没有评分的记忆")).toBeInTheDocument();
  });

  it("renders multiple recall items correctly", () => {
    render(<OnionPanel response={buildResponse()} />);
    // Both items present
    expect(screen.getByText("用户喜欢使用 Python 进行后端开发，偏好 FastAPI 框架")).toBeInTheDocument();
    expect(getByTagText("button", "GlassCortex")).toBeInTheDocument();
    // Two scores
    expect(screen.getByText("78.0%")).toBeInTheDocument();
    expect(screen.getByText("65.0%")).toBeInTheDocument();
  });

  it("shows correct layout structure with 4 layers in order", () => {
    render(<OnionPanel response={buildResponse()} />);
    const l1 = screen.getByText("🎯 意图识别");
    const l2 = getByTagText("p", "🧠 记忆召回");
    const l3 = screen.getByText("📐 上下文窗口");
    const l4 = screen.getByText("L5 模型推理");

    const container = l1.closest('[class*="space-y"]')!;
    const children = Array.from(container.children);
    expect(children.length).toBe(4);

    function childIndex(el: HTMLElement): number {
      return children.findIndex((c) => c.contains(el));
    }
    expect(childIndex(l1)).toBe(0);
    expect(childIndex(l2)).toBe(1);
    expect(childIndex(l3)).toBe(2);
    expect(childIndex(l4)).toBe(3);
  });

  // ── 溢出策略透镜 (Phase 35 Batch 2) ──

  it("renders overflow strategy lens trigger in L3", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("📐 溢出策略怎么选？")).toBeInTheDocument();
  });

  it("does not render overflow lens when chart extraction fails", () => {
    // OnionPanel always renders with valid CH1_ANSWERS[0] which has mermaid,
    // so the lens should always be present. This test verifies the guard
    // doesn't crash on normal data.
    render(<OnionPanel response={buildResponse()} />);
    // Lens trigger found — chart extracted successfully
    expect(screen.getByText("📐 溢出策略怎么选？")).toBeInTheDocument();
  });

  it("shows correct intent color for each category", () => {
    const categories = ["闲聊", "提问", "指令", "探索", "澄清"] as const;
    for (const cat of categories) {
      const { unmount } = render(
        <OnionPanel
          response={buildResponse({
            intent: { category: cat, confidence: 0.9, rationale: "测试" },
          })}
        />
      );
      expect(screen.getByText(cat)).toBeInTheDocument();
      unmount();
    }
  });

  // ── Batch 148: 召回叙事面板 ──
  it("shows recall narrative with score range", () => {
    render(<OnionPanel response={buildResponse()} />);
    // 叙事包含"综合评分排序"
    expect(screen.getByText(/综合评分排序/)).toBeInTheDocument();
    // 叙事包含评分范围
    expect(screen.getByText(/评分范围/)).toBeInTheDocument();
    // 叙事包含具体评分值（模拟数据中两条 item 的 score）
    expect(screen.getByText(/78%/)).toBeInTheDocument();
    expect(screen.getByText(/65%/)).toBeInTheDocument();
  });

  it("shows recall count in narrative for non-empty recall", () => {
    render(<OnionPanel response={buildResponse()} />);
    // textContent 包含检索到的数量（文本跨越多个子元素）
    const narrativePs = screen.getAllByText(/系统从记忆中检索到/);
    expect(narrativePs.length).toBeGreaterThanOrEqual(1);
    expect(narrativePs[0].textContent).toMatch(/检索到 2 条相关内容/);
  });

  // ── onCollapse prop (Phase 35 Batch 3) ──

  it("renders collapse header and calls onCollapse when clicked", () => {
    const onCollapse = vi.fn();
    render(<OnionPanel response={buildResponse()} onCollapse={onCollapse} />);
    // 顶部收起行应渲染
    const collapseBtn = screen.getByText("收起洋葱面板");
    expect(collapseBtn).toBeInTheDocument();
    fireEvent.click(collapseBtn);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("does not render collapse header when onCollapse is not provided", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.queryByText("收起洋葱面板")).not.toBeInTheDocument();
  });

  // ── 召回记忆透镜 (Phase 36 Batch 1) ──

  it("renders recall origin lens trigger when recall items exist", () => {
    render(<OnionPanel response={buildResponse()} />);
    expect(screen.getByText("🧠 这些记忆怎么来的？")).toBeInTheDocument();
  });

  it("does not render recall origin lens when recall items empty", () => {
    render(<OnionPanel response={buildResponse({ recall_items: [] })} />);
    expect(screen.queryByText("🧠 这些记忆怎么来的？")).not.toBeInTheDocument();
  });

  it("expands recall origin lens on click", () => {
    render(<OnionPanel response={buildResponse()} />);
    fireEvent.click(screen.getByText("🧠 这些记忆怎么来的？"));
    expect(screen.getByText("事实抽取：AI 如何从对话中提取记忆")).toBeInTheDocument();
  });

  // ── RecallItemRow 衰减数据 (Phase 36 Batch 1) ──

  it("shows confidence bar for fact recall items", () => {
    render(<OnionPanel response={buildResponse()} />);
    // Expand first recall item to see decay stats
    const items = screen.getAllByText(/喜欢|项目/);
    fireEvent.click(items[0]); // expand first item
    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument(); // confidence = 0.85
  });

  it("shows strength bar for episode-type recall items", () => {
    render(
      <OnionPanel
        response={buildResponse({
          recall_items: [
            {
              id: 201,
              content: "用户讨论过 Python 异步编程",
              importance: 0.8,
              initial_strength: 0.9,
              lambda: 0.0005,
              access_count: 3,
              composite_score: 0.72,
              similarity: 0.72,
            },
          ],
        })}
      />,
    );
    // Expand the recall item
    fireEvent.click(screen.getByText(/Python 异步编程/));
    expect(screen.getByText("当前强度")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument(); // 0.72/0.9 = 80%
  });

  it("shows access count in expanded recall item", () => {
    render(
      <OnionPanel
        response={buildResponse({
          recall_items: [
            {
              id: 301,
              content: "重复访问的测试记忆",
              importance: 0.6,
              initial_strength: 0.8,
              access_count: 12,
              composite_score: 0.64,
              similarity: 0.64,
            },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByText("重复访问的测试记忆"));
    expect(screen.getByText(/已访问/)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows lambda decay rate in expanded recall item", () => {
    render(
      <OnionPanel
        response={buildResponse({
          recall_items: [
            {
              id: 401,
              content: "带衰减速率的测试记忆",
              importance: 0.5,
              initial_strength: 0.7,
              lambda: 0.0023,
              access_count: 1,
              composite_score: 0.56,
              similarity: 0.56,
            },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByText("带衰减速率的测试记忆"));
    expect(screen.getByText(/衰减速率 λ/)).toBeInTheDocument();
    expect(screen.getByText("0.0023")).toBeInTheDocument();
  });

  it("does not show strength bar when item has no initial_strength", () => {
    render(<OnionPanel response={buildResponse()} />);
    // buildResponse items are fact-type (have confidence, no initial_strength)
    const items = screen.getAllByText(/喜欢|项目/);
    fireEvent.click(items[0]);
    // Should show confidence, not strength
    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.queryByText("当前强度")).not.toBeInTheDocument();
  });
});

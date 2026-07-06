import { describe, it, expect } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DrawerProvider, useDrawer } from "@/components/chat/DrawerContext";
import ProcessDrawer from "@/components/chat/ProcessDrawer";
import type { ApiTrace } from "@/lib/api/types";

// ── Test utilities ────────────────────────────────────────────────────

/** 测试用 base trace */
const baseTrace: ApiTrace = {
  caller: "chat",
  model: "deepseek-chat",
  temperature: 0.7,
  max_tokens: 1024,
  elapsed_ms: 423,
  prompt_tokens: 1200,
  completion_tokens: 80,
};

/** 带 extra 字段的 trace */
const baseWithExtras: ApiTrace & Record<string, unknown> = {
  ...baseTrace,
  system_prompt: "你是一个有记忆的 AI 助手。",
  user_prompt: "请帮我解释记忆衰减机制。",
  raw_response: "好的，记忆衰减是基于艾宾浩斯遗忘曲线……",
  parsed_result: '{"category": "提问", "confidence": 0.95}',
  parse_error: null,
};

/** 在 DrawerProvider 内渲染 ProcessDrawer，并通过 harness 预打开抽屉。
 *  Drawer 有 requestAnimationFrame 动画状态机，调用方需 waitFor dialog 出现。 */
function renderDrawer(trace: ApiTrace = baseWithExtras) {
  function Harness() {
    const { openDrawer } = useDrawer();
    useEffect(() => { openDrawer(trace); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }
  return render(
    <DrawerProvider>
      <Harness />
      <ProcessDrawer />
    </DrawerProvider>,
  );
}

/** 等待抽屉打开（Drawer useEffent + rAF 动画完成后 dialog 才可见） */
async function waitForDrawer() {
  await waitFor(() => {
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("ProcessDrawer", () => {
  // ── 基础渲染 ──

  it("renders backdrop and drawer when open=true", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("LLM 调用档案")).toBeInTheDocument();
  });

  it("renders nothing when no trace is opened", () => {
    const { container } = render(
      <DrawerProvider>
        <ProcessDrawer />
      </DrawerProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  // ── 4 个 Section 标题 ──

  it("shows Request section", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("请求参数")).toBeInTheDocument();
  });

  it("shows Response section", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("模型响应")).toBeInTheDocument();
  });

  it("shows Parse section", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("意图解析")).toBeInTheDocument();
  });

  it("shows Token section", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("Token 消耗统计")).toBeInTheDocument();
  });

  // ── 标题 ──

  it("shows drawer header LLM branding", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("LLM 调用档案")).toBeInTheDocument();
  });

  // ── KV 字段 ──

  it("shows model in KV", async () => {
    renderDrawer();
    await waitForDrawer();
    // model 名同时出现在 header badge 和 KV 行中，至少出现 2 次
    expect(screen.getAllByText("deepseek-chat").length).toBeGreaterThanOrEqual(2);
  });

  it("shows temperature in KV", async () => {
    renderDrawer();
    await waitForDrawer();
    // Prism highlighting wraps "0.7" in <span class="token number"> inside code blocks
    expect(screen.getByText("温度").parentElement).toHaveTextContent("0.7");
  });

  it("shows max_tokens in KV", async () => {
    renderDrawer();
    await waitForDrawer();
    // Prism highlighting wraps "1024" in a <span class="token number"> inside code blocks,
    // so getByText("1024") would match multiple elements. Query by label instead.
    expect(screen.getByText("最大 Token").parentElement).toHaveTextContent("1024");
  });

  it("shows elapsed_ms in KV", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("423 ms")).toBeInTheDocument();
  });

  it("shows prompt_tokens in KV", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("shows completion_tokens in KV", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("shows total_tokens (prompt + completion) in KV", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("1,280")).toBeInTheDocument();
  });

  // ── 代码块 ──

  it("shows system_prompt code block", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("你是一个有记忆的 AI 助手。")).toBeInTheDocument();
  });

  it("shows user_prompt code block", async () => {
    renderDrawer();
    await waitForDrawer();
    expect(screen.getByText("请帮我解释记忆衰减机制。")).toBeInTheDocument();
  });

  it("shows raw_response code block", async () => {
    renderDrawer(baseWithExtras);
    await waitForDrawer();
    expect(screen.getByText(/记忆衰减是基于/)).toBeInTheDocument();
  });

  it("shows parsed_result as JSON block only in intent section (not model response)", async () => {
    renderDrawer(baseWithExtras);
    await waitForDrawer();
    // P0 fix: parsed_result is Planner output, only shown in Section 3 (Parsed Result)
    // Section 2 no longer duplicates it — exactly one occurrence
    const matches = screen.getAllByText(/"提问"/);
    expect(matches.length).toBe(1);
  });

  // ── Parse Error ──

  it("shows Parse Status as OK when no parse_error", async () => {
    renderDrawer(baseWithExtras);
    await waitForDrawer();
    expect(screen.getByText(/正常/)).toBeInTheDocument();
    expect(screen.getByText(/意图分类成功/)).toBeInTheDocument();
  });

  it("shows parse_error from main engine when present (fallback)", async () => {
    const traceWithErr: ApiTrace & Record<string, unknown> = {
      ...baseTrace,
      system_prompt: "",
      user_prompt: "",
      raw_response: "",
      parsed_result: "",
      parse_error: "JSON parse failed: unexpected token",
    };
    renderDrawer(traceWithErr);
    await waitForDrawer();
    expect(screen.getByText("JSON parse failed: unexpected token")).toBeInTheDocument();
    expect(screen.queryByText(/正常/)).not.toBeInTheDocument();
  });

  it("prefers planner_parse_error over main engine parse_error (P1 fix)", async () => {
    const traceWithPlannerErr: ApiTrace & Record<string, unknown> = {
      ...baseTrace,
      system_prompt: "",
      user_prompt: "",
      raw_response: "",
      parsed_result: "",
      parse_error: "main engine parse error — should be hidden",
      planner_parse_error: "Planner JSON decode error: invalid classification format",
    };
    renderDrawer(traceWithPlannerErr);
    await waitForDrawer();
    // Should show planner error (priority), not main engine error
    expect(screen.getByText("Planner JSON decode error: invalid classification format")).toBeInTheDocument();
    expect(screen.queryByText(/main engine parse error/)).not.toBeInTheDocument();
  });

  // ── 关闭操作 ──

  it("calls closeDrawer when close button is clicked", async () => {
    render(
      <DrawerProvider>
        <ProcessDrawerOpener trace={baseWithExtras} />
        <ProcessDrawer />
      </DrawerProvider>,
    );
    await waitForDrawer();
    // Click close
    fireEvent.click(screen.getByLabelText("关闭"));
    // 等待 300ms 退出动画完成后 dialog 应消失
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("calls closeDrawer when backdrop is clicked", async () => {
    render(
      <DrawerProvider>
        <ProcessDrawerOpener trace={baseWithExtras} />
        <ProcessDrawer />
      </DrawerProvider>,
    );
    await waitForDrawer();
    // Backdrop is first child of the fragment (fixed overlay)
    const backdrop = document.querySelector('[class*="fixed"][class*="inset-0"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("calls closeDrawer when Escape key is pressed", async () => {
    render(
      <DrawerProvider>
        <ProcessDrawerOpener trace={baseWithExtras} />
        <ProcessDrawer />
      </DrawerProvider>,
    );
    await waitForDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("does NOT close on non-Escape key press", async () => {
    render(
      <DrawerProvider>
        <ProcessDrawerOpener trace={baseWithExtras} />
        <ProcessDrawer />
      </DrawerProvider>,
    );
    await waitForDrawer();
    fireEvent.keyDown(document, { key: "Enter" });
    // Dialog should still be open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // ── 空 extra 字段 ──

  it("handles empty extra fields gracefully", async () => {
    const minimalTrace: ApiTrace = { ...baseTrace };
    renderDrawer(minimalTrace);
    await waitForDrawer();
    // model 名同时出现在 header badge 和 KV 行
    expect(screen.getAllByText("deepseek-chat").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1,280")).toBeInTheDocument();
    expect(screen.getByText("请求参数")).toBeInTheDocument();
  });

  // ── Section 5: Task Planning ──

  it("shows Task Planning section when plan_subtasks are present", async () => {
    const traceWithPlan: ApiTrace & Record<string, unknown> = {
      ...baseTrace,
      plan_subtasks: [
        { id: "1", description: "获取数据", depends_on: [] },
        { id: "2", description: "分析数据", depends_on: ["1"] },
      ],
      plan_dag_edges: [["1", "2"]],
      plan_rationale: "先获取再分析",
      plan_confidence: 0.85,
    };
    renderDrawer(traceWithPlan);
    await waitForDrawer();
    expect(screen.getByText("任务规划")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // subtask count
    expect(screen.getByText("85%")).toBeInTheDocument(); // confidence
    expect(screen.getByText("先获取再分析")).toBeInTheDocument();
  });

  it("hides Task Planning section when no plan_subtasks", async () => {
    renderDrawer(baseWithExtras);
    await waitForDrawer();
    expect(screen.queryByText("任务规划")).not.toBeInTheDocument();
  });

  it("shows plan token stats when plan_token_usage is present", async () => {
    const traceWithPlanTokens: ApiTrace & Record<string, unknown> = {
      ...baseTrace,
      plan_subtasks: [{ id: "1", description: "单任务", depends_on: [] }],
      plan_dag_edges: [],
      plan_rationale: "简单",
      plan_confidence: 0.9,
      plan_token_usage: { prompt_tokens: 200, completion_tokens: 50 },
    };
    renderDrawer(traceWithPlanTokens);
    await waitForDrawer();
    expect(screen.getByText("任务规划")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument(); // planner input tokens
    expect(screen.getByText("50")).toBeInTheDocument(); // planner output tokens
  });
});

/** 在挂载时自动打开抽屉的辅助组件 */
function ProcessDrawerOpener({ trace }: { trace: ApiTrace }) {
  const { openDrawer } = useDrawer();
  useEffect(() => { openDrawer(trace); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ModelInferencePanel from "@/components/chat/ModelInferencePanel";
import type { ApiTrace } from "@/lib/api/types";

const baseApiTrace: ApiTrace = {
  caller: "chat",
  model: "deepseek-v4-flash",
  temperature: 0.7,
  max_tokens: 1024,
  elapsed_ms: 423,
  prompt_tokens: 1200,
  completion_tokens: 80,
  // token_breakdown injected by backend (Phase 38 Batch 1) — via index signature
  token_breakdown: {
    pricing: { input_per_1m: 2.0, output_per_1m: 2.0 },
  },
} as ApiTrace;

function buildTrace(overrides: Partial<ApiTrace> = {}): ApiTrace {
  return { ...baseApiTrace, ...overrides };
}

describe("ModelInferencePanel", () => {
  beforeEach(() => {
    cleanup();
  });

  // ── Tier 1: 摘要行 ──────────────────────────────────────────────────

  it("renders model name in badge", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
  });

  it("renders elapsed time", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    expect(screen.getByText("423ms")).toBeInTheDocument();
  });

  it("renders total tokens", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    // 1200 + 80 = 1280
    expect(screen.getByText("1,280")).toBeInTheDocument();
  });

  it("renders section title L5 模型推理", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    expect(screen.getByText("L5 模型推理")).toBeInTheDocument();
  });

  // ── Token stat cards ──────────────────────────────────────────────────

  it("renders prompt token count", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("Prompt")).toBeInTheDocument();
  });

  it("renders completion token count", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ completion_tokens: 250 })} />);
    expect(screen.getByText("250")).toBeInTheDocument();
    expect(screen.getByText("Completion")).toBeInTheDocument();
  });

  it("renders cost estimate", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    // 1280 * 2 / 1e6 = 0.00256
    expect(screen.getByText("¥0.0026")).toBeInTheDocument();
  });

  it("renders tok/s when elapsed_ms > 0", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ elapsed_ms: 1000, prompt_tokens: 500, completion_tokens: 500 })} />);
    // 1000 tokens / 1s = 1000 tok/s
    expect(screen.getByText("1,000 tok/s")).toBeInTheDocument();
  });

  it("does not render tok/s when elapsed_ms is 0", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ elapsed_ms: 0 })} />);
    expect(screen.queryByText(/tok\/s/)).not.toBeInTheDocument();
  });

  // ── Expand/collapse ───────────────────────────────────────────────────

  it("starts collapsed (Tier 2 hidden)", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
    expect(screen.queryByText("Max Tokens")).not.toBeInTheDocument();
  });

  it("expands to show KV rows on header click", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByText("Max Tokens")).toBeInTheDocument();
    expect(screen.getByText("Caller")).toBeInTheDocument();
  });

  it("shows correct temperature value", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ temperature: 1.5 })} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.getByText("1.5")).toBeInTheDocument();
  });

  it("shows max_tokens value", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ max_tokens: 2048 })} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.getByText("2,048")).toBeInTheDocument();
  });

  it("shows caller value", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ caller: "planner" })} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.getByText("planner")).toBeInTheDocument();
  });

  it("shows — for empty caller", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ caller: "" })} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ── Extra fields: raw_response ────────────────────────────────────────

  it("shows raw_response code block when present", () => {
    const trace = buildTrace();
    (trace as Record<string, unknown>).raw_response = '{"choices":[{"message":{"content":"hello"}}]}';
    render(<ModelInferencePanel apiTrace={trace} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.getByText("Raw Response")).toBeInTheDocument();
    expect(screen.getByText(/{"choices":/)).toBeInTheDocument();
  });

  it("does not show raw_response block when absent", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.queryByText("Raw Response")).not.toBeInTheDocument();
  });

  // ── Extra fields: parsed_result ───────────────────────────────────────

  it("shows parsed_result block when present", () => {
    const trace = buildTrace();
    (trace as Record<string, unknown>).parsed_result = { intent: "提问", confidence: 0.9 };
    render(<ModelInferencePanel apiTrace={trace} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.getByText("Parsed Result")).toBeInTheDocument();
  });

  it("does not show parsed_result block when absent", () => {
    render(<ModelInferencePanel apiTrace={buildTrace()} />);
    fireEvent.click(screen.getByText("L5 模型推理"));
    expect(screen.queryByText("Parsed Result")).not.toBeInTheDocument();
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it("handles zero tokens gracefully", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ prompt_tokens: 0, completion_tokens: 0 })} />);
    expect(screen.getByText("¥0.0000")).toBeInTheDocument();
  });

  it("handles large token counts", () => {
    render(<ModelInferencePanel apiTrace={buildTrace({ prompt_tokens: 100000, completion_tokens: 50000 })} />);
    expect(screen.getByText("150,000")).toBeInTheDocument();
  });
});

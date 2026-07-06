import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ChatParamsProvider,
  useChatParams,
} from "@/components/chat/ChatParamsContext";
import {
  DEFAULT_L2_RECALL,
  DEFAULT_L3_CONTEXT,
  DEFAULT_L5_INFERENCE,
  DEFAULT_L6_DECAY,
} from "@/lib/chatParams";

afterEach(cleanup);

/** Test component that consumes ChatParamsContext and exposes state + actions */
function TestConsumer() {
  const ctx = useChatParams();
  return (
    <div>
      <span data-testid="l2-top_k">{ctx.l2.top_k}</span>
      <span data-testid="l2-recall_threshold">{ctx.l2.recall_threshold}</span>
      <span data-testid="l3-window_size">{ctx.l3.window_size}</span>
      <span data-testid="l3-strategy">{ctx.l3.overflow_strategy}</span>
      <span data-testid="l5-model">{ctx.l5.model}</span>
      <span data-testid="l5-temperature">{ctx.l5.temperature}</span>
      <span data-testid="l6-lambda">{ctx.l6.lambda}</span>
      <span data-testid="stats-messageCount">{ctx.stats.messageCount}</span>
      <span data-testid="stats-memoryCount">{ctx.stats.memoryCount}</span>
      <span data-testid="stats-sessionStart">{ctx.stats.sessionStart}</span>
      <button
        data-testid="set-l2"
        onClick={() => ctx.setL2({ top_k: 10, recall_threshold: 0.5 })}
      >
        Set L2
      </button>
      <button
        data-testid="set-l3"
        onClick={() =>
          ctx.setL3({ window_size: 8192, overflow_strategy: "truncate" })
        }
      >
        Set L3
      </button>
      <button
        data-testid="set-l5"
        onClick={() => ctx.setL5({ temperature: 1.5 })}
      >
        Set L5
      </button>
      <button
        data-testid="set-l6"
        onClick={() => ctx.setL6({ lambda: 0.5 })}
      >
        Set L6
      </button>
      <button
        data-testid="inc-msg"
        onClick={() => ctx.incrementMessageCount()}
      >
        Inc Msg
      </button>
      <button
        data-testid="set-mem"
        onClick={() => ctx.setMemoryCount(42)}
      >
        Set Mem
      </button>
      <button data-testid="reset" onClick={() => ctx.resetToDefaults()}>
        Reset
      </button>
      <button
        data-testid="to-params"
        onClick={() => {
          const p = ctx.toChatParams();
          // expose via dataset for assertion
          const el = document.getElementById("params-out");
          if (el) el.textContent = JSON.stringify(p);
        }}
      >
        To Params
      </button>
      <span id="params-out" data-testid="params-out" />
    </div>
  );
}

function renderProvider() {
  return render(
    <ChatParamsProvider>
      <TestConsumer />
    </ChatParamsProvider>,
  );
}

describe("ChatParamsContext", () => {
  // ── Error boundary ──

  it("throws when useChatParams is used outside ChatParamsProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    function BadConsumer() {
      useChatParams();
      return null;
    }

    expect(() => render(<BadConsumer />)).toThrow(
      "useChatParams must be used within a <ChatParamsProvider>",
    );

    consoleError.mockRestore();
  });

  // ── Rendering ──

  it("renders children inside the provider", () => {
    renderProvider();
    expect(screen.getByTestId("l2-top_k")).toBeInTheDocument();
  });

  // ── Initial defaults ──

  it("initializes L2 params to DEFAULT_L2_RECALL", () => {
    renderProvider();
    expect(screen.getByTestId("l2-top_k").textContent).toBe(
      String(DEFAULT_L2_RECALL.top_k),
    );
    expect(screen.getByTestId("l2-recall_threshold").textContent).toBe(
      String(DEFAULT_L2_RECALL.recall_threshold),
    );
  });

  it("initializes L3 params to DEFAULT_L3_CONTEXT", () => {
    renderProvider();
    expect(screen.getByTestId("l3-window_size").textContent).toBe(
      String(DEFAULT_L3_CONTEXT.window_size),
    );
    expect(screen.getByTestId("l3-strategy").textContent).toBe(
      DEFAULT_L3_CONTEXT.overflow_strategy,
    );
  });

  it("initializes L5 params to DEFAULT_L5_INFERENCE", () => {
    renderProvider();
    expect(screen.getByTestId("l5-model").textContent).toBe(
      DEFAULT_L5_INFERENCE.model,
    );
    expect(screen.getByTestId("l5-temperature").textContent).toBe(
      String(DEFAULT_L5_INFERENCE.temperature),
    );
  });

  it("initializes L6 params to DEFAULT_L6_DECAY", () => {
    renderProvider();
    expect(screen.getByTestId("l6-lambda").textContent).toBe(
      String(DEFAULT_L6_DECAY.lambda),
    );
  });

  it("initializes stats with zero counts and a sessionStart timestamp", () => {
    renderProvider();
    expect(screen.getByTestId("stats-messageCount").textContent).toBe("0");
    expect(screen.getByTestId("stats-memoryCount").textContent).toBe("0");
    expect(Number(screen.getByTestId("stats-sessionStart").textContent)).toBeGreaterThan(0);
  });

  // ── Partial updates ──

  it("setL2 applies partial patch over default L2", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("set-l2"));

    expect(screen.getByTestId("l2-top_k").textContent).toBe("10");
    expect(screen.getByTestId("l2-recall_threshold").textContent).toBe("0.5");
  });

  it("setL3 applies partial patch over default L3", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("set-l3"));

    expect(screen.getByTestId("l3-window_size").textContent).toBe("8192");
    expect(screen.getByTestId("l3-strategy").textContent).toBe("truncate");
  });

  it("setL5 applies partial patch without overwriting unchanged fields", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("set-l5"));

    expect(screen.getByTestId("l5-temperature").textContent).toBe("1.5");
    // model unchanged
    expect(screen.getByTestId("l5-model").textContent).toBe(
      DEFAULT_L5_INFERENCE.model,
    );
  });

  it("setL6 applies partial patch over default L6", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("set-l6"));

    expect(screen.getByTestId("l6-lambda").textContent).toBe("0.5");
  });

  // ── Stats mutations ──

  it("incrementMessageCount bumps messageCount by 1 each call", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("inc-msg"));
    expect(screen.getByTestId("stats-messageCount").textContent).toBe("1");

    fireEvent.click(screen.getByTestId("inc-msg"));
    expect(screen.getByTestId("stats-messageCount").textContent).toBe("2");
  });

  it("setMemoryCount overwrites memoryCount", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("set-mem"));
    expect(screen.getByTestId("stats-memoryCount").textContent).toBe("42");
  });

  // ── toChatParams ──

  it("toChatParams maps L3 + L5 fields to ChatParams shape", () => {
    renderProvider();
    fireEvent.click(screen.getByTestId("to-params"));

    const raw = screen.getByTestId("params-out").textContent ?? "{}";
    const out = JSON.parse(raw);
    expect(out.context_window_size).toBe(DEFAULT_L3_CONTEXT.window_size);
    expect(out.context_overflow_strategy).toBe(
      DEFAULT_L3_CONTEXT.overflow_strategy,
    );
    // Phase 55 B4: model only sent when user overrides routing;
    // default (no override) → undefined
    expect(out.model).toBeUndefined();
    expect(out.temperature).toBe(DEFAULT_L5_INFERENCE.temperature);
    expect(out.max_tokens).toBe(DEFAULT_L5_INFERENCE.max_tokens);
  });

  // ── resetToDefaults ──

  it("resetToDefaults restores all params and zeroes stats", () => {
    renderProvider();

    // Mutate everything
    fireEvent.click(screen.getByTestId("set-l2"));
    fireEvent.click(screen.getByTestId("set-l3"));
    fireEvent.click(screen.getByTestId("set-l5"));
    fireEvent.click(screen.getByTestId("set-l6"));
    fireEvent.click(screen.getByTestId("inc-msg"));
    fireEvent.click(screen.getByTestId("inc-msg"));
    fireEvent.click(screen.getByTestId("set-mem"));

    // Reset
    fireEvent.click(screen.getByTestId("reset"));

    // Verify defaults restored
    expect(screen.getByTestId("l2-top_k").textContent).toBe(
      String(DEFAULT_L2_RECALL.top_k),
    );
    expect(screen.getByTestId("l3-window_size").textContent).toBe(
      String(DEFAULT_L3_CONTEXT.window_size),
    );
    expect(screen.getByTestId("l5-model").textContent).toBe(
      DEFAULT_L5_INFERENCE.model,
    );
    expect(screen.getByTestId("l6-lambda").textContent).toBe(
      String(DEFAULT_L6_DECAY.lambda),
    );
    expect(screen.getByTestId("stats-messageCount").textContent).toBe("0");
    expect(screen.getByTestId("stats-memoryCount").textContent).toBe("0");
    // sessionStart should still be a valid timestamp (not reset to 0)
    expect(
      Number(screen.getByTestId("stats-sessionStart").textContent),
    ).toBeGreaterThan(0);
  });
});

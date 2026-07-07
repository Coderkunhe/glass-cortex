import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import ExperimentComparePanel from "@/components/lab/ExperimentComparePanel";

const mockFetch = vi.fn();
global.fetch = mockFetch;

afterEach(cleanup);

beforeEach(() => {
  mockFetch.mockReset();
});

// ── Mock helpers ─────────────────────────────────────────────────────────

const MOCK_PRESETS = {
  presets: [
    {
      id: "recall_top_k_3_vs_7",
      label_a: "top_k=3 (保守)",
      label_b: "top_k=7 (激进)",
      settings_a: { recall_top_k: 3 },
      settings_b: { recall_top_k: 7 },
      description: "对比召回数量对回复质量的影响",
    },
    {
      id: "boost_0.1_vs_0.5",
      label_a: "boost=0.1 (缓慢)",
      label_b: "boost=0.5 (快速)",
      settings_a: { strengthen_boost: 0.1 },
      settings_b: { strengthen_boost: 0.5 },
      description: "对比记忆强化速度的影响",
    },
    {
      id: "threshold_0.05_vs_0.3",
      label_a: "threshold=0.05 (宽松)",
      label_b: "threshold=0.3 (严格)",
      settings_a: { recall_threshold: 0.05 },
      settings_b: { recall_threshold: 0.3 },
      description: "对比召回阈值的影响",
    },
    {
      id: "search_k_10_vs_40",
      label_a: "search_k=10",
      label_b: "search_k=40",
      settings_a: { recall_search_k: 10 },
      settings_b: { recall_search_k: 40 },
      description: "对比 FAISS 搜索广度的影响",
    },
  ],
};

function mockPresetsSuccess() {
  return { ok: true, json: () => Promise.resolve(MOCK_PRESETS) };
}

function mockPresetsError() {
  return {
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: "internal", detail: "加载实验预设失败" }),
  };
}

function mockExperimentRunSuccess() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        result_a: {
          label: "top_k=3 (保守)",
          settings: { recall_top_k: 3 },
          recalled_count: 2,
          response_text: "A 组回复内容（较短）",
          response_length: 42,
          chat_prompt_tokens: 800,
          chat_completion_tokens: 200,
          chat_total_tokens: 1000,
          fact_prompt_tokens: 400,
          fact_completion_tokens: 100,
          fact_total_tokens: 500,
          facts_extracted: 3,
          fact_contents: ["事实 A1", "事实 A2", "事实 A3"],
          db_path: "/tmp/a.db",
        },
        result_b: {
          label: "top_k=7 (激进)",
          settings: { recall_top_k: 7 },
          recalled_count: 5,
          response_text: "B 组回复内容（较长且更详细）",
          response_length: 120,
          chat_prompt_tokens: 1200,
          chat_completion_tokens: 300,
          chat_total_tokens: 1500,
          fact_prompt_tokens: 600,
          fact_completion_tokens: 150,
          fact_total_tokens: 750,
          facts_extracted: 6,
          fact_contents: ["事实 B1", "事实 B2", "事实 B3", "事实 B4"],
          db_path: "/tmp/b.db",
        },
        diffs: [
          {
            dimension: "recall_count",
            label_a: "top_k=3 (保守)",
            label_b: "top_k=7 (激进)",
            value_a: 2,
            value_b: 5,
            delta: "+3",
            direction: "b_better",
            detail: "A 召回 2 条，B 召回 5 条",
          },
          {
            dimension: "chat_token_usage",
            label_a: "top_k=3 (保守)",
            label_b: "top_k=7 (激进)",
            value_a: 1000,
            value_b: 1500,
            delta: "+500",
            direction: "a_better",
            detail: "A: prompt=800 completion=200 | B: prompt=1200 completion=300",
          },
          {
            dimension: "response_length",
            label_a: "top_k=3 (保守)",
            label_b: "top_k=7 (激进)",
            value_a: 42,
            value_b: 120,
            delta: "+78",
            direction: "neutral",
            detail: null,
          },
        ],
        elapsed_ms: 3420.5,
      }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("ExperimentComparePanel", () => {
  // B96 E1: clear history from localStorage before each test
  beforeEach(() => {
    localStorage.removeItem("gc_experiment_history");
  });
  it("renders header with title", () => {
    render(<ExperimentComparePanel />);
    expect(screen.getByText("A/B 实验对比")).toBeInTheDocument();
    expect(screen.getByText("同一输入，两套参数，量化差异")).toBeInTheDocument();
  });

  it("shows loading for presets on mount", async () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByText("加载实验预设…")).toBeInTheDocument();
    });
  });

  it("shows presets after loading", async () => {
    mockFetch.mockResolvedValueOnce(mockPresetsSuccess());
    render(<ExperimentComparePanel />);
    // 等待 presets-loaded 容器出现，证明 fetch 完成 + 状态更新
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });
    // 四个预设卡片均存在
    expect(screen.getByTestId("preset-recall_top_k_3_vs_7")).toBeInTheDocument();
    expect(screen.getByTestId("preset-boost_0.1_vs_0.5")).toBeInTheDocument();
    expect(screen.getByTestId("preset-threshold_0.05_vs_0.3")).toBeInTheDocument();
    expect(screen.getByTestId("preset-search_k_10_vs_40")).toBeInTheDocument();
    // 未选择预设 + 空输入 → 运行按钮禁用
    expect(screen.getByTestId("experiment-run-btn")).toBeDisabled();
  });

  // B95 E2: preset parameter diff
  it("shows A/B parameter diff on preset cards", async () => {
    mockFetch.mockResolvedValueOnce(mockPresetsSuccess());
    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });
    // recall_top_k preset should show the diff "3 → 7"
    const presetCard = screen.getByTestId("preset-recall_top_k_3_vs_7");
    expect(presetCard.textContent).toMatch(/recall_top_k/);
    expect(presetCard.textContent).toMatch(/3/);
    expect(presetCard.textContent).toMatch(/7/);
    // boost preset shows strengthen_boost diff
    const boostCard = screen.getByTestId("preset-boost_0.1_vs_0.5");
    expect(boostCard.textContent).toMatch(/strengthen_boost/);
    expect(boostCard.textContent).toMatch(/0\.1/);
    expect(boostCard.textContent).toMatch(/0\.5/);
  });

  it("shows presets error with retry", async () => {
    mockFetch.mockResolvedValueOnce(mockPresetsError());
    render(<ExperimentComparePanel />);
    await waitFor(() => {
      // ErrorDisplay renders role="alert" — confirm it appears
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("enables run button after preset selection and input", async () => {
    mockFetch.mockResolvedValueOnce(mockPresetsSuccess());
    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    // 选择预设
    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    // 输入文本
    const textarea = screen.getByPlaceholderText("输入测试文本，例如：什么是记忆衰减？");
    fireEvent.change(textarea, { target: { value: "什么是记忆？" } });

    expect(screen.getByTestId("experiment-run-btn")).not.toBeDisabled();
  });

  it("runs experiment and shows results", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPresetsSuccess())
      .mockResolvedValueOnce(mockExperimentRunSuccess());

    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    // 选择预设 + 输入文本 + 运行
    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    const textarea = screen.getByPlaceholderText("输入测试文本，例如：什么是记忆衰减？");
    fireEvent.change(textarea, { target: { value: "什么是记忆？" } });
    fireEvent.click(screen.getByTestId("experiment-run-btn"));

    // 等待结果
    await waitFor(() => {
      expect(screen.getByTestId("experiment-results")).toBeInTheDocument();
    });

    // 差异表存在
    expect(screen.getByText("维度差异对比")).toBeInTheDocument();
    expect(screen.getByText("A 更优")).toBeInTheDocument();
    expect(screen.getByText("B 更优")).toBeInTheDocument();
  });

  it("shows experiment error on run failure", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPresetsSuccess())
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "internal", detail: "实验运行失败" }),
      });

    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    const textarea = screen.getByPlaceholderText("输入测试文本，例如：什么是记忆衰减？");
    fireEvent.change(textarea, { target: { value: "什么是记忆？" } });
    fireEvent.click(screen.getByTestId("experiment-run-btn"));

    await waitFor(() => {
      // ErrorDisplay (inline variant) renders role="alert" — confirm it appears
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("does not run experiment with empty input", async () => {
    mockFetch.mockResolvedValueOnce(mockPresetsSuccess());
    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    // 未输入文本 → 按钮仍禁用
    expect(screen.getByTestId("experiment-run-btn")).toBeDisabled();
  });

  // ── B96 E1: 运行历史 ────────────────────────────────────────────

  it("shows history toggle after running an experiment", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPresetsSuccess())
      .mockResolvedValueOnce(mockExperimentRunSuccess());

    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    // Run experiment
    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    fireEvent.change(
      screen.getByPlaceholderText("输入测试文本，例如：什么是记忆衰减？"),
      { target: { value: "什么是记忆？" } },
    );
    fireEvent.click(screen.getByTestId("experiment-run-btn"));

    // Wait for results, then history toggle should appear
    await waitFor(() => {
      expect(screen.getByTestId("experiment-results")).toBeInTheDocument();
    });
    expect(screen.getByTestId("history-toggle")).toBeInTheDocument();
    expect(screen.getByText(/运行历史/)).toBeInTheDocument();
  });

  it("opens history panel and shows past run entry", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPresetsSuccess())
      .mockResolvedValueOnce(mockExperimentRunSuccess());

    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    // Run experiment
    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    fireEvent.change(
      screen.getByPlaceholderText("输入测试文本，例如：什么是记忆衰减？"),
      { target: { value: "什么是记忆？" } },
    );
    fireEvent.click(screen.getByTestId("experiment-run-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("experiment-results")).toBeInTheDocument();
    });

    // History toggle should be visible
    expect(screen.getByTestId("history-toggle")).toBeInTheDocument();

    // Expand history — entries should appear
    fireEvent.click(screen.getByTestId("history-toggle"));

    // After expanding, history entry buttons with data-testid should appear
    await waitFor(() => {
      const entries = screen.getAllByTestId(/^history-entry-/);
      expect(entries.length).toBe(1);
    });

    // And the clear button should be visible
    expect(screen.getByTestId("history-clear")).toBeInTheDocument();
  });

  it("clears history when clear button is clicked", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPresetsSuccess())
      .mockResolvedValueOnce(mockExperimentRunSuccess());

    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    fireEvent.change(
      screen.getByPlaceholderText("输入测试文本，例如：什么是记忆衰减？"),
      { target: { value: "什么是记忆？" } },
    );
    fireEvent.click(screen.getByTestId("experiment-run-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("experiment-results")).toBeInTheDocument();
    });

    // Expand history and clear
    fireEvent.click(screen.getByTestId("history-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("history-clear")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("history-clear"));

    // History toggle should disappear
    await waitFor(() => {
      expect(screen.queryByTestId("history-toggle")).not.toBeInTheDocument();
    });
  });

  it("persists history to localStorage", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPresetsSuccess())
      .mockResolvedValueOnce(mockExperimentRunSuccess());

    render(<ExperimentComparePanel />);
    await waitFor(() => {
      expect(screen.getByTestId("presets-loaded")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("preset-recall_top_k_3_vs_7"));
    fireEvent.change(
      screen.getByPlaceholderText("输入测试文本，例如：什么是记忆衰减？"),
      { target: { value: "什么是记忆？" } },
    );
    fireEvent.click(screen.getByTestId("experiment-run-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("experiment-results")).toBeInTheDocument();
    });

    // Check localStorage
    const raw = localStorage.getItem("gc_experiment_history");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].userInput).toBe("什么是记忆？");
    expect(parsed[0].presetId).toBe("recall_top_k_3_vs_7");
  });
});

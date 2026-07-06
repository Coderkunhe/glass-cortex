import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ParamSliders from "@/components/chat/ParamSliders";
import {
  DEFAULT_L2_RECALL,
  DEFAULT_L3_CONTEXT,
  DEFAULT_L5_INFERENCE,
  DEFAULT_L6_DECAY,
} from "@/lib/chatParams";

describe("ParamSliders", () => {
  const mockOnL2Change = vi.fn();
  const mockOnL3Change = vi.fn();
  const mockOnL5Change = vi.fn();
  const mockOnL6Change = vi.fn();

  const defaultProps = {
    l2: DEFAULT_L2_RECALL,
    l3: DEFAULT_L3_CONTEXT,
    l5: DEFAULT_L5_INFERENCE,
    l6: DEFAULT_L6_DECAY,
    onL2Change: mockOnL2Change,
    onL3Change: mockOnL3Change,
    onL5Change: mockOnL5Change,
    onL6Change: mockOnL6Change,
  };

  beforeEach(() => {
    mockOnL2Change.mockClear();
    mockOnL3Change.mockClear();
    mockOnL5Change.mockClear();
    mockOnL6Change.mockClear();
  });

  it("renders L2, L3, L5, L6 section titles", () => {
    render(<ParamSliders {...defaultProps} />);
    expect(screen.getByText("L2 记忆召回")).toBeDefined();
    expect(screen.getByText("L3 上下文窗口")).toBeDefined();
    expect(screen.getByText("L5 模型推理")).toBeDefined();
    expect(screen.getByText("L6 遗忘曲线")).toBeDefined();
  });

  it("renders all 4 L2 slider labels", () => {
    render(<ParamSliders {...defaultProps} />);
    expect(screen.getByText("召回数量 (top_k)")).toBeDefined();
    expect(screen.getByText("召回阈值")).toBeDefined();
    expect(screen.getByText("截断阈值")).toBeDefined();
    expect(screen.getByText("压缩阈值 (tokens)")).toBeDefined();
  });

  it("renders L3 slider and select labels", () => {
    render(<ParamSliders {...defaultProps} />);
    expect(screen.getByText("窗口大小 (tokens)")).toBeDefined();
    expect(screen.getByText("溢出策略")).toBeDefined();
  });

  it("displays default top_k value", () => {
    render(<ParamSliders {...defaultProps} />);
    // 5 is the default top_k
    const labels = screen.getAllByText("5");
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onL2Change when top_k slider changes", () => {
    render(<ParamSliders {...defaultProps} />);
    const sliders = document.querySelectorAll('input[type="range"]');
    const topKSlider = sliders[0]; // first slider is top_k
    fireEvent.input(topKSlider, { target: { value: "10" } });
    expect(mockOnL2Change).toHaveBeenCalledWith({ top_k: 10 });
  });

  it("calls onL2Change with formatted threshold value", () => {
    render(<ParamSliders {...defaultProps} />);
    const sliders = document.querySelectorAll('input[type="range"]');
    const thresholdSlider = sliders[1]; // second slider is recall_threshold
    fireEvent.input(thresholdSlider, { target: { value: "0.25" } });
    expect(mockOnL2Change).toHaveBeenCalledWith({ recall_threshold: 0.25 });
  });

  it("calls onL3Change when window_size slider changes", () => {
    render(<ParamSliders {...defaultProps} />);
    const sliders = document.querySelectorAll('input[type="range"]');
    const windowSlider = sliders[4]; // 5th slider (4 L2 + 1st L3)
    fireEvent.input(windowSlider, { target: { value: "8192" } });
    expect(mockOnL3Change).toHaveBeenCalledWith({ window_size: 8192 });
  });

  it("calls onL3Change when overflow_strategy select changes", () => {
    render(<ParamSliders {...defaultProps} />);
    const select = document.querySelector("select");
    expect(select).not.toBeNull();
    fireEvent.change(select!, { target: { value: "truncate" } });
    expect(mockOnL3Change).toHaveBeenCalledWith({
      overflow_strategy: "truncate",
    });
  });

  it("shows hint text for sliders", () => {
    render(<ParamSliders {...defaultProps} />);
    expect(
      screen.getByText("每条消息召回多少条相关记忆注入提示词"),
    ).toBeDefined();
    expect(
      screen.getByText("强度/置信度低于此阈值的记忆被过滤"),
    ).toBeDefined();
  });

  it("shows hint text for overflow strategy", () => {
    render(<ParamSliders {...defaultProps} />);
    expect(
      screen.getByText(
        "truncate=FIFO截断 | prioritize=按得分保留 | summarize=压缩旧记忆",
      ),
    ).toBeDefined();
  });

  it("renders all 3 strategy options in select", () => {
    render(<ParamSliders {...defaultProps} />);
    // Scope to the first select (L3 overflow strategy), L5 model select also exists
    const firstSelect = document.querySelector("select");
    expect(firstSelect).not.toBeNull();
    const options = firstSelect!.querySelectorAll("option");
    expect(options.length).toBe(3);
    const values = Array.from(options).map((o) => o.value);
    expect(values).toEqual(["truncate", "prioritize", "summarize"]);
  });

  it("select defaults to prioritize", () => {
    render(<ParamSliders {...defaultProps} />);
    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("prioritize");
  });

  it("formats decimal sliders with 2 decimal places", () => {
    const props = {
      ...defaultProps,
      l2: { ...DEFAULT_L2_RECALL, recall_threshold: 0.25 },
    };
    render(<ParamSliders {...props} />);
    // The displayed value should be "0.25"
    expect(screen.getByText("0.25")).toBeDefined();
  });

  it("formats window_size with locale string", () => {
    const props = {
      ...defaultProps,
      l3: { ...DEFAULT_L3_CONTEXT, window_size: 8192 },
    };
    render(<ParamSliders {...props} />);
    // "8,192" with comma
    expect(screen.getByText("8,192")).toBeDefined();
  });

  it('shows "0" for compress_threshold when disabled', () => {
    const props = {
      ...defaultProps,
      l2: { ...DEFAULT_L2_RECALL, compress_threshold: 0 },
    };
    render(<ParamSliders {...props} />);
    // Should display "0" (not formatted with toLocaleString since no format override)
    const labels = screen.getAllByText("0");
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it("has collapsible sections for each parameter group", () => {
    const { container } = render(<ParamSliders {...defaultProps} />);
    const sections = container.querySelectorAll("[aria-expanded]");
    expect(sections.length).toBe(4);
  });

  // ── L5 模型推理 ──

  it("renders L5 model select with options", () => {
    render(<ParamSliders {...defaultProps} />);
    const selects = document.querySelectorAll("select");
    // L3 select + L5 model select = 2 selects
    expect(selects.length).toBe(2);
    const modelSelect = selects[1] as HTMLSelectElement;
    expect(modelSelect.value).toBe("deepseek-chat");
  });

  it("calls onL5Change when model select changes", () => {
    render(<ParamSliders {...defaultProps} />);
    const selects = document.querySelectorAll("select");
    const modelSelect = selects[1];
    fireEvent.change(modelSelect, { target: { value: "deepseek-reasoner" } });
    expect(mockOnL5Change).toHaveBeenCalledWith({ model: "deepseek-reasoner" });
  });

  it("calls onL5Change when temperature slider changes", () => {
    render(<ParamSliders {...defaultProps} />);
    const sliders = document.querySelectorAll('input[type="range"]');
    const tempSlider = sliders[5]; // L5 temperature (after 4 L2 + 1 L3)
    fireEvent.input(tempSlider, { target: { value: "1.5" } });
    expect(mockOnL5Change).toHaveBeenCalledWith({ temperature: 1.5 });
  });

  it("calls onL5Change when max_tokens slider changes", () => {
    render(<ParamSliders {...defaultProps} />);
    const sliders = document.querySelectorAll('input[type="range"]');
    const mtSlider = sliders[6]; // L5 max_tokens
    fireEvent.input(mtSlider, { target: { value: "2048" } });
    expect(mockOnL5Change).toHaveBeenCalledWith({ max_tokens: 2048 });
  });

  // ── L6 遗忘曲线 ──

  it("renders L6 lambda slider with default value", () => {
    render(<ParamSliders {...defaultProps} />);
    // Default lambda is 0.1, formatted as "0.10" (also appears in recall_threshold)
    const matches = screen.getAllByText("0.10");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onL6Change when lambda slider changes", () => {
    render(<ParamSliders {...defaultProps} />);
    const sliders = document.querySelectorAll('input[type="range"]');
    const lambdaSlider = sliders[7]; // L6 lambda (after 4 L2 + 1 L3 + 2 L5)
    fireEvent.input(lambdaSlider, { target: { value: "0.5" } });
    expect(mockOnL6Change).toHaveBeenCalledWith({ lambda: 0.5 });
  });

  it("renders SVG forgetting curve", () => {
    const { container } = render(<ParamSliders {...defaultProps} />);
    // SVG is inside a CollapsibleSection (<details>), still queryable
    const svg = container.querySelector("svg[aria-label]");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toContain("遗忘曲线");
  });

  it("renders 30-day strength caption", () => {
    render(<ParamSliders {...defaultProps} />);
    expect(screen.getByText(/30 天后强度/)).toBeDefined();
  });

  it("renders decay trigger button when onTriggerDecay is provided", () => {
    const onTriggerDecay = vi.fn();
    render(<ParamSliders {...defaultProps} onTriggerDecay={onTriggerDecay} />);
    expect(screen.getByText("触发衰减")).toBeDefined();
  });

  it("does not render decay button when onTriggerDecay is undefined", () => {
    render(<ParamSliders {...defaultProps} />);
    expect(screen.queryByText("触发衰减")).toBeNull();
  });

  it("calls onTriggerDecay when button clicked", () => {
    const onTriggerDecay = vi.fn();
    render(<ParamSliders {...defaultProps} onTriggerDecay={onTriggerDecay} />);
    fireEvent.click(screen.getByText("触发衰减"));
    expect(onTriggerDecay).toHaveBeenCalledOnce();
  });
});

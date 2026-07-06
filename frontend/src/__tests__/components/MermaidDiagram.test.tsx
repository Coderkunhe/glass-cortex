/**
 * MermaidDiagram 组件测试。
 *
 * 使用 vitest + @testing-library/react + jsdom。
 * 通过 vi.mock 全量 mock mermaid 模块，避免依赖真实 DOM 渲染。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import MermaidDiagram from "@/components/ui/MermaidDiagram";

// ── Mock mermaid module ──
const mockInitialize = vi.fn();
const mockRender = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}));

const TEST_CHART = "graph LR\nA-->B";
const TEST_TITLE = "测试流程图";
const RENDERED_SVG = "<svg><g><rect></rect></g></svg>";

describe("MermaidDiagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRender.mockResolvedValue({ svg: RENDERED_SVG });
    // Ensure default (non-dark) theme
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Basic rendering ──

  it("renders the title", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(screen.getByText(TEST_TITLE)).toBeInTheDocument();
    });
  });

  it("renders the description when provided", async () => {
    render(
      <MermaidDiagram
        chart={TEST_CHART}
        title={TEST_TITLE}
        description="这是描述"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("这是描述")).toBeInTheDocument();
    });
  });

  it("does not render description when not provided", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(screen.getByText(TEST_TITLE)).toBeInTheDocument();
    });

    // The description container should not exist
    const descEls = document.querySelectorAll(".gm-mermaid-desc");
    expect(descEls).toHaveLength(0);
  });

  // ── 2. Mermaid integration ──

  it("calls mermaid.initialize with correct config", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          flowchart: expect.objectContaining({
            useMaxWidth: true,
            htmlLabels: true,
          }),
        }),
      );
    });
  });

  it("calls mermaid.render with chart string", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(mockRender).toHaveBeenCalled();
    });

    // Second argument should be the chart string
    const [, chartArg] = mockRender.mock.calls[0] as [string, string];
    expect(chartArg).toBe(TEST_CHART);
  });

  it("injects rendered SVG into the DOM", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      const wrap = document.querySelector(".gm-mermaid-wrap");
      expect(wrap).toBeInTheDocument();
      expect(wrap!.innerHTML).toContain("svg");
    });
  });

  it("sets aria-label and role on SVG container", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      const wrap = document.querySelector(".gm-mermaid-wrap");
      expect(wrap).toBeInTheDocument();
      expect(wrap!.getAttribute("aria-label")).toBe(TEST_TITLE);
      expect(wrap!.getAttribute("role")).toBe("img");
    });
  });

  // ── 3. Error handling ──

  it("shows error state when mermaid.render rejects", async () => {
    mockRender.mockRejectedValue(new Error("bad syntax"));

    render(<MermaidDiagram chart="invalid" title="坏图" />);

    await waitFor(() => {
      expect(screen.getByText(/流程图渲染失败/)).toBeInTheDocument();
      expect(screen.getByText(/坏图/)).toBeInTheDocument();
    });
  });

  it("shows ErrorDisplay card instead of raw chart when render error", async () => {
    mockRender.mockRejectedValue(new Error("syntax error"));

    render(<MermaidDiagram chart="INVALID_CHART" title="测试" />);

    await waitFor(() => {
      // No raw chart exposure — the <details>/<pre> are gone
      expect(document.querySelector("details")).not.toBeInTheDocument();
      expect(document.querySelector("pre")).not.toBeInTheDocument();
      // ErrorDisplay renders role="alert"
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/流程图渲染失败：测试/)).toBeInTheDocument();
    });
  });

  it("shows categorized user message not raw error", async () => {
    mockRender.mockRejectedValue(new Error("Parse error at line 1"));

    render(<MermaidDiagram chart="bad" title="测试" />);

    await waitFor(() => {
      // Technical detail may appear as secondary text, but the
      // primary user-visible message is the categorized Chinese text
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/流程图渲染失败：测试/)).toBeInTheDocument();
    });
  });

  // ── 4. Re-render behavior ──

  it("re-renders when chart prop changes", async () => {
    const { rerender } = render(
      <MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />,
    );

    await waitFor(() => {
      expect(mockRender).toHaveBeenCalledTimes(1);
    });

    const newChart = "graph TD\nX-->Y";
    rerender(
      <MermaidDiagram chart={newChart} title={TEST_TITLE} />,
    );

    await waitFor(() => {
      expect(mockRender).toHaveBeenCalledTimes(2);
    });

    // Second call should have the new chart
    const calls = mockRender.mock.calls as [string, string][];
    expect(calls[1][1]).toBe(newChart);
  });

  // ── 5. Theme ──

  it("passes dark theme to mermaid when data-theme='dark'", async () => {
    document.documentElement.setAttribute("data-theme", "dark");

    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "dark" }),
      );
    });
  });

  it("passes neutral theme when data-theme is absent", async () => {
    document.documentElement.removeAttribute("data-theme");

    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "neutral" }),
      );
    });
  });

  // ── 6. maxHeight ──

  it("applies maxHeight style to SVG container", async () => {
    render(
      <MermaidDiagram
        chart={TEST_CHART}
        title={TEST_TITLE}
        maxHeight={300}
      />,
    );

    await waitFor(() => {
      const wrap = document.querySelector(
        ".gm-mermaid-wrap",
      ) as HTMLElement;
      expect(wrap).toBeInTheDocument();
      expect(wrap.style.maxHeight).toBe("300px");
    });
  });

  it("has no maxHeight by default (unconstrained)", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      const wrap = document.querySelector(
        ".gm-mermaid-wrap",
      ) as HTMLElement;
      // Default maxHeight is 0 → no inline style applied
      expect(wrap.style.maxHeight).toBeFalsy();
    });
  });

  // ── 7. Lightbox (ImageViewer) integration ──

  it("SVG container has zoom-in cursor to indicate clickability", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      const wrap = document.querySelector(
        ".gm-mermaid-wrap",
      ) as HTMLElement;
      expect(wrap.style.cursor).toBe("zoom-in");
    });
  });

  it("opens lightbox when SVG container is clicked", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });

    // Click the SVG container
    fireEvent.click(screen.getByRole("img"));

    // Lightbox should now be visible
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      TEST_TITLE,
    );
  });

  it("closes lightbox when Escape is pressed", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });

    // Open lightbox
    fireEvent.click(screen.getByRole("img"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Close via Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders lightbox with iframe SVG content (not img tag)", async () => {
    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });

    // Open lightbox
    fireEvent.click(screen.getByRole("img"));

    // The lightbox dialog should contain the iframe with SVG
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // SVG is rendered inside an iframe (not inline)
    const iframe = dialog.querySelector(".gm-iv-svg-iframe") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute("srcdoc")).toContain("<svg");
    // No img element in the lightbox when using svgHtml mode
    expect(dialog.querySelector("img")).not.toBeInTheDocument();
  });

  it("lightbox is not rendered before SVG is ready", () => {
    // Don't mock the render yet — SVG isn't ready
    mockRender.mockReturnValue(new Promise(() => {})); // never resolves

    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    // Lightbox should not appear since there's no SVG content
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── 8. Emoji stripping ──

  it("strips Emoji_Presentation emoji from chart", async () => {
    const chartWithEmoji = "graph LR\nA[\"💬 用户输入\"] --> B[\"🧭 意图分类\"]";
    const expectedClean = "graph LR\nA[\"用户输入\"] --> B[\"意图分类\"]";

    render(<MermaidDiagram chart={chartWithEmoji} title="去 emoji" />);

    await waitFor(() => {
      const [, chartArg] = mockRender.mock.calls[0] as [string, string];
      expect(chartArg).toBe(expectedClean);
    });
  });

  it("strips text-default emoji (Emoji property but not Emoji_Presentation)", async () => {
    // U+1F5D1 🗑 is Emoji=true, Emoji_Presentation=false — missed by pass 1
    const chartWithEmoji = "graph TD\nA[\"🗑️ 遗忘衰减\"] --> B[\"🌤️ 天气\"]";
    const expectedClean = "graph TD\nA[\"遗忘衰减\"] --> B[\"天气\"]";

    render(<MermaidDiagram chart={chartWithEmoji} title="text-default emoji" />);

    await waitFor(() => {
      const [, chartArg] = mockRender.mock.calls[0] as [string, string];
      expect(chartArg).toBe(expectedClean);
    });
  });

  it("preserves ASCII chars that happen to have Emoji property (# color codes)", async () => {
    // #, *, 0-9 all have the Emoji property but must survive
    const chartWithHash = "graph LR\nA[\"step 1\"] --> B[\"#4f46e5\"]";
    render(<MermaidDiagram chart={chartWithHash} title="keep #" />);

    await waitFor(() => {
      const [, chartArg] = mockRender.mock.calls[0] as [string, string];
      expect(chartArg).toContain("#4f46e5");
    });
  });

  it("collapses multiple spaces after emoji removal", async () => {
    const chartWithEmoji = "graph LR\nA[\"🔍  记忆召回\"]";
    const expectedClean = "graph LR\nA[\"记忆召回\"]";

    render(<MermaidDiagram chart={chartWithEmoji} title="空格合并" />);

    await waitFor(() => {
      const [, chartArg] = mockRender.mock.calls[0] as [string, string];
      expect(chartArg).toBe(expectedClean);
    });
  });

  // ── 9. Dark mode themeVariables ──

  it("passes themeVariables to mermaid.initialize in dark mode", async () => {
    document.documentElement.setAttribute("data-theme", "dark");

    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: "dark",
          themeVariables: expect.objectContaining({
            lineColor: expect.any(String),
            textColor: expect.any(String),
          }),
        }),
      );
    });
  });

  it("does not pass themeVariables in light mode", async () => {
    document.documentElement.removeAttribute("data-theme");

    render(<MermaidDiagram chart={TEST_CHART} title={TEST_TITLE} />);

    await waitFor(() => {
      const [config] = mockInitialize.mock.calls[0] as [Record<string, unknown>];
      expect(config.themeVariables).toBeUndefined();
    });
  });
});

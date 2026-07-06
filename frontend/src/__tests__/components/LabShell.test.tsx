import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Mock HealthDashboard + LogViewer — 它们自 fetch，不干扰 LabShell Tab 切换测试
vi.mock("@/components/observability/HealthDashboard", () => ({
  default: () => <div data-testid="health-dashboard">HealthDashboard Mock</div>,
}));
vi.mock("@/components/observability/LogViewer", () => ({
  default: () => <div data-testid="log-viewer">LogViewer Mock</div>,
}));
// Mock ExperimentComparePanel + CostWaterfallPanel — 它们也自 fetch
vi.mock("@/components/lab/ExperimentComparePanel", () => ({
  default: () => <div data-testid="experiment-compare-panel">ExperimentComparePanel Mock</div>,
}));
vi.mock("@/components/lab/CostWaterfallPanel", () => ({
  default: () => <div data-testid="cost-waterfall-panel">CostWaterfallPanel Mock</div>,
}));

// Mock next/navigation for useSearchParams (Phase 43 Batch 1)
const { mockUseSearchParams } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(() => new URLSearchParams()),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

import LabShell from "@/components/lab/LabShell";

afterEach(cleanup);

describe("LabShell", () => {
  it("renders all five tab buttons", () => {
    render(<LabShell />);

    expect(screen.getByRole("tab", { name: /上下文/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /管线/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /数据/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /图谱/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /实验/ })).toBeInTheDocument();
  });

  it("has first tab (上下文) selected by default", () => {
    render(<LabShell />);

    const contextTab = screen.getByRole("tab", { name: /上下文/ });
    expect(contextTab).toHaveAttribute("aria-selected", "true");

    // Context tab shows real panels (Batch 169)
    expect(screen.getByText("溢出模拟")).toBeInTheDocument();
    expect(screen.getByText("策略对比")).toBeInTheDocument();
    expect(screen.getByText("意图测试")).toBeInTheDocument();
  });

  it("switches tabs and shows correct content", () => {
    render(<LabShell />);

    // Click 管线 tab → shows real panels (Batch 170)
    fireEvent.click(screen.getByRole("tab", { name: /管线/ }));
    expect(screen.getByRole("tab", { name: /管线/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Token 用量仪表盘")).toBeInTheDocument();
    expect(screen.getByText("管线步骤延迟分析")).toBeInTheDocument();
    expect(screen.getByText("Pipeline 追踪浏览器")).toBeInTheDocument();

    // Click 数据 tab → shows real panels (Batch 171)
    fireEvent.click(screen.getByRole("tab", { name: /数据/ }));
    expect(screen.getByText("记忆浏览器")).toBeInTheDocument();
    expect(screen.getByText("嵌入空间")).toBeInTheDocument();
    expect(screen.getByText("缓存命中率")).toBeInTheDocument();

    // Click 图谱 tab → shows real panels (Batch 172)
    fireEvent.click(screen.getByRole("tab", { name: /图谱/ }));
    expect(screen.getByText("知识图谱")).toBeInTheDocument();
    expect(screen.getByText("衰减分布")).toBeInTheDocument();
    expect(screen.getByTestId("health-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("log-viewer")).toBeInTheDocument();

    // Click 实验 tab → shows mocked panels (Batch 179)
    fireEvent.click(screen.getByRole("tab", { name: /实验/ }));
    expect(screen.getByRole("tab", { name: /实验/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("experiment-compare-panel")).toBeInTheDocument();
    expect(screen.getByTestId("cost-waterfall-panel")).toBeInTheDocument();
  });

  it("has all five tabs with real panels — no placeholder remains", () => {
    render(<LabShell />);

    // Switch through all tabs, verify real panels on each
    fireEvent.click(screen.getByRole("tab", { name: /图谱/ }));
    expect(screen.getByText("知识图谱")).toBeInTheDocument();
    expect(screen.getByText("衰减分布")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /上下文/ }));
    expect(screen.getByText("溢出模拟")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /管线/ }));
    expect(screen.getByText("Token 用量仪表盘")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /数据/ }));
    expect(screen.getByText("记忆浏览器")).toBeInTheDocument();

    // 实验 tab 使用 mock 组件（自 fetch）
    fireEvent.click(screen.getByRole("tab", { name: /实验/ }));
    expect(screen.getByTestId("experiment-compare-panel")).toBeInTheDocument();
    expect(screen.getByTestId("cost-waterfall-panel")).toBeInTheDocument();
  });

  it("has correct tablist ARIA label", () => {
    render(<LabShell />);

    expect(
      screen.getByRole("tablist", { name: "实验室面板" }),
    ).toBeInTheDocument();
  });

  // ── 重复点击当前 tab 无副作用 ──

  it("repeated click on active tab is no-op", () => {
    render(<LabShell />);
    const contextTab = screen.getByRole("tab", { name: /上下文/ });
    fireEvent.click(contextTab);
    fireEvent.click(contextTab);
    expect(contextTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("溢出模拟")).toBeInTheDocument();
  });

  // ── Tab 图标 ──

  it("each tab button contains an SVG icon", () => {
    render(<LabShell />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(5);
    for (const tab of tabs) {
      const svg = tab.querySelector("svg");
      expect(svg).toBeInTheDocument();
    }
  });

  // ── 内容区滚动 ──

  it("content area has overflow-y-auto for scrolling", () => {
    render(<LabShell />);
    // 内容是 TabBar 之后的 div，有 flex-1 overflow-y-auto p-gm-5
    const panel = screen.getByText("溢出模拟");
    const scrollArea = panel.closest(".overflow-y-auto");
    expect(scrollArea).toBeInTheDocument();
  });

  // ── 快速切换持久性 ──

  it("rapid tab switching preserves final state correctly", () => {
    render(<LabShell />);
    fireEvent.click(screen.getByRole("tab", { name: /管线/ }));
    fireEvent.click(screen.getByRole("tab", { name: /数据/ }));
    fireEvent.click(screen.getByRole("tab", { name: /图谱/ }));
    expect(screen.getByRole("tab", { name: /图谱/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("知识图谱")).toBeInTheDocument();
  });

  // ── 切换后切回保持内容 ──

  it("switching away and back preserves original tab content", () => {
    render(<LabShell />);
    // 默认在上下文 tab
    expect(screen.getByText("溢出模拟")).toBeInTheDocument();
    // 切换到图谱
    fireEvent.click(screen.getByRole("tab", { name: /图谱/ }));
    expect(screen.getByText("知识图谱")).toBeInTheDocument();
    // 切回上下文 — 内容完好
    fireEvent.click(screen.getByRole("tab", { name: /上下文/ }));
    expect(screen.getByText("溢出模拟")).toBeInTheDocument();
  });

  // ── Tab key → 面板映射 ──

  it("pipeline tab shows three pipeline panels", () => {
    render(<LabShell />);
    fireEvent.click(screen.getByRole("tab", { name: /管线/ }));
    expect(screen.getByText("Token 用量仪表盘")).toBeInTheDocument();
    expect(screen.getByText("管线步骤延迟分析")).toBeInTheDocument();
    expect(screen.getByText("Pipeline 追踪浏览器")).toBeInTheDocument();
  });

  // ── Phase 43 Batch 1: URL param tab selection ──

  it("accepts ?tab= URL param and selects the matching tab", () => {
    mockUseSearchParams.mockReturnValueOnce(new URLSearchParams("tab=experiment"));
    render(<LabShell />);
    expect(screen.getByRole("tab", { name: /实验/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("experiment-compare-panel")).toBeInTheDocument();
  });

  it("falls back to default context tab for invalid ?tab= value", () => {
    mockUseSearchParams.mockReturnValueOnce(new URLSearchParams("tab=invalid"));
    render(<LabShell />);
    expect(screen.getByRole("tab", { name: /上下文/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("溢出模拟")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Mock HealthDashboard + LogViewer + PipelineTracePanel — 它们自 fetch，不干扰 Tab 切换测试
vi.mock("@/components/observability/HealthDashboard", () => ({
  default: () => <div data-testid="health-dashboard">HealthDashboard Mock</div>,
}));
vi.mock("@/components/observability/LogViewer", () => ({
  default: () => <div data-testid="log-viewer">LogViewer Mock</div>,
}));
vi.mock("@/components/lab/PipelineTracePanel", () => ({
  default: () => <div data-testid="pipeline-trace-panel">PipelineTracePanel Mock</div>,
}));

vi.mock("@/components/observability/CompressionLogPanel", () => ({
  default: () => <div data-testid="compression-log-panel">CompressionLogPanel Mock</div>,
}));

import ObserveShell from "@/components/observability/ObserveShell";

afterEach(cleanup);

describe("ObserveShell", () => {
  // ── Tab 渲染 ──

  it("renders all four tab buttons", () => {
    render(<ObserveShell />);

    expect(
      screen.getByRole("tab", { name: "健康仪表盘" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "日志查看器" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Trace 历史" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "压缩日志" }),
    ).toBeInTheDocument();
  });

  // ── 默认 Tab ──

  it('has "健康仪表盘" tab selected by default', () => {
    render(<ObserveShell />);

    const healthTab = screen.getByRole("tab", { name: "健康仪表盘" });
    expect(healthTab).toHaveAttribute("aria-selected", "true");
  });

  it("renders HealthDashboard on default health tab", () => {
    render(<ObserveShell />);

    expect(screen.getByTestId("health-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("log-viewer")).not.toBeInTheDocument();
  });

  // ── Tab 切换 → 日志查看器 ──

  it("switches to LogViewer when clicking 日志查看器 tab", () => {
    render(<ObserveShell />);

    fireEvent.click(screen.getByRole("tab", { name: "日志查看器" }));

    expect(screen.getByTestId("log-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("health-dashboard")).not.toBeInTheDocument();

    const logsTab = screen.getByRole("tab", { name: "日志查看器" });
    expect(logsTab).toHaveAttribute("aria-selected", "true");
  });

  // ── Tab 切换 → Trace 历史（已实现） ──

  it('renders PipelineTracePanel for "Trace 历史" tab', () => {
    render(<ObserveShell />);

    fireEvent.click(screen.getByRole("tab", { name: "Trace 历史" }));

    expect(screen.getByTestId("pipeline-trace-panel")).toBeInTheDocument();
    expect(
      screen.queryByTestId("health-dashboard"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("log-viewer")).not.toBeInTheDocument();
  });

  it('renders CompressionLogPanel for "压缩日志" tab', () => {
    render(<ObserveShell />);

    fireEvent.click(screen.getByRole("tab", { name: "压缩日志" }));

    expect(screen.getByTestId("compression-log-panel")).toBeInTheDocument();
    expect(
      screen.queryByTestId("health-dashboard"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("log-viewer")).not.toBeInTheDocument();
  });

  // ── 压缩日志面板已接入（不再显示占位） ──

  it("compression tab renders real panel, not placeholder", () => {
    render(<ObserveShell />);

    fireEvent.click(screen.getByRole("tab", { name: "压缩日志" }));

    // CompressionLogPanel mock is rendered — no "即将上线" placeholder
    expect(screen.getByTestId("compression-log-panel")).toBeInTheDocument();
    expect(screen.queryByText("即将上线")).not.toBeInTheDocument();
  });

  // ── TabBar aria-label ──

  it("renders TabBar with aria-label for accessibility", () => {
    render(<ObserveShell />);

    expect(
      screen.getByRole("tablist", { name: "可观测性面板" }),
    ).toBeInTheDocument();
  });
});

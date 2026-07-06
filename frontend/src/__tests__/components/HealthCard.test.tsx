import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HealthCard from "@/components/observability/HealthCard";
import type { HealthComponent } from "@/lib/api/types";

const okComponent: HealthComponent = {
  status: "ok",
  latency_ms: 12.3,
  detail: "SQLite 响应正常",
};

const warnComponent: HealthComponent = {
  status: "warn",
  latency_ms: 82,
  detail: "磁盘使用率 82%，建议清理",
};

const errorComponent: HealthComponent = {
  status: "error",
  latency_ms: 5000,
  detail: "LLM API 连接超时",
};

const unknownComponent: HealthComponent = {
  status: "degraded",
  latency_ms: 150,
  detail: "部分功能降级",
};

const longDetailComponent: HealthComponent = {
  status: "ok",
  latency_ms: 5,
  detail:
    "这是一段非常长的详情文本，用于测试 line-clamp 截断功能。" +
    "当详情超过 60 个字符时，应该显示 title 属性以支持原生 tooltip。" +
    "这段文本足够长了。",
};

describe("HealthCard", () => {
  it("renders ok status with correct label, pill, and latency", () => {
    render(<HealthCard component={okComponent} label="数据库" />);

    expect(screen.getByText("数据库")).toBeInTheDocument();
    expect(screen.getByText("正常")).toBeInTheDocument();
    expect(screen.getByText("12.3ms")).toBeInTheDocument();
    expect(screen.getByText("SQLite 响应正常")).toBeInTheDocument();
  });

  it("renders warn status with warning colors", () => {
    render(<HealthCard component={warnComponent} label="磁盘空间" />);

    expect(screen.getByText("磁盘空间")).toBeInTheDocument();
    expect(screen.getByText("警告")).toBeInTheDocument();
    expect(screen.getByText("82.0ms")).toBeInTheDocument();

    // 状态 pill 应有 warning 相关类名
    const pill = screen.getByText("警告");
    expect(pill.className).toContain("text-warning");
  });

  it("renders error status with danger colors", () => {
    render(<HealthCard component={errorComponent} label="LLM API" />);

    expect(screen.getByText("LLM API")).toBeInTheDocument();
    expect(screen.getByText("异常")).toBeInTheDocument();
    expect(screen.getByText("5000.0ms")).toBeInTheDocument();

    const pill = screen.getByText("异常");
    expect(pill.className).toContain("text-danger");
  });

  it("falls back to raw status string for unknown status", () => {
    render(<HealthCard component={unknownComponent} label="自定义" />);

    // 未知状态应显示原始字符串
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText("150.0ms")).toBeInTheDocument();
  });

  it("adds title attribute for long detail text", () => {
    render(<HealthCard component={longDetailComponent} label="测试" />);

    // 详情文本应被截断且有 title 属性
    const detailElement = screen.getByText(/这是一段非常长的详情文本/);
    expect(detailElement).toBeInTheDocument();
    expect(detailElement).toHaveAttribute("title");
    expect(detailElement.getAttribute("title")).toBe(
      longDetailComponent.detail,
    );
  });

  it("shows fallback text when detail is empty", () => {
    const noDetail: HealthComponent = {
      status: "ok",
      latency_ms: 1,
      detail: "",
    };
    render(<HealthCard component={noDetail} label="空详情" />);
    expect(screen.getByText("无详情")).toBeInTheDocument();
  });

  // ── 延迟着色边界值 ──

  it("latency below 50ms renders green text-success dot", () => {
    const fast: HealthComponent = {
      status: "ok",
      latency_ms: 25,
      detail: "快速响应",
    };
    render(<HealthCard component={fast} label="快速" />);
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
    expect(dot!.className).toContain("text-success");
  });

  it("latency at exactly 50ms boundary shows text-warning", () => {
    const at50: HealthComponent = {
      status: "ok",
      latency_ms: 50.0,
      detail: "边界",
    };
    render(<HealthCard component={at50} label="边界" />);
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot!.className).toContain("text-warning");
  });

  it("latency above 200ms renders red text-danger", () => {
    const slow: HealthComponent = {
      status: "warn",
      latency_ms: 210,
      detail: "慢响应",
    };
    render(<HealthCard component={slow} label="慢" />);
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot!.className).toContain("text-danger");
  });

  // ── 未知状态样式 ──

  it("unknown status renders correct accent bar and pill classes", () => {
    render(<HealthCard component={unknownComponent} label="自定义" />);
    const accentBar = document.querySelector(".h-gm-accent-bar.w-full");
    expect(accentBar).toBeInTheDocument();
    expect(accentBar!.className).toContain("bg-border-strong");
    const pill = screen.getByText("degraded");
    expect(pill.className).toContain("bg-surface-lowered");
    expect(pill.className).toContain("text-text-muted");
  });

  // ── 详情截断边界 ──

  it("detail at exactly 60 characters has no title attribute", () => {
    const exact60 =
      "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
    const exactly60: HealthComponent = {
      status: "ok",
      latency_ms: 3,
      detail: exact60,
    };
    render(<HealthCard component={exactly60} label="边界" />);
    const detailEl = screen.getByText(exact60);
    expect(detailEl).toBeInTheDocument();
    expect(detailEl).not.toHaveAttribute("title");
  });
});

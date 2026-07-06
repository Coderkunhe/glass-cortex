import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DataState from "@/components/ui/DataState";

afterEach(cleanup);

describe("DataState", () => {
  // ── Loading state ──

  it("renders loading spinner and default message", () => {
    render(
      <DataState state="loading">
        <p>content</p>
      </DataState>,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("加载中…")).toBeTruthy();
  });

  it("renders custom loading message", () => {
    render(
      <DataState state="loading" loadingMessage="加载 Token 数据…">
        <p>content</p>
      </DataState>,
    );
    expect(screen.getByText("加载 Token 数据…")).toBeTruthy();
  });

  it("applies custom loading icon color class", () => {
    const { container } = render(
      <DataState state="loading" loadingIconClassName="text-brand">
        <p>content</p>
      </DataState>,
    );
    const svg = container.querySelector("svg");
    expect(svg?.className.baseVal || svg?.getAttribute("class")).toMatch(
      /text-brand/,
    );
  });

  // ── Error state ──

  it("renders ErrorDisplay card when state is error", () => {
    render(
      <DataState
        state="error"
        error={new Error("测试错误")}
        onRetry={() => {}}
      >
        <p>content</p>
      </DataState>,
    );
    // ErrorDisplay renders role="alert"
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("does not render children when error", () => {
    render(
      <DataState state="error" error="fail">
        <p>unique-child-text</p>
      </DataState>,
    );
    expect(screen.queryByText("unique-child-text")).toBeNull();
  });

  it("renders retry button in ErrorDisplay", () => {
    render(
      <DataState state="error" error="fail" onRetry={() => {}}>
        <p>content</p>
      </DataState>,
    );
    // Retry button should be present
    expect(screen.getByText("重试")).toBeTruthy();
  });

  // ── Empty/Idle state ──

  it("renders empty state when state is idle", () => {
    render(
      <DataState state="idle" emptyMessage="暂无 Token 数据">
        <p>content</p>
      </DataState>,
    );
    expect(screen.getByText("暂无 Token 数据")).toBeTruthy();
  });

  it("renders empty state when isEmpty is true even if state is success", () => {
    render(
      <DataState state="success" isEmpty emptyMessage="暂无记录">
        <p>content</p>
      </DataState>,
    );
    expect(screen.getByText("暂无记录")).toBeTruthy();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("renders default empty message when not specified", () => {
    render(
      <DataState state="idle">
        <p>content</p>
      </DataState>,
    );
    expect(screen.getByText("暂无数据")).toBeTruthy();
  });

  it("renders custom empty icon when provided", () => {
    function CustomIcon({ className }: { className?: string }) {
      return <svg className={className} data-testid="custom-empty-icon" />;
    }
    render(
      <DataState state="idle" emptyIcon={CustomIcon}>
        <p>content</p>
      </DataState>,
    );
    expect(screen.getByTestId("custom-empty-icon")).toBeTruthy();
  });

  // ── Success state ──

  it("renders children when state is success and not empty", () => {
    render(
      <DataState state="success">
        <p>success-content</p>
      </DataState>,
    );
    expect(screen.getByText("success-content")).toBeTruthy();
  });

  it("does not render loading/error/empty chrome in success state", () => {
    const { container } = render(
      <DataState state="success">
        <p>data</p>
      </DataState>,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  // ── State transitions ──

  it("renders only one state at a time — loading excludes children", () => {
    render(
      <DataState state="loading">
        <p>should-not-appear</p>
      </DataState>,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("should-not-appear")).toBeNull();
  });

  it("renders only one state at a time — error excludes children", () => {
    render(
      <DataState state="error" error="fail">
        <p>should-not-appear</p>
      </DataState>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("should-not-appear")).toBeNull();
  });

  it("renders only one state at a time — idle excludes children", () => {
    render(
      <DataState state="idle">
        <p>should-not-appear</p>
      </DataState>,
    );
    expect(screen.getByText("暂无数据")).toBeTruthy();
    expect(screen.queryByText("should-not-appear")).toBeNull();
  });
});

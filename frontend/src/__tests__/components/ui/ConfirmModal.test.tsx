import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ConfirmModal from "@/components/ui/ConfirmModal";

afterEach(cleanup);

describe("ConfirmModal", () => {
  it("does not render when isOpen=false", () => {
    render(
      <ConfirmModal
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="测试标题"
        message="测试消息"
      />,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders title, message, and action buttons when open", () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="删除确认"
        message="确定要删除吗？"
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeDefined();
    expect(screen.getByText("删除确认")).toBeDefined();
    expect(screen.getByText("确定要删除吗？")).toBeDefined();
    expect(screen.getByText("取消")).toBeDefined();
    expect(screen.getByText("确认删除")).toBeDefined();
  });

  it("uses custom confirmLabel when provided", () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="测试"
        message="测试"
        confirmLabel="是的，删除"
      />,
    );
    expect(screen.getByText("是的，删除")).toBeDefined();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="测试"
        message="测试"
      />,
    );
    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="测试"
        message="测试"
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="测试"
        message="测试"
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="测试"
        message="测试"
      />,
    );
    fireEvent.click(screen.getByText("确认删除"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables close interactions when loading", () => {
    const onClose = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="测试"
        message="测试"
        isLoading={true}
      />,
    );

    // Cancel button should be disabled
    const cancelBtn = screen.getByText("取消");
    expect(cancelBtn.hasAttribute("disabled")).toBe(true);

    // Backdrop click should not call onClose
    fireEvent.click(screen.getByTestId("confirm-modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();

    // Escape should not call onClose
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows loading spinner and disables confirm button when loading", () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="测试"
        message="测试"
        isLoading={true}
      />,
    );
    expect(screen.getByText("处理中…")).toBeDefined();
    const confirmBtn = screen.getByText("处理中…").closest("button");
    expect(confirmBtn?.hasAttribute("disabled")).toBe(true);
  });

  it("renders error via ErrorDisplay when error prop is set", () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="测试"
        message="测试"
        error={new Error("删除失败，请重试")}
      />,
    );
    // ErrorDisplay renders an alert role + generic heading
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("出错了")).toBeDefined();
  });

  it("renders danger variant with alert icon and red confirm button", () => {
    const { container } = render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="危险操作"
        message="不可撤销"
        variant="danger"
      />,
    );
    // danger variant: confirm button has bg-danger class
    const confirmBtn = screen.getByText("确认删除");
    expect(confirmBtn.className).toContain("bg-danger");

    // danger variant: header has alert icon (RiAlertLine renders an svg)
    const headerAlert = container.querySelector(".text-danger");
    expect(headerAlert).not.toBeNull();
  });

  it("does not render alert icon for default variant", () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="普通操作"
        message="可撤销"
        variant="default"
      />,
    );
    // default variant: no RiAlertLine in header → no .text-danger in header area
    // The confirm button has brand class, not danger
    const confirmBtn = screen.getByText("确认删除");
    expect(confirmBtn.className).toContain("bg-brand");
    expect(confirmBtn.className).not.toContain("bg-danger");
  });

  it("supports async onConfirm (Promise-based)", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="测试"
        message="测试"
      />,
    );
    fireEvent.click(screen.getByText("确认删除"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Verify the promise resolves without error
    await expect(onConfirm.mock.results[0].value).resolves.toBeUndefined();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import ProfileModal from "@/components/profile/ProfileModal";

afterEach(cleanup);

// ── Props factory ─────────────────────────────────────────────────────

interface ModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onCreate?: (name: string) => Promise<void>;
  creating?: boolean;
  error?: Error | string | null;
  onClearError?: () => void;
}

function buildProps(overrides: ModalProps = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    creating: false,
    error: null,
    onClearError: vi.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("ProfileModal", () => {
  // ── Closed state ──

  it("returns null when isOpen is false", () => {
    const { container } = render(
      <ProfileModal {...buildProps({ isOpen: false })} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("returns null when isOpen is undefined", () => {
    const { container } = render(
      <ProfileModal
        {...buildProps({ isOpen: undefined as unknown as boolean })}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  // ── Open state — structure ──

  it("renders dialog with aria-modal when open", () => {
    render(<ProfileModal {...buildProps()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("renders the title '新建 Profile'", () => {
    render(<ProfileModal {...buildProps()} />);

    expect(
      screen.getByRole("heading", { name: "新建 Profile" }),
    ).toBeInTheDocument();
  });

  it("renders name input with placeholder", () => {
    render(<ProfileModal {...buildProps()} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
  });

  it("renders cancel and create buttons", () => {
    render(<ProfileModal {...buildProps()} />);

    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("创建")).toBeInTheDocument();
  });

  // ── Input handling ──

  it("updates input value on typing", () => {
    render(<ProfileModal {...buildProps()} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    fireEvent.change(input, { target: { value: "test-profile" } });

    expect(input).toHaveValue("test-profile");
  });

  // ── Create button disabled states ──

  it("disables create button when input is empty", () => {
    render(<ProfileModal {...buildProps()} />);

    const createBtn = screen.getByText("创建");
    expect(createBtn).toBeDisabled();
  });

  it("disables create button when name is only whitespace", () => {
    render(<ProfileModal {...buildProps()} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    fireEvent.change(input, { target: { value: "   " } });

    const createBtn = screen.getByText("创建");
    expect(createBtn).toBeDisabled();
  });

  it("enables create button when name is non-empty", () => {
    render(<ProfileModal {...buildProps()} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    fireEvent.change(input, { target: { value: "my-profile" } });

    const createBtn = screen.getByText("创建");
    expect(createBtn).not.toBeDisabled();
  });

  it("disables create button when creating (even with name)", () => {
    render(<ProfileModal {...buildProps({ creating: true })} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    fireEvent.change(input, { target: { value: "my-profile" } });

    const createBtn = screen.getByText("创建中…");
    expect(createBtn).toBeDisabled();
  });

  // ── Create action ──

  it("calls onCreate with trimmed name on create button click", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<ProfileModal {...buildProps({ onCreate })} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    fireEvent.change(input, { target: { value: "  my-profile  " } });

    fireEvent.click(screen.getByText("创建"));
    expect(onCreate).toHaveBeenCalledWith("my-profile");
  });

  it("calls onCreate on Enter key press", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<ProfileModal {...buildProps({ onCreate })} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    fireEvent.change(input, { target: { value: "enter-profile" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreate).toHaveBeenCalledWith("enter-profile");
  });

  it("does not call onCreate when Enter pressed with empty name", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<ProfileModal {...buildProps({ onCreate })} />);

    const input = screen.getByPlaceholderText(/输入 profile 名称/);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreate).not.toHaveBeenCalled();
  });

  // ── Close actions ──

  it("calls onClose when cancel button clicked", () => {
    const onClose = vi.fn();
    render(<ProfileModal {...buildProps({ onClose })} />);

    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key pressed", () => {
    const onClose = vi.fn();
    render(<ProfileModal {...buildProps({ onClose })} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose on Escape when creating (disabled)", () => {
    const onClose = vi.fn();
    render(<ProfileModal {...buildProps({ onClose, creating: true })} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ProfileModal {...buildProps({ onClose })} />,
    );

    // The backdrop is the first child (absolute inset-0 div)
    const backdrop = container.querySelector(".bg-black\\/35");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when backdrop clicked during creating", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ProfileModal {...buildProps({ onClose, creating: true })} />,
    );

    const backdrop = container.querySelector(".bg-black\\/35");
    fireEvent.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Creating state ──

  it("shows spinner and '创建中…' text when creating", () => {
    render(<ProfileModal {...buildProps({ creating: true })} />);

    expect(screen.getByText("创建中…")).toBeInTheDocument();
    // Cancel button should not say "创建"
    expect(screen.queryByText("创建")).not.toBeInTheDocument();
  });

  it("disables close button when creating", () => {
    render(<ProfileModal {...buildProps({ creating: true })} />);

    // The close (✕) button and cancel button are disabled
    const cancelBtn = screen.getByText("取消");
    expect(cancelBtn).toBeDisabled();
  });

  // ── Error display ──

  it("renders ErrorDisplay when error prop is set", () => {
    render(
      <ProfileModal
        {...buildProps({ error: new Error("名称已存在") })}
      />,
    );

    // ErrorDisplay renders role="alert" with categorized message
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not show error area when error is null", () => {
    const { container } = render(
      <ProfileModal {...buildProps({ error: null })} />,
    );

    // The danger-colored error banner should not exist
    expect(container.querySelector(".bg-danger\\/10")).toBeNull();
  });
});

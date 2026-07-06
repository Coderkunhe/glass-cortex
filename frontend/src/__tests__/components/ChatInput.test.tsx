import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatInput from "@/components/chat/ChatInput";

describe("ChatInput", () => {
  it("renders input and send button", () => {
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /发送/ })).toBeInTheDocument();
  });

  it("calls onSend with trimmed value on button click", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "  你好  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    expect(onSend).toHaveBeenCalledWith("你好");
  });

  it("calls onSend on Enter", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/输入消息/), {
      key: "Enter",
      shiftKey: false,
    });

    expect(onSend).toHaveBeenCalledWith("你好");
  });

  it("does not send on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/输入消息/), {
      key: "Enter",
      shiftKey: true,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send empty or whitespace-only input", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: /发送/ }));
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables input and button when disabled", () => {
    render(<ChatInput onSend={vi.fn()} disabled />);
    expect(screen.getByPlaceholderText(/输入消息/)).toBeDisabled();
    expect(screen.getByRole("button", { name: /发送中/ })).toBeDisabled();
  });

  // ── Shift+Enter 换行（不发送）──

  it("Shift+Enter inserts newline, does not send", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "你好" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/输入消息/), {
      key: "Enter",
      shiftKey: true,
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  // ── 输入清空 ──

  it("clears input after successful send", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(
      /输入消息/,
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "测试消息" } });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));
    expect(textarea.value).toBe("");
  });

  // ── disabled 时不发送 ──

  it("does not call onSend when disabled even with valid input", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} disabled />);
    fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
      target: { value: "测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送中/ }));
    expect(onSend).not.toHaveBeenCalled();
  });

  // ── Spinner 图标 ──

  it("shows spinner SVG when disabled", () => {
    render(<ChatInput onSend={vi.fn()} disabled />);
    const button = screen.getByRole("button", { name: /发送中/ });
    const svg = button.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg!.getAttribute("class")).toContain("animate-spin");
  });

  // ── 空值按钮 disabled ──

  it("send button is disabled when input is empty", () => {
    render(<ChatInput onSend={vi.fn()} />);
    const button = screen.getByRole("button", { name: /发送/ });
    expect(button).toBeDisabled();
  });

  // ── Placeholder 提示 ──

  it("placeholder shows keyboard instruction", () => {
    render(<ChatInput onSend={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/Enter 发送/);
    expect(textarea).toBeInTheDocument();
  });

  // ── Abort 按钮 ──

  it("shows stop button when disabled with onAbort", () => {
    const onAbort = vi.fn();
    render(<ChatInput onSend={vi.fn()} disabled onAbort={onAbort} />);
    expect(screen.getByRole("button", { name: /停止/ })).toBeInTheDocument();
  });

  it("calls onAbort when stop button clicked", () => {
    const onAbort = vi.fn();
    render(<ChatInput onSend={vi.fn()} disabled onAbort={onAbort} />);
    fireEvent.click(screen.getByRole("button", { name: /停止/ }));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});

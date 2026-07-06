import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CopyButton } from "@/components/ui/CopyButton";

describe("CopyButton", () => {
  // ── Basic rendering ──

  it("renders with default label '复制'", () => {
    render(<CopyButton text="hello world" />);
    expect(screen.getByText("复制")).toBeInTheDocument();
  });

  it("renders the copy icon", () => {
    render(<CopyButton text="hello world" />);
    const button = screen.getByRole("button");
    expect(button.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with type='button'", () => {
    render(<CopyButton text="hello world" />);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  // ── Clipboard interaction ──

  it("copies text to clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton text="hello world" />);
    fireEvent.click(screen.getByRole("button"));

    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("shows '已复制' after successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton text="hello world" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    await waitFor(() => {
      expect(screen.getByText("已复制")).toBeInTheDocument();
    });
  });

  it("resets to '复制' after 2 seconds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton text="hello world" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    // After the promise resolves, "已复制" should appear
    await waitFor(() => {
      expect(screen.getByText("已复制")).toBeInTheDocument();
    });

    // After 2 seconds, it should reset to "复制"
    await waitFor(
      () => {
        expect(screen.getByText("复制")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("stops event propagation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const parentHandler = vi.fn();

    render(
      <div onClick={parentHandler}>
        <CopyButton text="hello world" />
      </div>
    );

    fireEvent.click(screen.getByRole("button"));
    expect(parentHandler).not.toHaveBeenCalled();
  });

  // ── Error handling ──

  it("handles clipboard rejection gracefully", () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    // Should not throw
    expect(() => {
      render(<CopyButton text="hello world" />);
      fireEvent.click(screen.getByRole("button"));
    }).not.toThrow();

    // Still shows default label (no crash)
    expect(screen.getByText("复制")).toBeInTheDocument();
  });

  // ── Styling props ──

  it("applies custom className", () => {
    render(<CopyButton text="hello world" className="my-custom" />);
    expect(screen.getByRole("button").className).toContain("my-custom");
  });

  it("applies data-testid", () => {
    render(<CopyButton text="hello world" data-testid="copy-btn" />);
    expect(screen.getByTestId("copy-btn")).toBeInTheDocument();
  });

  // ── Cleanup ──

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

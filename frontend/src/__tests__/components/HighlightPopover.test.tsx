import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HighlightPopover from "@/components/learn/HighlightPopover";

/** 构造一个假 DOMRect 用于虚拟参考元素 */
function makeRect(x = 100, y = 200): DOMRect {
  return {
    x,
    y,
    width: 120,
    height: 20,
    top: y,
    right: x + 120,
    bottom: y + 20,
    left: x,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("HighlightPopover", () => {
  const baseProps = {
    noteId: "note-1",
    selectedText: "这是一段划线的文本",
    color: "yellow" as const,
    referenceRect: makeRect(),
    onDelete: vi.fn(),
    onAddNote: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders when referenceRect is provided", () => {
    render(<HighlightPopover {...baseProps} />);
    expect(screen.getByTestId("highlight-popover-delete")).toBeInTheDocument();
    expect(screen.getByTestId("highlight-popover-copy")).toBeInTheDocument();
    expect(screen.getByTestId("highlight-popover-note")).toBeInTheDocument();
  });

  it("returns null when referenceRect is null", () => {
    const { container } = render(
      <HighlightPopover {...baseProps} referenceRect={null} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("calls onDelete with noteId when delete button clicked", () => {
    const onDelete = vi.fn();
    render(<HighlightPopover {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId("highlight-popover-delete"));
    expect(onDelete).toHaveBeenCalledWith("note-1");
  });

  it("calls onAddNote with text and color when note button clicked", () => {
    const onAddNote = vi.fn();
    render(<HighlightPopover {...baseProps} onAddNote={onAddNote} />);
    fireEvent.click(screen.getByTestId("highlight-popover-note"));
    expect(onAddNote).toHaveBeenCalledWith("这是一段划线的文本", "yellow");
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<HighlightPopover {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

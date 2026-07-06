import { describe, it, expect, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import ExplainPopover from "@/components/ui/ExplainPopover";

describe("ExplainPopover", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders trigger element", () => {
    render(
      <ExplainPopover termId="context-window">
        上下文窗口
      </ExplainPopover>,
    );
    const trigger = screen.getByText("上下文窗口");
    expect(trigger).toBeInTheDocument();
    expect(trigger.closest(".gm-popover-trigger")).toBeInTheDocument();
  });

  it("opens popover on trigger click", async () => {
    render(
      <ExplainPopover termId="context-window">
        上下文窗口
      </ExplainPopover>,
    );
    fireEvent.click(screen.getByText("上下文窗口"));

    await waitFor(() => {
      // Dialog appears (portal renders to body)
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("shows term title and longDef paragraphs", async () => {
    render(
      <ExplainPopover termId="faiss-index">
        FAISS
      </ExplainPopover>,
    );
    fireEvent.click(screen.getByText("FAISS"));

    await waitFor(() => {
      // Title
      expect(screen.getByText("FAISS 向量索引")).toBeInTheDocument();
      // Category info
      expect(screen.getByText(/架构/)).toBeInTheDocument();
    });
  });

  it("closes on backdrop click", async () => {
    render(
      <ExplainPopover termId="planner">
        规划器
      </ExplainPopover>,
    );
    fireEvent.click(screen.getByText("规划器"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Click the backdrop (the outer dialog div)
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog); // clicks the backdrop because we target the dialog div itself

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("closes on Escape key", async () => {
    render(
      <ExplainPopover termId="planner">
        规划器
      </ExplainPopover>,
    );
    fireEvent.click(screen.getByText("规划器"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("closes on close button click", async () => {
    render(
      <ExplainPopover termId="ebbinghaus-decay">
        艾宾浩斯衰减
      </ExplainPopover>,
    );
    fireEvent.click(screen.getByText("艾宾浩斯衰减"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const closeBtn = screen.getByLabelText("关闭");
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("related term click switches popover content", async () => {
    render(
      <ExplainPopover termId="faiss-index">
        FAISS
      </ExplainPopover>,
    );
    fireEvent.click(screen.getByText("FAISS"));

    await waitFor(() => {
      expect(screen.getByText("FAISS 向量索引")).toBeInTheDocument();
    });

    // Click a related term pill — "记忆召回" should be one of the related terms
    const relatedPills = screen.getAllByText("记忆召回");
    // There may be both a pill and the future title — click the pill (button)
    const pill = relatedPills.find((el) => el.tagName === "BUTTON")!;
    fireEvent.click(pill);

    await waitFor(() => {
      // Content should now show memory recall info
      expect(screen.getByText(/语义相似度/)).toBeInTheDocument();
    });
  });

  it("handles missing termId gracefully", () => {
    render(
      <ExplainPopover termId="nonexistent">
        未知词
      </ExplainPopover>,
    );
    // Trigger still renders
    expect(screen.getByText("未知词")).toBeInTheDocument();
  });

  it("has aria-modal and role when open", async () => {
    render(
      <ExplainPopover termId="token-budget">
        Token 预算
      </ExplainPopover>,
    );
    fireEvent.click(screen.getByText("Token 预算"));

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
    });
  });

  it("opens on Enter key", async () => {
    render(
      <ExplainPopover termId="embedding">
        嵌入向量
      </ExplainPopover>,
    );
    const trigger = screen.getByText("嵌入向量").closest(".gm-popover-trigger")!;
    fireEvent.keyDown(trigger, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("opens on Space key", async () => {
    render(
      <ExplainPopover termId="embedding">
        嵌入向量
      </ExplainPopover>,
    );
    const trigger = screen.getByText("嵌入向量").closest(".gm-popover-trigger")!;
    fireEvent.keyDown(trigger, { key: " " });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});

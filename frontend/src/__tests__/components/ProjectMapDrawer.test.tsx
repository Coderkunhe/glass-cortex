import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import ProjectMapDrawer from "@/components/layout/ProjectMapDrawer";

// ── rAF 同步化 — Drawer 依赖双 rAF 动画状态机，stub 后同步执行 ──
let rafCallbacks: Array<() => void> = [];

function flushRaf() {
  const cbs = rafCallbacks.splice(0);
  cbs.forEach((cb) => act(() => cb()));
}

beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(() => cb(0));
      return 0;
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("ProjectMapDrawer", () => {
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onClose = vi.fn();
    mockPush.mockClear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing visible when isOpen=false", () => {
    const { container } = render(
      <ProjectMapDrawer isOpen={false} onClose={onClose} />,
    );
    // Component returns null when not mounted and not open
    expect(container.innerHTML).toBe("");
  });

  it("renders 5 sections when open", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByText("📖 项目介绍")).toBeInTheDocument();
      expect(screen.getByText("🗺️ 消息旅程")).toBeInTheDocument();
      expect(screen.getByText("🔄 流程图")).toBeInTheDocument();
      expect(screen.getByText("🧭 页面导航")).toBeInTheDocument();
      expect(screen.getByText("📚 概念速查")).toBeInTheDocument();
    });
  });

  it("nav cards navigate to correct paths", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByText("聊天")).toBeInTheDocument();
    });

    // Click the 聊天 nav card
    fireEvent.click(screen.getByText("聊天"));
    expect(mockPush).toHaveBeenCalledWith("/");
    expect(onClose).toHaveBeenCalled();

    // Click the 实验室 nav card
    fireEvent.click(screen.getByText("实验室"));
    expect(mockPush).toHaveBeenCalledWith("/lab");
  });

  it("close button calls onClose", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByLabelText("关闭项目地图")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("关闭项目地图"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click calls onClose", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Backdrop: shared Drawer renders fixed inset-0 overlay as first child
    const backdrop = document.querySelector('[class*="fixed"][class*="inset-0"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key calls onClose", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close on non-Escape key", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has role='dialog' and aria-modal='true'", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-label")).toBe("项目地图");
    });
  });

  it("header shows title '项目地图'", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByText("项目地图")).toBeInTheDocument();
    });
  });

  it("renders 6 journey steps", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      // Some step titles also appear as tooltips in section 1 — use getAllByText
      expect(screen.getAllByText("意图识别").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("记忆召回").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("上下文组装")).toBeInTheDocument();
      expect(screen.getByText("模型推理")).toBeInTheDocument();
      expect(screen.getByText("回复生成")).toBeInTheDocument();
      expect(screen.getByText("记忆存储")).toBeInTheDocument();
    });
  });

  it("concept section shows category groups", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      // Category labels include emoji prefix
      expect(screen.getByText(/🧠 记忆设计/)).toBeInTheDocument();
      // 📐 上下文工程 also appears in the flowchart section — use getAllByText
      expect(screen.getAllByText(/📐 上下文工程/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/💰 Token 效率/)).toBeInTheDocument();
      expect(screen.getByText(/🧭 任务规划/)).toBeInTheDocument();
      expect(screen.getByText(/🏗️ 系统架构/)).toBeInTheDocument();
    });
  });

  it("category accordion toggles on click", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByText(/🧠 记忆设计/)).toBeInTheDocument();
    });

    // Find the category button and click it
    const catButton = screen.getByText(/🧠 记忆设计/).closest("button");
    expect(catButton).toBeInTheDocument();
    fireEvent.click(catButton!);

    // After toggle, the terms should be visible — "语义相似度" appears in
    // both the journey step desc and the glossary accordion
    await waitFor(() => {
      const matches = screen.getAllByText(/语义相似度/);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Flowchart section tests ──

  it("flowchart section shows category labels", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByText(/🔀 记忆管线/)).toBeInTheDocument();
      // 📐 上下文工程 also appears in the glossary section
      expect(screen.getAllByText(/📐 上下文工程/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/🧪 记忆科学/)).toBeInTheDocument();
    });
  });

  it("flowchart accordion toggles on click", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    await waitFor(() => {
      expect(screen.getByText(/🔀 记忆管线/)).toBeInTheDocument();
    });

    const flowButton = screen
      .getByText(/🔀 记忆管线/)
      .closest("button");
    expect(flowButton).toBeInTheDocument();

    // The collapsed panel should have hidden overflow
    const panelDiv = flowButton!.nextElementSibling as HTMLElement;
    expect(panelDiv).toBeInTheDocument();
    // Before toggle: panel is collapsed (maxHeight: 0)
    expect(panelDiv.style.maxHeight).toBe("0px");

    fireEvent.click(flowButton!);

    // After toggle: panel is expanded
    await waitFor(() => {
      expect(panelDiv.style.maxHeight).toBe("2000px");
    });
  });

  it("all 3 flowchart categories show correct chart count", async () => {
    render(<ProjectMapDrawer isOpen={true} onClose={onClose} />);
    flushRaf();

    // Each category has 1 chart — "1 张图" should appear 3 times
    await waitFor(() => {
      const countLabels = screen.getAllByText("1 张图");
      expect(countLabels).toHaveLength(3);
    });
  });
});

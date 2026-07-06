/**
 * ImageViewer 组件测试。
 *
 * 使用 vitest + @testing-library/react + jsdom。
 * 覆盖：开/关状态、交互（点击遮罩/关闭按钮/Escape）、
 * ARIA 属性、Body 滚动锁定。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ImageViewer from "@/components/ui/ImageViewer";

const TEST_SRC = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E";
const TEST_ALT = "测试流程图";

describe("ImageViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset body styles between tests
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
    document.documentElement.style.overflow = "";
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. 开关状态 ──

  it("renders nothing when isOpen is false", () => {
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the lightbox when isOpen is true", () => {
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // ── 2. 内容渲染 ──

  it("renders an img with the correct src and alt", () => {
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={() => {}}
      />,
    );
    const img = screen.getByAltText(TEST_ALT);
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", TEST_SRC);
  });

  // ── 3. 关闭交互 ──

  it("calls onClose when clicking the backdrop", () => {
    const onClose = vi.fn();
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the close button", () => {
    const onClose = vi.fn();
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText("关闭预览"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when pressing Escape", () => {
    const onClose = vi.fn();
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not respond to Escape when closed", () => {
    const onClose = vi.fn();
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={false}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when clicking the image itself", () => {
    const onClose = vi.fn();
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByAltText(TEST_ALT));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── 2b. SVG iframe 渲染 (svgHtml prop) ──

  it("renders SVG via iframe srcDoc when svgHtml is provided", () => {
    const testSvg = "<svg><rect></rect></svg>";
    render(
      <ImageViewer
        svgHtml={testSvg}
        alt={TEST_ALT}
        isOpen={true}
        onClose={() => {}}
      />,
    );
    // 不使用 img 标签
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    // SVG 渲染在 iframe 中，不在 dialog 的 innerHTML 里
    const iframe = dialog.querySelector(".gm-iv-svg-iframe") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    // iframe srcdoc 属性包含 SVG
    expect(iframe.getAttribute("srcdoc")).toContain(testSvg);
    // Layer 和 overlay 存在
    expect(dialog.querySelector(".gm-iv-svg-layer")).toBeInTheDocument();
    expect(dialog.querySelector(".gm-iv-svg-overlay")).toBeInTheDocument();
  });

  it("calls onClose when clicking SVG overlay (click = close, not zoom)", () => {
    const onClose = vi.fn();
    const testSvg = "<svg><rect></rect></svg>";
    render(
      <ImageViewer
        svgHtml={testSvg}
        alt={TEST_ALT}
        isOpen={true}
        onClose={onClose}
      />,
    );
    const overlay = document.querySelector(
      ".gm-iv-svg-overlay",
    ) as HTMLElement;

    // Click overlay → close lightbox
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets zoom when lightbox reopens (unmount/remount)", () => {
    const testSvg = "<svg><rect></rect></svg>";

    function Wrapper({ open }: { open: boolean }) {
      if (!open) return null;
      return (
        <ImageViewer
          svgHtml={testSvg}
          alt={TEST_ALT}
          isOpen={true}
          onClose={() => {}}
        />
      );
    }

    const { rerender } = render(<Wrapper open={true} />);

    const overlay = document.querySelector(
      ".gm-iv-svg-overlay",
    ) as HTMLElement;
    const layer = document.querySelector(
      ".gm-iv-svg-layer",
    ) as HTMLElement;

    // Zoom in via wheel (deltaY > 0 → zoom out, < 0 → zoom in)
    fireEvent.wheel(overlay, { deltaY: -100, clientX: 50, clientY: 50 });
    // After wheel zoom, scale should be > 1
    const zoomedTransform = layer.style.transform;
    expect(zoomedTransform).not.toBe("translate(0px, 0px) scale(1)");

    // Close (unmount)
    rerender(<Wrapper open={false} />);
    expect(document.querySelector(".gm-iv-svg-layer")).toBeNull();

    // Reopen (fresh mount — scale reset to 1 via useState initial value)
    rerender(<Wrapper open={true} />);
    const newLayer = document.querySelector(
      ".gm-iv-svg-layer",
    ) as HTMLElement;
    expect(newLayer.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("renders img fallback when svgHtml is not provided", () => {
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={() => {}}
      />,
    );
    expect(screen.getByAltText(TEST_ALT).tagName).toBe("IMG");
  });

  // ── 4. ARIA 属性 ──

  it("has correct ARIA dialog attributes", () => {
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", TEST_ALT);
  });

  // ── 5. Body 滚动锁定 ──

  it("locks body scroll when open", () => {
    render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={() => {}}
      />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("restores body scroll when closed", () => {
    const { rerender } = render(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={true}
        onClose={() => {}}
      />,
    );
    expect(document.body.style.overflow).toBe("hidden");

    // 关闭
    rerender(
      <ImageViewer
        src={TEST_SRC}
        alt={TEST_ALT}
        isOpen={false}
        onClose={() => {}}
      />,
    );
    // jsdom 中 cleanup effect 后 body style 被恢复为空字符串
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

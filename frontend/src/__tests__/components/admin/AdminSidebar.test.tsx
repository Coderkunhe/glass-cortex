import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdminSidebar, { type AdminTab } from "@/components/admin/AdminSidebar";

// ── Helpers ──────────────────────────────────────────────────────────

function renderSidebar(overrides: {
  activeTab?: AdminTab;
  mobile?: boolean;
} = {}) {
  const onTab = vi.fn();
  const activeTab = overrides.activeTab ?? "health";
  const result = render(
    <AdminSidebar
      activeTab={activeTab}
      onTab={onTab}
      mobile={overrides.mobile}
    />,
  );
  return { onTab, activeTab, ...result };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("AdminSidebar", () => {
  describe("rendering", () => {
    it("renders all menu group headers", () => {
      renderSidebar();
      expect(screen.getByText("系统概览")).toBeInTheDocument();
      expect(screen.getByText("文档管理")).toBeInTheDocument();
    });

    it("renders all menu items", () => {
      renderSidebar();
      expect(screen.getByText("健康仪表盘")).toBeInTheDocument();
      expect(screen.getByText("文档清单")).toBeInTheDocument();
      expect(screen.getByText("工作日报")).toBeInTheDocument();
      expect(screen.getByText("需求日志")).toBeInTheDocument();
    });

    it("highlights active tab with primary color styles", () => {
      renderSidebar({ activeTab: "docs" });
      const docsBtn = screen.getByText("文档清单").closest("button")!;
      expect(docsBtn.className).toMatch(/border-primary/);
      expect(docsBtn.className).toMatch(/text-primary/);
    });

    it("renders non-active tabs as muted", () => {
      renderSidebar({ activeTab: "health" });
      const docsBtn = screen.getByText("文档清单").closest("button")!;
      expect(docsBtn.className).toMatch(/border-transparent/);
      expect(docsBtn.className).not.toMatch(/border-primary/);
    });
  });

  describe("interaction", () => {
    it("calls onTab with the clicked tab key", () => {
      const { onTab } = renderSidebar();
      fireEvent.click(screen.getByText("文档清单"));
      expect(onTab).toHaveBeenCalledWith("docs");
    });

    it("calls onTab for each menu item correctly", () => {
      const { onTab } = renderSidebar();
      fireEvent.click(screen.getByText("工作日报"));
      expect(onTab).toHaveBeenCalledWith("daily");
      fireEvent.click(screen.getByText("需求日志"));
      expect(onTab).toHaveBeenCalledWith("requirements-log");
    });

    it("collapses a group when clicking its header", () => {
      renderSidebar();
      const headerBtn = screen.getByText("系统概览").closest("button")!;
      // Initially expanded — menu items visible
      expect(screen.getByText("健康仪表盘")).toBeInTheDocument();

      fireEvent.click(headerBtn);
      // After collapse, the ul inside grid with gridTemplateRows "0fr" hides content
      // but DOM nodes still exist (overflow-hidden). Verify the grid style changed.
      const gridDiv = headerBtn.nextElementSibling as HTMLElement;
      expect(gridDiv.style.gridTemplateRows).toBe("0fr");
    });

    it("toggle group expand/collapse cycles", () => {
      renderSidebar();
      const headerBtn = screen.getByText("文档管理").closest("button")!;
      const gridDiv = headerBtn.nextElementSibling as HTMLElement;

      // Start expanded
      expect(gridDiv.style.gridTemplateRows).toBe("1fr");

      fireEvent.click(headerBtn);
      expect(gridDiv.style.gridTemplateRows).toBe("0fr");

      fireEvent.click(headerBtn);
      expect(gridDiv.style.gridTemplateRows).toBe("1fr");
    });
  });

  describe("mobile prop", () => {
    it("uses 'hidden lg:block' class when mobile is false (default)", () => {
      renderSidebar();
      const aside = document.querySelector("aside")!;
      expect(aside.className).toMatch(/hidden\s+lg:block/);
      // "lg:block" is a Tailwind breakpoint modifier, not a standalone "block" class
      expect(aside.className).not.toMatch(/(?:^|\s)block(?:\s|$)/);
    });

    it("uses 'block' class when mobile is true", () => {
      renderSidebar({ mobile: true });
      const aside = document.querySelector("aside")!;
      // mobile=true → "block" replaces "hidden lg:block"
      expect(aside.className).toMatch(/\bblock\b/);
      expect(aside.className).not.toMatch(/hidden/);
    });
  });

  describe("icons", () => {
    it("renders arrow icons for group headers", () => {
      renderSidebar();
      const headers = screen.getAllByRole("button").filter((btn) =>
        btn.className.includes("w-full flex items-center gap-gm-1.5")
      );
      // Two group headers with expand/collapse arrows
      expect(headers.length).toBeGreaterThanOrEqual(2);
    });
  });
});

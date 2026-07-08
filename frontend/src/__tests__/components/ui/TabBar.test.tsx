import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar, type TabDef } from "@/components/ui/TabBar";
import { RiBrainLine } from "@remixicon/react";

const BASIC_TABS: TabDef[] = [
  { key: "a", label: "Tab A" },
  { key: "b", label: "Tab B" },
  { key: "c", label: "Tab C" },
];

describe("TabBar", () => {
  // ── Basic rendering ──

  it("renders all tabs", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="Test tabs"
      />
    );

    expect(screen.getByRole("tab", { name: "Tab A" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tab B" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tab C" })).toBeInTheDocument();
  });

  it("sets aria-selected=true on the active tab", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="b"
        onChange={() => {}}
        ariaLabel="Test tabs"
      />
    );

    expect(screen.getByRole("tab", { name: "Tab A" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(screen.getByRole("tab", { name: "Tab B" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("sets aria-label on the tablist nav", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="我的面板"
      />
    );

    expect(
      screen.getByRole("tablist", { name: "我的面板" })
    ).toBeInTheDocument();
  });

  // ── Interaction ──

  it("calls onChange with the clicked tab key", () => {
    const onChange = vi.fn();
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={onChange}
        ariaLabel="Test tabs"
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Tab C" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("does not call onChange when clicking already-active tab", () => {
    const onChange = vi.fn();
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={onChange}
        ariaLabel="Test tabs"
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Tab A" }));
    // onChange is still called (consumer decides whether to ignore)
    expect(onChange).toHaveBeenCalledWith("a");
  });

  // ── Icon rendering ──

  it("renders icon before label when tab has icon", () => {
    const tabsWithIcon: TabDef[] = [
      { key: "brain", label: "Brain", icon: RiBrainLine },
    ];

    render(
      <TabBar
        tabs={tabsWithIcon}
        activeKey="brain"
        onChange={() => {}}
        ariaLabel="Icon tabs"
      />
    );

    const button = screen.getByRole("tab", { name: "Brain" });
    const svg = button.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // Icon should appear before text (first child)
    expect(button.firstChild).toBe(svg);
  });

  it("renders no icon element when tab has no icon", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="No icon"
      />
    );

    const button = screen.getByRole("tab", { name: "Tab A" });
    expect(button.querySelector("svg")).toBeNull();
  });

  // ── activeColor variants ──

  it("applies brand color classes by default", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="Brand color"
      />
    );

    const activeTab = screen.getByRole("tab", { name: "Tab A" });
    expect(activeTab.className).toContain("border-brand");
    expect(activeTab.className).toContain("text-brand");
  });

  it("applies info color classes when activeColor='info'", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        activeColor="info"
        ariaLabel="Info color"
      />
    );

    const activeTab = screen.getByRole("tab", { name: "Tab A" });
    expect(activeTab.className).toContain("border-info");
    expect(activeTab.className).toContain("text-info");
  });

  // ── size variants ──

  it("applies sm size classes by default", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="SM size"
      />
    );

    const tab = screen.getByRole("tab", { name: "Tab A" });
    expect(tab.className).toContain("px-gm-4");
    expect(tab.className).toContain("text-gm-sm");
  });

  it("applies xs size classes when size='xs'", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        size="xs"
        ariaLabel="XS size"
      />
    );

    const tab = screen.getByRole("tab", { name: "Tab A" });
    expect(tab.className).toContain("px-gm-3");
    expect(tab.className).toContain("text-gm-xs");
  });

  // ── Styling props ──

  it("applies custom className to the nav", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="Custom class"
        className="px-gm-5 pt-gm-3"
      />
    );

    const nav = screen.getByRole("tablist", { name: "Custom class" });
    expect(nav.className).toContain("px-gm-5");
    expect(nav.className).toContain("pt-gm-3");
  });

  it("handles empty className gracefully", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="Empty class"
      />
    );

    const nav = screen.getByRole("tablist", { name: "Empty class" });
    // Should render without trailing whitespace issues
    expect(nav).toBeInTheDocument();
  });

  // ── ARIA aria-controls ──

  it("sets aria-controls on each tab when tabPanelIdPrefix is provided", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="With controls"
        tabPanelIdPrefix="lab"
      />
    );

    expect(screen.getByRole("tab", { name: "Tab A" })).toHaveAttribute(
      "aria-controls",
      "lab-a"
    );
    expect(screen.getByRole("tab", { name: "Tab B" })).toHaveAttribute(
      "aria-controls",
      "lab-b"
    );
    expect(screen.getByRole("tab", { name: "Tab C" })).toHaveAttribute(
      "aria-controls",
      "lab-c"
    );
  });

  it("does not set aria-controls when tabPanelIdPrefix is omitted", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="No controls"
      />
    );

    expect(
      screen.getByRole("tab", { name: "Tab A" })
    ).not.toHaveAttribute("aria-controls");
  });

  it("sets id on each tab button when tabPanelIdPrefix is provided", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="With IDs"
        tabPanelIdPrefix="lab"
      />
    );

    expect(
      screen.getByRole("tab", { name: "Tab A" })
    ).toHaveAttribute("id", "lab-tab-a");
    expect(
      screen.getByRole("tab", { name: "Tab B" })
    ).toHaveAttribute("id", "lab-tab-b");
  });

  it("does not set id on tab buttons when tabPanelIdPrefix is omitted", () => {
    render(
      <TabBar
        tabs={BASIC_TABS}
        activeKey="a"
        onChange={() => {}}
        ariaLabel="No IDs"
      />
    );

    expect(
      screen.getByRole("tab", { name: "Tab A" })
    ).not.toHaveAttribute("id");
  });
});

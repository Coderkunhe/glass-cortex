import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type { DocListItem, DocContentResponse } from "@/lib/api/types";

// ── Mocks ────────────────────────────────────────────────────────────
// Mock API client
const mockGetDocContent = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getDocContent: (...args: unknown[]) => mockGetDocContent(...args),
    },
  };
});

// Mock PasswordGate — render a test button that simulates auth success
vi.mock("@/components/admin/PasswordGate", () => ({
  default: ({ onSuccess }: { onSuccess: () => void }) => (
    <div data-testid="password-gate">
      <button onClick={onSuccess} data-testid="mock-auth-btn">
        模拟认证
      </button>
    </div>
  ),
}));

// Mock AdminSidebar — render tabs + active state
vi.mock("@/components/admin/AdminSidebar", () => ({
  default: ({
    activeTab,
    mobile,
    onTab,
  }: {
    activeTab: string;
    mobile?: boolean;
    onTab: (tab: string) => void;
  }) => (
    <nav data-testid={mobile ? "admin-sidebar-mobile" : "admin-sidebar"}>
      <button onClick={() => onTab("health")} data-testid="tab-health" data-active={activeTab === "health"}>
        健康
      </button>
      <button onClick={() => onTab("docs")} data-testid="tab-docs" data-active={activeTab === "docs"}>
        文档
      </button>
      <button onClick={() => onTab("daily")} data-testid="tab-daily" data-active={activeTab === "daily"}>
        日报
      </button>
      <button onClick={() => onTab("requirements-log")} data-testid="tab-req-log" data-active={activeTab === "requirements-log"}>
        需求日志
      </button>
    </nav>
  ),
}));

// Mock HealthPanel
vi.mock("@/components/admin/HealthPanel", () => ({
  default: () => <div data-testid="health-panel">HealthPanel</div>,
}));

// Mock DocsPanel
vi.mock("@/components/admin/DocsPanel", () => ({
  default: ({
    onSelectDoc,
    onNavigate,
  }: {
    onSelectDoc: (item: DocListItem) => void;
    onNavigate: (tab: string) => void;
  }) => (
    <div data-testid="docs-panel">
      <button
        onClick={() =>
          onSelectDoc({
            name: "architecture.md",
            path: "docs/architecture.md",
            group: "核心文档",
            size_bytes: 5000,
            mtime: "2026-08-07",
            lines: 100,
          })
        }
        data-testid="select-doc-btn"
      >
        选择文档
      </button>
      <button onClick={() => onNavigate("daily")} data-testid="nav-daily-btn">
        跳转日报
      </button>
    </div>
  ),
}));

// Mock DailyPanel
vi.mock("@/components/admin/DailyPanel", () => ({
  default: ({
    onSelectDoc,
  }: {
    onSelectDoc: (item: DocListItem) => void;
  }) => (
    <div data-testid="daily-panel">
      <button
        onClick={() =>
          onSelectDoc({
            name: "2026-08-07.md",
            path: "docs/daily/2026-08-07.md",
            group: "日报",
            size_bytes: 2048,
            mtime: "2026-08-07",
            lines: 50,
          })
        }
        data-testid="select-daily-btn"
      >
        选择日报
      </button>
    </div>
  ),
}));

// Mock RequirementsLogPanel
vi.mock("@/components/admin/RequirementsLogPanel", () => ({
  default: ({
    onSelectDoc,
  }: {
    onSelectDoc: (item: DocListItem) => void;
  }) => (
    <div data-testid="req-log-panel">
      <button
        onClick={() =>
          onSelectDoc({
            name: "requirements-log.md",
            path: "docs/requirements-log.md",
            group: "需求日志",
            size_bytes: 5678,
            mtime: "2026-08-07",
            lines: 100,
          })
        }
        data-testid="select-req-log-btn"
      >
        选择需求日志
      </button>
    </div>
  ),
}));

// Mock DocViewer
vi.mock("@/components/admin/DocViewer", () => ({
  default: ({
    item,
    onBack,
  }: {
    item: DocListItem;
    loading?: boolean;
    error?: string | null;
    content?: DocContentResponse | null;
    onBack: () => void;
  }) => (
    <div data-testid="doc-viewer">
      <span data-testid="doc-name">{item.name}</span>
      <button onClick={onBack} data-testid="back-btn">
        返回
      </button>
    </div>
  ),
}));

// Mock UI components that AdminShell uses
vi.mock("@/components/ui/ThemeToggle", () => ({
  default: () => <button data-testid="theme-toggle">🌓</button>,
}));

vi.mock("@/components/ui/ScrollLockContext", () => ({
  ScrollLockProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/Drawer", () => ({
  default: ({
    isOpen,
    children,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    onClose: () => void;
    position?: string;
    maxWidth?: number;
    duration?: number;
    ariaLabel?: string;
  }) => (isOpen ? <div data-testid="mobile-drawer">{children}</div> : null),
}));

vi.mock("@/components/ui/ErrorBoundary", () => ({
  default: ({
    children,
  }: {
    children: React.ReactNode;
    fallbackVariant?: string;
  }) => <div data-testid="error-boundary">{children}</div>,
}));

import AdminShell from "@/app/admin/AdminShell";

afterEach(cleanup);

const AUTH_KEY = "gm-admin-authed";

// ── Helpers ─────────────────────────────────────────────────────────

/** Render AdminShell with optional pre-auth via sessionStorage */
function renderShell(authed = false) {
  sessionStorage.clear();
  if (authed) {
    sessionStorage.setItem(AUTH_KEY, "1");
  }
  return render(<AdminShell />);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("AdminShell", () => {
  beforeEach(() => {
    mockGetDocContent.mockReset();
    sessionStorage.clear();
  });

  describe("authentication", () => {
    it("shows PasswordGate when not authed", () => {
      renderShell(false);
      expect(screen.getByTestId("password-gate")).toBeInTheDocument();
    });

    it("shows admin dashboard after auth via PasswordGate onSuccess", async () => {
      renderShell(false);
      // Click the mock auth button to trigger onSuccess → setAuthed(true)
      fireEvent.click(screen.getByTestId("mock-auth-btn"));

      await waitFor(() => {
        // Dashboard should render with TopBar (品牌文字) + Sidebar
        expect(screen.getByText("GlassCortex Admin")).toBeInTheDocument();
      });
    });

    it("renders dashboard directly when sessionStorage already has auth", async () => {
      renderShell(true);

      await waitFor(() => {
        // useEffect reads sessionStorage — state update is async
        expect(screen.getByText("GlassCortex Admin")).toBeInTheDocument();
      });
    });
  });

  describe("top bar", () => {
    it("renders brand name and theme toggle", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByText("GlassCortex Admin")).toBeInTheDocument();
      });
      expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
    });

    it("renders logout button", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByText("退出登录")).toBeInTheDocument();
      });
    });
  });

  describe("tab switching", () => {
    it("shows HealthPanel by default (activeTab='health')", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("health-panel")).toBeInTheDocument();
      });
    });

    it("switches to DocsPanel when docs tab is clicked", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-docs")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("tab-docs"));

      await waitFor(() => {
        expect(screen.getByTestId("docs-panel")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("health-panel")).not.toBeInTheDocument();
    });

    it("switches to DailyPanel when daily tab is clicked", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-daily")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("tab-daily"));

      await waitFor(() => {
        expect(screen.getByTestId("daily-panel")).toBeInTheDocument();
      });
    });

    it("switches to RequirementsLogPanel when req-log tab is clicked", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-req-log")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("tab-req-log"));

      await waitFor(() => {
        expect(screen.getByTestId("req-log-panel")).toBeInTheDocument();
      });
    });
  });

  describe("doc selection flow", () => {
    it("shows DocViewer when a doc is selected from DocsPanel", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-docs")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-docs"));

      await waitFor(() => {
        expect(screen.getByTestId("docs-panel")).toBeInTheDocument();
      });

      // Select a document
      fireEvent.click(screen.getByTestId("select-doc-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();
      });
      expect(screen.getByTestId("doc-name").textContent).toBe("architecture.md");
    });

    it("returns to panel when back is clicked in DocViewer", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-docs")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-docs"));

      await waitFor(() => {
        expect(screen.getByTestId("docs-panel")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("select-doc-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();
      });

      // Go back
      fireEvent.click(screen.getByTestId("back-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("docs-panel")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("doc-viewer")).not.toBeInTheDocument();
    });

    it("shows DocViewer from DailyPanel", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-daily")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-daily"));

      await waitFor(() => {
        expect(screen.getByTestId("daily-panel")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("select-daily-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();
      });
      expect(screen.getByTestId("doc-name").textContent).toBe("2026-08-07.md");
    });

    it("shows DocViewer from RequirementsLogPanel", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-req-log")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-req-log"));

      await waitFor(() => {
        expect(screen.getByTestId("req-log-panel")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("select-req-log-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();
      });
      expect(screen.getByTestId("doc-name").textContent).toBe("requirements-log.md");
    });

    it("clears doc selection when switching tabs", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("tab-daily")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("tab-daily"));

      await waitFor(() => {
        expect(screen.getByTestId("daily-panel")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("select-daily-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("doc-viewer")).toBeInTheDocument();
      });

      // Switch to a different tab — should clear doc selection
      fireEvent.click(screen.getByTestId("tab-health"));

      await waitFor(() => {
        expect(screen.getByTestId("health-panel")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("doc-viewer")).not.toBeInTheDocument();
    });
  });

  describe("logout", () => {
    it("clears sessionStorage and shows PasswordGate on logout", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByText("退出登录")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("退出登录"));

      await waitFor(() => {
        expect(screen.getByTestId("password-gate")).toBeInTheDocument();
      });
      expect(sessionStorage.getItem(AUTH_KEY)).toBeNull();
    });
  });

  describe("mobile sidebar drawer", () => {
    it("opens mobile drawer when hamburger button is clicked", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByLabelText("打开菜单")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText("打开菜单"));

      await waitFor(() => {
        expect(screen.getByTestId("mobile-drawer")).toBeInTheDocument();
      });
      // Mobile sidebar should appear inside the drawer
      expect(screen.getByTestId("admin-sidebar-mobile")).toBeInTheDocument();
    });

    it("closes mobile drawer and switches tab when sidebar tab is clicked", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByLabelText("打开菜单")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText("打开菜单"));

      await waitFor(() => {
        expect(screen.getByTestId("mobile-drawer")).toBeInTheDocument();
      });

      // Scope tab click to mobile sidebar only — desktop sidebar has same testids
      const mobileSidebar = screen.getByTestId("admin-sidebar-mobile");
      const mobileDailyBtn = mobileSidebar.querySelector("[data-testid='tab-daily']")!;
      fireEvent.click(mobileDailyBtn);

      await waitFor(() => {
        // Drawer should close, DailyPanel should appear
        expect(screen.getByTestId("daily-panel")).toBeInTheDocument();
      });
    });
  });

  describe("error boundary", () => {
    it("wraps content area in ErrorBoundary", async () => {
      renderShell(true);
      await waitFor(() => {
        expect(screen.getByTestId("error-boundary")).toBeInTheDocument();
      });
    });
  });
});

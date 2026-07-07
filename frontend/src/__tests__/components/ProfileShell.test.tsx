import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

import ProfileShell from "@/components/profile/ProfileShell";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function buildProfileList(overrides?: Record<string, unknown>) {
  return {
    profiles: [
      {
        name: "default",
        db_size_bytes: 65536,
        has_index: true,
        episode_count: 42,
        fact_count: 87,
        index_vectors: 100,
      },
      {
        name: "dev",
        db_size_bytes: 32768,
        has_index: false,
        episode_count: 5,
        fact_count: 10,
        index_vectors: 0,
      },
    ],
    current: "default",
    ...overrides,
  };
}

function buildCurrentProfile(overrides?: Record<string, unknown>) {
  return {
    name: "default",
    db_size_bytes: 65536,
    has_index: true,
    episode_count: 42,
    fact_count: 87,
    index_vectors: 100,
    ...overrides,
  };
}

function buildTagSummary(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    subject: "user",
    relation: `tag_${i + 1}`,
    max_confidence: 0.5 + i * 0.1,
    fact_count: 3,
    distinct_objects: 2,
  }));
}

function mockAllSuccess(profilesOverrides?: Record<string, unknown>) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildProfileList(profilesOverrides)),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildCurrentProfile()),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildTagSummary()),
    });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(cleanup);

describe("ProfileShell", () => {
  it("renders loading skeleton on mount", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ProfileShell />);
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders profile name and list after successful fetch", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      // "default" appears twice: identity banner (h1) + profile list (p)
      const matches = screen.getAllByText("default");
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText("dev")).toBeDefined();
  });

  it("shows profile stats in identity banner", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      // "42" appears in identity banner stat + profile list row for default
      expect(screen.getAllByText("42").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("87")).toBeDefined();
    expect(screen.getByText("100")).toBeDefined();
    // Labels still present
    expect(screen.getByText("对话片段")).toBeDefined();
    expect(screen.getByText("知识碎片")).toBeDefined();
  });

  it("renders tag cloud with fetched tags", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getByText("tag_1")).toBeDefined();
    });
    expect(screen.getByText("tag_2")).toBeDefined();
  });

  it("tag cloud scales font size by confidence", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getByText("tag_1")).toBeDefined();
    });

    const lowTag = screen.getByText("tag_1");
    const highTag = screen.getByText("tag_5");
    expect(lowTag.className).not.toBe(highTag.className);

    const sizeIdx = (el: Element) => {
      const sizes = [
        "text-gm-sm",
        "text-gm-md",
        "text-gm-base",
        "text-gm-lg",
        "text-gm-xl",
        "text-gm-2xl",
        "text-gm-3xl",
      ];
      return sizes.findIndex((s) => el.className.includes(s));
    };
    expect(sizeIdx(highTag)).toBeGreaterThan(sizeIdx(lowTag));
  });

  it("shows create profile button and opens modal on click", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getAllByText("default").length).toBeGreaterThanOrEqual(2);
    });

    // The [+ 新建] button is visible in right column header
    const createBtn = screen.getByText("新建");
    expect(createBtn).toBeDefined();

    // Click opens the modal
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/输入 profile 名称/i)).toBeDefined();
    });
  });

  it("creates a new profile via modal and refreshes list", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getAllByText("default").length).toBeGreaterThanOrEqual(2);
    });

    // Open modal
    fireEvent.click(screen.getByText("新建"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/输入 profile 名称/i)).toBeDefined();
    });

    // Set up mock for create + refresh
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          name: "new-profile",
          db_size_bytes: 0,
          has_index: false,
          episode_count: 0,
          fact_count: 0,
          index_vectors: 0,
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          profiles: [
            { name: "default", db_size_bytes: 65536, has_index: true, episode_count: 42, fact_count: 87, index_vectors: 100 },
            { name: "dev", db_size_bytes: 32768, has_index: false, episode_count: 5, fact_count: 10, index_vectors: 0 },
            { name: "new-profile", db_size_bytes: 0, has_index: false, episode_count: 0, fact_count: 0, index_vectors: 0 },
          ],
          current: "default",
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildCurrentProfile()),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildTagSummary()),
    });

    // Type name in modal input
    const modalInput = screen.getByPlaceholderText(/输入 profile 名称/i);
    fireEvent.change(modalInput, { target: { value: "new-profile" } });

    // Click "创建" button in modal footer
    fireEvent.click(screen.getByText("创建"));

    await waitFor(() => {
      expect(screen.getByText("new-profile")).toBeDefined();
    });
  });

  it("shows ErrorDisplay with retry button on API failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    render(<ProfileShell />);

    await waitFor(() => {
      // ErrorDisplay card renders a retry button; use role to disambiguate
      // from userMessage text that may also contain "重试"
      expect(
        screen.getByRole("button", { name: /重试/ }),
      ).toBeInTheDocument();
    });
  });

  it("opens ConfirmModal on delete click and completes delete on confirm", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getByText("dev")).toBeDefined();
    });

    // Click delete button for "dev" profile
    // B106 自检补漏 — title 已替换为即时 tooltip，改用 aria-label 选择器
    const deleteBtn = screen.getByRole("button", { name: "删除 dev" });
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn);

    // ConfirmModal should appear
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeDefined();
    });
    expect(screen.getByText("删除 Profile")).toBeDefined();
    expect(screen.getByText(/确定要删除 profile "dev" 吗/)).toBeDefined();

    // Set up mocks for delete API + refresh
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(null) });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          profiles: [
            { name: "default", db_size_bytes: 65536, has_index: true, episode_count: 42, fact_count: 87, index_vectors: 100 },
          ],
          current: "default",
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildCurrentProfile()),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildTagSummary()),
    });

    // Click confirm button in modal
    fireEvent.click(screen.getByText("确认删除"));

    // After successful delete, modal should close and list refresh
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    // "dev" should no longer be in the list
    await waitFor(() => {
      expect(screen.queryByTitle("删除 dev")).toBeNull();
    });
  });

  it("tag cloud items have cursor-pointer and are clickable", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getByText("tag_1")).toBeDefined();
    });

    const tag = screen.getByText("tag_1");
    expect(tag.className).toContain("cursor-pointer");
    expect(tag.className).not.toContain("cursor-default");
  });

  it("clicking a tag opens TagDetailModal and triggers tag-detail API call", async () => {
    mockAllSuccess();
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getByText("tag_1")).toBeDefined();
    });

    // 预加载第 4 个 mock（tag-detail 响应）
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          subject: "user",
          relation: "tag_1",
          max_confidence: 0.5,
          fact_count: 1,
          distinct_objects: 1,
          facts: [
            {
              id: 1,
              content: "测试事实",
              confidence: 0.5,
              object: null,
              source_episode_id: null,
              episode_content: null,
              episode_timestamp: null,
              created_at: 1719000000,
              updated_at: null,
              confidence_log: [],
            },
          ],
        }),
    });

    const tag = screen.getByText("tag_1");
    fireEvent.click(tag);

    // 验证 tag-detail API 被调用，URL 参数正确
    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const tagDetailCall = calls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("/memory/tag-detail"),
      );
      expect(tagDetailCall).toBeDefined();
      const url = tagDetailCall![0] as string;
      expect(url).toContain("subject=user");
      expect(url).toContain("relation=tag_1");
    });

    // Modal 加载完成后应显示内容
    await waitFor(() => {
      expect(screen.getByText("测试事实")).toBeDefined();
    });
  });

  it("shows empty tag cloud state when no tags", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildProfileList()),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildCurrentProfile()),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
    render(<ProfileShell />);

    await waitFor(() => {
      expect(screen.getByText(/AI 还在了解你/)).toBeDefined();
    });
  });
});

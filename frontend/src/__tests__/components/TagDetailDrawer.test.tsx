import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

import TagDetailDrawer from "@/components/profile/TagDetailDrawer";
import type { TagDetailResponse } from "@/lib/api/types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** 构造一个完整的 TagDetailResponse — 默认 3 条事实，含置信度日志 + 来源对话。 */
function buildTagDetailResponse(
  overrides?: Partial<TagDetailResponse>,
): TagDetailResponse {
  return {
    subject: "user",
    relation: "likes",
    max_confidence: 0.95,
    fact_count: 3,
    distinct_objects: 2,
    facts: [
      {
        id: 1,
        content: "用户喜欢 TypeScript",
        confidence: 0.95,
        object: "TypeScript",
        source_episode_id: 10,
        episode_content: "今天我决定用 TypeScript 重写整个前端",
        episode_timestamp: 1719000000,
        created_at: 1719000000,
        updated_at: null,
        confidence_log: [
          {
            fact_id: 1,
            confidence_before: 0.5,
            confidence_after: 0.8,
            reason: "episode 强化",
            logged_at: 1719000000,
          },
          {
            fact_id: 1,
            confidence_before: 0.8,
            confidence_after: 0.95,
            reason: "episode 强化",
            logged_at: 1719100000,
          },
        ],
      },
      {
        id: 2,
        content: "用户喜欢 Python",
        confidence: 0.6,
        object: "Python",
        source_episode_id: 11,
        episode_content: "不过 Python 依然是数据处理的利器",
        episode_timestamp: 1718900000,
        created_at: 1718900000,
        updated_at: null,
        confidence_log: [
          {
            fact_id: 2,
            confidence_before: 0.7,
            confidence_after: 0.6,
            reason: "衰减",
            logged_at: 1718950000,
          },
        ],
      },
      {
        id: 3,
        content: "用户喜欢 Rust",
        confidence: 0.35,
        object: "Rust",
        source_episode_id: null,
        episode_content: null,
        episode_timestamp: null,
        created_at: 1718800000,
        updated_at: null,
        confidence_log: [],
      },
    ],
    ...overrides,
  };
}

/** 构造最小的成功数据 — 1 条事实无日志无来源。 */
function buildMinimalDetail(): TagDetailResponse {
  return {
    subject: "user",
    relation: "single",
    max_confidence: 0.5,
    fact_count: 1,
    distinct_objects: 1,
    facts: [
      {
        id: 99,
        content: "一条简单事实",
        confidence: 0.5,
        object: null,
        source_episode_id: null,
        episode_content: null,
        episode_timestamp: null,
        created_at: 1718800000,
        updated_at: null,
        confidence_log: [],
      },
    ],
  };
}

/** 模拟成功 API 响应。 */
function mockSuccess(data?: TagDetailResponse) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data ?? buildTagDetailResponse()),
  });
}

/** 模拟 pending promise（用于 loading 态测试）。 */
function mockPending() {
  mockFetch.mockReturnValue(new Promise(() => {}));
}

/** 模拟 API 失败。 */
function mockError() {
  mockFetch.mockRejectedValueOnce(new Error("Network error"));
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(cleanup);

/** 渲染 TagDetailDrawer 的默认 props。 */
function renderOpen(overrides?: Partial<TagDetailResponse>) {
  mockSuccess(overrides ? buildTagDetailResponse(overrides) : undefined);
  return render(
    <TagDetailDrawer
      isOpen={true}
      onClose={vi.fn()}
      subject="user"
      relation="likes"
    />,
  );
}

describe("TagDetailDrawer", () => {
  // ── 基础渲染 ──

  it("does not render when isOpen=false", () => {
    const { container } = render(
      <TagDetailDrawer
        isOpen={false}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows loading spinner while fetching", async () => {
    mockPending();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );
    // fetchDetail is deferred via setTimeout(0); flush timer
    await waitFor(() => {
      expect(screen.getByText("加载标签详情中…")).toBeDefined();
    });
  });

  // ── Error 态 ──

  it("shows error message + retry button on API failure", async () => {
    mockError();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/重试/i)).toBeDefined();
    });
  });

  it("retry button re-fetches and shows data on success", async () => {
    mockError();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/重试/i)).toBeDefined();
    });

    // 点击重试 → 成功
    mockSuccess();
    fireEvent.click(screen.getByText("重试"));

    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });
  });

  // ── Empty 态 ──

  it("shows empty state when response has zero facts", async () => {
    mockSuccess({
      subject: "user",
      relation: "empty_tag",
      max_confidence: 0,
      fact_count: 0,
      distinct_objects: 0,
      facts: [],
    });
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="empty_tag"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("该标签暂无关联事实")).toBeDefined();
    });
  });

  // ── Data 态 — Header ──

  it("renders relation name and confidence badge in header", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });
    // 95% 同时出现在 header badge 和 fact badge 中
    const badges = screen.getAllByText("95%");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("renders sub-header stats: subject, fact count, distinct objects", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("user")).toBeDefined();
    });
    // fact_count + distinct_objects
    expect(screen.getByText("3 条事实")).toBeDefined();
    expect(screen.getByText("2 个关联对象")).toBeDefined();
  });

  // ── Data 态 — Fact 内容 ──

  it("renders all fact contents", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });
    expect(screen.getByText("用户喜欢 Python")).toBeDefined();
    expect(screen.getByText("用户喜欢 Rust")).toBeDefined();
  });

  it("renders confidence badges with correct color classes", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // High confidence (0.95) → success (header + fact 1 both have 95%)
    const highBadges = screen.getAllByText("95%");
    for (const badge of highBadges) {
      expect(badge.className).toContain("text-success");
    }

    // Medium confidence (0.6) → warning
    const midBadge = screen.getByText("60%");
    expect(midBadge.className).toContain("text-warning");

    // Low confidence (0.35) → muted
    const lowBadge = screen.getByText("35%");
    expect(lowBadge.className).toContain("text-text-muted");
  });

  it("renders objects for each fact, null → placeholder", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("TypeScript")).toBeDefined();
    });
    expect(screen.getByText("Python")).toBeDefined();
    expect(screen.getByText("Rust")).toBeDefined();
  });

  // ── 来源对话 可折叠 ──

  it("source episode section is collapsed by default", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // 来源对话内容默认不可见
    expect(
      screen.queryByText("今天我决定用 TypeScript 重写整个前端"),
    ).toBeNull();
  });

  it("clicking source episode toggle expands episode content", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // 点击第一个 "来源对话" 按钮
    const episodeToggles = screen.getAllByText("来源对话");
    fireEvent.click(episodeToggles[0]);

    await waitFor(() => {
      expect(
        screen.getByText("今天我决定用 TypeScript 重写整个前端"),
      ).toBeDefined();
    });
  });

  it("clicking source episode toggle again collapses it", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    const episodeToggles = screen.getAllByText("来源对话");
    fireEvent.click(episodeToggles[0]);

    await waitFor(() => {
      expect(
        screen.getByText("今天我决定用 TypeScript 重写整个前端"),
      ).toBeDefined();
    });

    fireEvent.click(episodeToggles[0]);

    await waitFor(() => {
      expect(
        screen.queryByText("今天我决定用 TypeScript 重写整个前端"),
      ).toBeNull();
    });
  });

  it("shows fallback text for null episode_content", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Rust")).toBeDefined();
    });

    // Rust fact 的 episode_content 是 null, 展开它
    const episodeToggles = screen.getAllByText("来源对话");
    fireEvent.click(episodeToggles[2]); // 第 3 个 fact 的 toggle

    await waitFor(() => {
      expect(screen.getByText("无来源对话记录")).toBeDefined();
    });
  });

  // ── 置信度变更日志 可折叠 ──

  it("confidence log section is collapsed by default", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // 日志内容默认不可见
    expect(screen.queryByText("episode 强化")).toBeNull();
  });

  it("clicking confidence log toggle expands log entries", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // 点击置信度变更日志
    const logToggles = screen.getAllByText(/置信度变更日志/);
    fireEvent.click(logToggles[0]);

    await waitFor(() => {
      // 应该出现两次 "episode 强化"（两条日志）
      const reasons = screen.getAllByText(/episode 强化/);
      expect(reasons.length).toBe(2);
    });
  });

  it("shows (N) count in confidence log header", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    expect(screen.getByText("置信度变更日志 (2)")).toBeDefined();
    expect(screen.getByText("置信度变更日志 (1)")).toBeDefined();
    expect(screen.getByText("置信度变更日志 (0)")).toBeDefined();
  });

  it("renders confidence log direction coloring", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // 展开日志
    const logToggles = screen.getAllByText(/置信度变更日志/);
    // Fact 1: 2 increases
    fireEvent.click(logToggles[0]);

    await waitFor(() => {
      const reasons = screen.getAllByText(/episode 强化/);
      expect(reasons.length).toBe(2);
    });

    // 验证 ↑ 箭头存在（increase）
    const upArrows = screen.getAllByText("↑");
    expect(upArrows.length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty log message when confidence_log is empty", async () => {
    renderOpen();
    await waitFor(() => {
      expect(screen.getByText("用户喜欢 Rust")).toBeDefined();
    });

    // Rust fact 的 log 为空 — 展开它
    const logToggles = screen.getAllByText(/置信度变更日志/);
    fireEvent.click(logToggles[2]); // 第 3 个 fact

    await waitFor(() => {
      expect(screen.getByText("暂无变更记录")).toBeDefined();
    });
  });

  // ── Null 数据边界 ──

  it("renders fact with null object as placeholder", async () => {
    mockSuccess(buildMinimalDetail());
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="single"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("一条简单事实")).toBeDefined();
    });
    // null object → "—"
    expect(screen.getByText("—")).toBeDefined();
  });

  // ── 关闭行为 ──

  it("clicking close button calls onClose", async () => {
    const onClose = vi.fn();
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={onClose}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });

    // Phase 66 B105 — title 已替换为即时 tooltip，改用 aria-label 选择器
    const closeBtn = screen.getByRole("button", { name: "关闭" });
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking overlay backdrop calls onClose", async () => {
    const onClose = vi.fn();
    mockSuccess();
    const { container } = render(
      <TagDetailDrawer
        isOpen={true}
        onClose={onClose}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });

    // 遮罩层: 由共享 Drawer 组件渲染，z-index 通过 CSS 变量控制
    const backdrop = container.querySelector('[class*="fixed"][class*="inset-0"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape key calls onClose", async () => {
    const onClose = vi.fn();
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={onClose}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on non-Escape key press", async () => {
    const onClose = vi.fn();
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={onClose}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Re-open 重置状态 ──

  it("resets state when isOpen toggles", async () => {
    // Keep fetch pending so loading state is visible
    mockPending();
    const { rerender } = render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    // fetchDetail is deferred via setTimeout(0); wait for loading state
    await waitFor(() => {
      expect(screen.getByText("加载标签详情中…")).toBeDefined();
    });

    // 关闭
    rerender(
      <TagDetailDrawer
        isOpen={false}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    // 重新打开 — 应该重新触发加载
    mockPending();
    rerender(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="different"
      />,
    );

    expect(screen.getByText("加载标签详情中…")).toBeDefined();
  });

  // ── 纠正 + 加星按钮 ──

  it("renders correct and star buttons on each fact", async () => {
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // 每个事实应有两个按钮（纠正 + 加星）
    const correctBtns = screen.getAllByTitle("纠正 — AI 识别有误");
    const starBtns = screen.getAllByTitle("加星 — AI 识别准确");
    expect(correctBtns.length).toBe(3);
    expect(starBtns.length).toBe(3);
  });

  it("correct button calls API with delta=-0.3 and reason=user_correction", async () => {
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // Mock 纠正 API + refetch
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fact_id: 1,
            confidence_before: 0.95,
            confidence_after: 0.65,
            reason: "user_correction",
            logged_at: 1719200000,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildTagDetailResponse()),
      });

    const correctBtns = screen.getAllByTitle("纠正 — AI 识别有误");
    fireEvent.click(correctBtns[0]);

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const postCall = calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("/memory/facts/") &&
          c[0].includes("/confidence"),
      );
      expect(postCall).toBeDefined();
      const url = postCall![0] as string;
      expect(url).toContain("/memory/facts/1/confidence");
      // 请求体应包含 delta=-0.3, reason=user_correction
      const body = JSON.parse(postCall![1]?.body as string);
      expect(body.delta).toBe(-0.3);
      expect(body.reason).toBe("user_correction");
    });
  });

  it("star button calls API with delta=+0.2 and reason=user_star", async () => {
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fact_id: 1,
            confidence_before: 0.95,
            confidence_after: 1.0,
            reason: "user_star",
            logged_at: 1719200000,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildTagDetailResponse()),
      });

    const starBtns = screen.getAllByTitle("加星 — AI 识别准确");
    fireEvent.click(starBtns[0]);

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const postCall = calls.find(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("/memory/facts/") &&
          c[0].includes("/confidence"),
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]?.body as string);
      expect(body.delta).toBe(0.2);
      expect(body.reason).toBe("user_star");
    });
  });

  it("shows spinner while mutating", async () => {
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // 挂起 API 调用使 mutating 态持续
    mockFetch.mockReset();
    mockFetch.mockReturnValue(new Promise(() => {}));

    const correctBtns = screen.getAllByTitle("纠正 — AI 识别有误");
    fireEvent.click(correctBtns[0]);

    // 按钮应消失，取而代之的是 spinner
    await waitFor(() => {
      const spinners = document.querySelectorAll(".animate-spin");
      expect(spinners.length).toBeGreaterThan(0);
    });
  });

  it("mutation error shows inline error text", async () => {
    mockSuccess();
    render(
      <TagDetailDrawer
        isOpen={true}
        onClose={vi.fn()}
        subject="user"
        relation="likes"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("用户喜欢 TypeScript")).toBeDefined();
    });

    // Mock API 失败
    mockFetch.mockReset();
    mockFetch.mockRejectedValueOnce(new Error("纠正失败"));

    const correctBtns = screen.getAllByTitle("纠正 — AI 识别有误");
    fireEvent.click(correctBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("纠正失败")).toBeDefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import ProfileCard from "@/components/shared/ProfileCard";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function buildProfilesResponse(overrides?: Record<string, unknown>) {
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
    ],
    current: "default",
    ...overrides,
  };
}

function buildTagSummary(overrides?: Array<Record<string, unknown>>) {
  return overrides ?? [
    { subject: "user", relation: "likes", max_confidence: 0.95, fact_count: 5, distinct_objects: 3 },
    { subject: "user", relation: "works_with", max_confidence: 0.60, fact_count: 3, distinct_objects: 2 },
    { subject: "user", relation: "mentioned", max_confidence: 0.30, fact_count: 2, distinct_objects: 2 },
  ];
}

function mockOkResponses(profilesOverrides?: Record<string, unknown>, tagsOverrides?: Array<Record<string, unknown>>) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildProfilesResponse(profilesOverrides)),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildTagSummary(tagsOverrides)),
    });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(cleanup);

describe("ProfileCard", () => {
  it("renders loading skeleton initially", () => {
    // Don't resolve fetch — stays in loading state
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ProfileCard />);
    const skeleton = container.querySelector(".animate-pulse");
    expect(skeleton).toBeDefined();
  });

  it("renders avatar and name on successful load with tags", async () => {
    mockOkResponses();
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("default")).toBeDefined();
    });
    expect(screen.getByText("Profile")).toBeDefined();
    expect(screen.getByText("D")).toBeDefined(); // initial
  });

  it("renders tag pills with correct variants", async () => {
    mockOkResponses();
    render(<ProfileCard />);

    // High confidence tag
    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });
    expect(screen.getByText("works_with")).toBeDefined();
    expect(screen.getByText("mentioned")).toBeDefined();
  });

  it("shows overflow count when more than 5 tags", async () => {
    const manyTags = Array.from({ length: 8 }, (_, i) => ({
      subject: "user",
      relation: `tag_${i}`,
      max_confidence: 0.5,
      fact_count: 1,
      distinct_objects: 1,
    }));
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildProfilesResponse()),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(manyTags),
      });
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("+3")).toBeDefined();
    });
  });

  it("shows empty state when no tags", async () => {
    mockOkResponses(undefined, []);
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("AI 还在了解你…")).toBeDefined();
    });
  });

  it("renders link to profile page", async () => {
    mockOkResponses();
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("完整画像 →")).toBeDefined();
    });
  });

  it("shows fallback card on API error without crashing", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    render(<ProfileCard />);

    // Should still render avatar for "default" even in error state
    await waitFor(() => {
      expect(screen.getByText("D")).toBeDefined();
    });
    expect(screen.getByText("default")).toBeDefined();
    // No tags, no loading skeleton
    expect(screen.queryByText("AI 还在了解你…")).toBeNull();
    expect(screen.queryByText("完整画像 →")).toBeNull();
  });

  // ── 标签置信度颜色 ──

  it("renders high-confidence tag with success color classes", async () => {
    mockOkResponses();
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("likes")).toBeDefined();
    });
    // likes has confidence 0.95 → "high" variant → success/15 border-success/20
    const likesPill = screen.getByText("likes");
    expect(likesPill.className).toContain("bg-success/15");
    expect(likesPill.className).toContain("text-success");
  });

  it("renders low-confidence tag with muted color classes", async () => {
    mockOkResponses();
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("mentioned")).toBeDefined();
    });
    // mentioned has confidence 0.30 → "low" variant → text-text-muted bg-surface-lowered
    const lowPill = screen.getByText("mentioned");
    expect(lowPill.className).toContain("text-text-muted");
    expect(lowPill.className).toContain("bg-surface-lowered");
  });

  // ── Link href 正确 ──

  it("profile link points to /profile", async () => {
    mockOkResponses();
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("完整画像 →")).toBeDefined();
    });
    const link = screen.getByText("完整画像 →").closest("a");
    expect(link).toBeInTheDocument();
    expect(link!.getAttribute("href")).toBe("/profile");
  });

  // ── 错误态无 Link ──

  it("error state does not render profile link", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    render(<ProfileCard />);

    await waitFor(() => {
      expect(screen.getByText("D")).toBeDefined();
    });
    // 错误态不应有 link 或 "完整画像" 文案
    expect(screen.queryByText("完整画像 →")).toBeNull();
  });
});

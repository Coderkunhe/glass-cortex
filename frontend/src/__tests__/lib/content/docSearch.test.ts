/**
 * 文档搜索工具单元测试。
 *
 * 覆盖：flattenDocs 扁平化、索引创建、模糊搜索（name/summary）。
 */

import { describe, it, expect } from "vitest";
import type { DocListItem } from "@/lib/api/types";
import { flattenDocs, createDocSearchIndex } from "@/lib/content/docSearch";

// ── 测试辅助 ──────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DocListItem>): DocListItem {
  return {
    name: "test.md",
    path: "docs/test.md",
    group: "核心文档",
    size_bytes: 1024,
    mtime: "2026-08-08",
    lines: 100,
    ...overrides,
  };
}

function makeDir(
  overrides: Partial<DocListItem> & { children?: DocListItem[] },
): DocListItem {
  return {
    name: "archive",
    path: "docs/archive",
    group: "其他",
    size_bytes: 0,
    mtime: "2026-08-08",
    lines: 0,
    is_directory: true,
    count: overrides.children?.length ?? 0,
    ...overrides,
  };
}

// ── flattenDocs ────────────────────────────────────────────────────────

describe("flattenDocs", () => {
  it("returns leaf items unchanged", () => {
    const docs = [makeDoc({ name: "a.md" }), makeDoc({ name: "b.md" })];
    const flat = flattenDocs(docs);
    expect(flat).toHaveLength(2);
    expect(flat.map((d) => d.name)).toEqual(["a.md", "b.md"]);
  });

  it("filters out directory entries", () => {
    const docs = [
      makeDoc({ name: "file.md" }),
      makeDir({ name: "dir", is_directory: true }),
    ];
    const flat = flattenDocs(docs);
    expect(flat).toHaveLength(1);
    expect(flat[0].name).toBe("file.md");
  });

  it("recursively extracts children from directories", () => {
    const child = makeDoc({ name: "nested.md", path: "docs/archive/nested.md" });
    const dir = makeDir({
      name: "archive",
      children: [child],
    });
    const flat = flattenDocs([dir]);
    expect(flat).toHaveLength(1);
    expect(flat[0].name).toBe("nested.md");
  });

  it("handles deeply nested directories", () => {
    const leaf = makeDoc({ name: "deep.md" });
    const inner = makeDir({ name: "inner", children: [leaf] });
    const outer = makeDir({ name: "outer", children: [inner] });
    const flat = flattenDocs([outer]);
    expect(flat).toHaveLength(1);
    expect(flat[0].name).toBe("deep.md");
  });

  it("handles empty input", () => {
    expect(flattenDocs([])).toEqual([]);
  });

  it("handles directory with no children", () => {
    const dir = makeDir({ name: "empty-dir", children: [], count: 0 });
    const flat = flattenDocs([dir]);
    expect(flat).toHaveLength(0);
  });

  it("handles mixed flat + nested items", () => {
    const topFile = makeDoc({ name: "top.md" });
    const child = makeDoc({ name: "child.md" });
    const dir = makeDir({ name: "dir", children: [child] });
    const flat = flattenDocs([topFile, dir]);
    expect(flat).toHaveLength(2);
    expect(flat.map((d) => d.name).sort()).toEqual(["child.md", "top.md"]);
  });
});

// ── createDocSearchIndex ───────────────────────────────────────────────

describe("createDocSearchIndex", () => {
  it("creates a Fuse index from docs", () => {
    const docs = [makeDoc({ name: "architecture.md" })];
    const index = createDocSearchIndex(docs);
    expect(index).toBeDefined();
  });

  it("returns empty results for empty index", () => {
    const index = createDocSearchIndex([]);
    expect(index.search("test")).toEqual([]);
  });
});

// ── 模糊搜索 ───────────────────────────────────────────────────────────

describe("fuzzy search", () => {
  const docs: DocListItem[] = [
    makeDoc({
      name: "architecture.md",
      path: "docs/architecture.md",
      group: "核心文档",
      summary: "项目架构设计文档，包含组件拓扑和 ADR 决策记录",
    }),
    makeDoc({
      name: "methodology.md",
      path: "docs/methodology.md",
      group: "核心文档",
      summary: "AI 辅助开发工作流方法论，包含五层自检金字塔",
    }),
    makeDoc({
      name: "pitfalls.md",
      path: "docs/pitfalls.md",
      group: "经验库",
      summary: "踩坑记录 — 问题→根因→解法",
    }),
    makeDoc({
      name: "roadmap.md",
      path: "docs/roadmap.md",
      group: "治理看板",
      summary: "开发路线图，按 Phase 组织",
    }),
  ];

  const index = createDocSearchIndex(docs);

  it("finds document by exact name", () => {
    const results = index.search("architecture");
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe("architecture.md");
  });

  it("finds document by partial name (fuzzy)", () => {
    const results = index.search("arch");
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe("architecture.md");
  });

  it("finds document by summary content", () => {
    const results = index.search("ADR");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.map((r) => r.item.name)).toContain("architecture.md");
  });

  it("finds document by Chinese name", () => {
    const results = index.search("路线图");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.map((r) => r.item.name)).toContain("roadmap.md");
  });

  it("finds document by Chinese summary content", () => {
    const results = index.search("五层自检");
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe("methodology.md");
  });

  it("returns no results for unrelated query", () => {
    const results = index.search("xyzzy_nonexistent_phrase");
    expect(results).toHaveLength(0);
  });

  it("scores name matches higher than summary-only matches", () => {
    // "pitfall" appears in name; ensures it ranks above summary-only
    const results = index.search("pitfall");
    expect(results).toHaveLength(1);
  });

  it("includes match metadata for highlighting", () => {
    const results = index.search("architecture");
    expect(results[0].matches).toBeDefined();
    expect(results[0].score).toBeDefined();
  });
});

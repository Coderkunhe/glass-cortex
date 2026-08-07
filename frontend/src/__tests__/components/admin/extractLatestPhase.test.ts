import { describe, it, expect } from "vitest";
import { extractLatestPhase } from "@/components/admin/RequirementsLogPanel";

describe("extractLatestPhase", () => {
  // ── 正常场景 ──────────────────────────────────────────────────────

  it("extracts Phase number from ### heading with Phase keyword", () => {
    const content = `# 需求日志

### 2026-08-07 — Phase 68 Batch 5 — Admin 面板打磨 ✅

- 需求内容...

### 2026-08-06 — Phase 67 Batch 10 — UI 优化 ✅

- 更早的需求...
`;
    expect(extractLatestPhase(content)).toBe(68);
  });

  it("extracts Phase from first ### heading (newest first)", () => {
    const content = `### 2026-08-01 — Phase 72 Batch 3 — 新功能 ✅
### 2026-07-30 — Phase 68 Batch 2 — 旧功能 ✅
`;
    // First match is Phase 72
    expect(extractLatestPhase(content)).toBe(72);
  });

  it("returns correct Phase for large numbers", () => {
    expect(extractLatestPhase("### 2026-08-08 — Phase 1001 Batch 5 — 测试")).toBe(1001);
  });

  // ── Phase 1000 治理段排除 ───────────────────────────────────────

  it("returns null when Phase is 1000 (governance exclusion)", () => {
    const content = `### 2026-08-07 — Phase 1000 Batch 137 — I-151 Admin 移动端 hamburger ✅
### 2026-08-05 — Phase 68 Batch 5 — Admin 面板打磨 ✅
`;
    expect(extractLatestPhase(content)).toBeNull();
  });

  it("returns Phase 68 when first entry is Phase 1000 and second is Phase 68", () => {
    // Phase 1000 is excluded, so the caller will iterate;
    // extractLatestPhase itself returns null for Phase 1000.
    const content = `### 2026-08-07 — Phase 1000 Batch 137 — 治理 ✅
### 2026-08-05 — Phase 68 Batch 5 — 功能 ✅
`;
    expect(extractLatestPhase(content)).toBeNull();
    // Caller is responsible for iterating to the next ### match
  });

  // ── 正则锚定 — 必须以 ### 开头 ──────────────────────────────────

  it("ignores Phase references that aren't ### headings (e.g., body text)", () => {
    const content = `# 需求日志

参考 Phase 1000 Batch 135 的修复结果，进行了本次调整。

### 2026-08-05 — Phase 68 Batch 5 — Admin 面板打磨 ✅
`;
    // The first ### heading is Phase 68, not the Phase 1000 in body text
    expect(extractLatestPhase(content)).toBe(68);
  });

  it("only matches ### at start of line (^ anchor)", () => {
    const content = `归档表中包含 Phase 1000 引用
    ### 这不是行首的 ### 不会被匹配
### 2026-08-05 — Phase 68 Batch 5 — 行首有效 ✅
`;
    expect(extractLatestPhase(content)).toBe(68);
  });

  // ── null / 空 / 异常输入 ─────────────────────────────────────────

  it("returns null when no ### heading exists", () => {
    expect(extractLatestPhase("只是一些文字，没有任何标题")).toBeNull();
  });

  it("returns null when ### heading has no Phase keyword", () => {
    expect(extractLatestPhase("### 2026-08-07 — 工作总结")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractLatestPhase("")).toBeNull();
  });

  it("handles content with only Phase 1000 entries", () => {
    const content = `### 2026-08-08 — Phase 1000 Batch 138 — 测试补全 ✅
### 2026-08-07 — Phase 1000 Batch 137 — hamburger ✅
`;
    expect(extractLatestPhase(content)).toBeNull();
  });

  // ── 边缘场景 ─────────────────────────────────────────────────────

  it("handles Phase number at end of line with no trailing content", () => {
    expect(extractLatestPhase("### Phase 42")).toBe(42);
  });

  it("handles very long content with Phase deep in the file", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    lines.push("### 2026-07-01 — Phase 55 Batch 1 — 某需求 ✅");
    expect(extractLatestPhase(lines.join("\n"))).toBe(55);
  });
});

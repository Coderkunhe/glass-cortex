/**
 * flowcharts.ts 数据验证测试。
 *
 * 确保三张流程图定义的完整性和正确性——每个条目必填字段齐全、
 * id 唯一、Mermaid 语法头合规、分组查询函数正确。
 */
import { describe, it, expect } from "vitest";
import {
  FLOWCHARTS,
  getFlowchart,
  getFlowchartsGrouped,
  FLOWCHART_CATEGORY_LABELS,
} from "@/lib/flowcharts";

describe("FLOWCHARTS", () => {
  it("contains exactly 3 flowcharts", () => {
    expect(Object.keys(FLOWCHARTS)).toHaveLength(3);
  });

  it("every flowchart has all required fields non-empty", () => {
    for (const fc of Object.values(FLOWCHARTS)) {
      expect(fc.id).toBeTruthy();
      expect(fc.title).toBeTruthy();
      expect(fc.description).toBeTruthy();
      expect(fc.category).toBeTruthy();
      expect(fc.chart).toBeTruthy();
      expect(fc.defaultHeight).toBeGreaterThan(0);
    }
  });

  it("every chart string starts with valid Mermaid graph syntax", () => {
    for (const fc of Object.values(FLOWCHARTS)) {
      const trimmed = fc.chart.trimStart();
      expect(
        trimmed.startsWith("graph LR") ||
          trimmed.startsWith("graph TD") ||
          trimmed.startsWith("flowchart"),
      ).toBe(true);
    }
  });

  it("all IDs are unique", () => {
    const ids = Object.values(FLOWCHARTS).map((fc) => fc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each flowchart id matches its record key", () => {
    for (const [key, fc] of Object.entries(FLOWCHARTS)) {
      expect(fc.id).toBe(key);
    }
  });

  it("categories are valid FlowchartCategory values", () => {
    const validCategories = Object.keys(FLOWCHART_CATEGORY_LABELS);
    for (const fc of Object.values(FLOWCHARTS)) {
      expect(validCategories).toContain(fc.category);
    }
  });
});

describe("getFlowchart", () => {
  it("returns correct flowchart by id", () => {
    const fc = getFlowchart("memory-pipeline");
    expect(fc).toBeDefined();
    expect(fc!.title).toBe("端到端记忆管线");
    expect(fc!.category).toBe("记忆管线");
  });

  it("returns undefined for unknown id", () => {
    expect(getFlowchart("nonexistent")).toBeUndefined();
  });
});

describe("getFlowchartsGrouped", () => {
  it("returns all 3 categories as keys", () => {
    const grouped = getFlowchartsGrouped();
    expect(Object.keys(grouped)).toHaveLength(3);
    expect(grouped).toHaveProperty("记忆管线");
    expect(grouped).toHaveProperty("上下文工程");
    expect(grouped).toHaveProperty("记忆科学");
  });

  it("each category has exactly 1 chart", () => {
    const grouped = getFlowchartsGrouped();
    for (const charts of Object.values(grouped)) {
      expect(charts).toHaveLength(1);
    }
  });

  it("returns deep copies of FlowchartDef objects", () => {
    const grouped1 = getFlowchartsGrouped();
    const grouped2 = getFlowchartsGrouped();
    // Mutating one should not affect the other
    grouped1["记忆管线"][0] = {
      ...grouped1["记忆管线"][0],
      title: "modified",
    };
    expect(grouped2["记忆管线"][0].title).toBe("端到端记忆管线");
  });
});

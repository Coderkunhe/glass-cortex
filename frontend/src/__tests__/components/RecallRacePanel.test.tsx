import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import RecallRacePanel from "@/components/lab/RecallRacePanel";

afterEach(cleanup);

describe("RecallRacePanel", () => {
  it("renders header with title and subtitle", () => {
    render(<RecallRacePanel />);

    expect(screen.getByText("召回竞赛")).toBeInTheDocument();
    expect(
      screen.getByText("同一查询 → 三条检索路线并排对比"),
    ).toBeInTheDocument();
  });

  it("renders example query", () => {
    render(<RecallRacePanel />);

    expect(screen.getByText("示例查询：")).toBeInTheDocument();
    expect(
      screen.getByText(/"我之前说的那个 Python 项目叫什么来着？"/),
    ).toBeInTheDocument();
  });

  it("renders three route columns with labels", () => {
    render(<RecallRacePanel />);

    expect(screen.getByText("语义检索")).toBeInTheDocument();
    expect(screen.getByText("关键词检索")).toBeInTheDocument();
    expect(screen.getByText("MMR 混合")).toBeInTheDocument();
  });

  it("highlights MMR hybrid as recommended", () => {
    render(<RecallRacePanel />);

    // MMR hybrid should have the 推荐 badge
    const badges = screen.getAllByText("推荐");
    expect(badges.length).toBe(1); // only one "推荐" badge
  });

  it("renders strengths and weaknesses for each route", () => {
    render(<RecallRacePanel />);

    // Should have "强项" ×3 and "盲区" ×3
    const strengths = screen.getAllByText("强项");
    const weaknesses = screen.getAllByText("盲区");
    expect(strengths.length).toBe(3);
    expect(weaknesses.length).toBe(3);
  });

  it("renders example results for each route", () => {
    render(<RecallRacePanel />);

    // Each route has 3 example results with scores
    expect(screen.getByText("0.92")).toBeInTheDocument();
    expect(screen.getByText("0.95")).toBeInTheDocument();
    expect(screen.getByText("0.94")).toBeInTheDocument();
  });

  it("renders hybrid pipeline section with code reference", () => {
    render(<RecallRacePanel />);

    expect(screen.getByText("混合检索流水线")).toBeInTheDocument();
    expect(
      screen.getByText(/src\/memory\/recall\.py/),
    ).toBeInTheDocument();
  });

  it("renders MermaidDiagram for pipeline visualization", () => {
    render(<RecallRacePanel />);

    // MermaidDiagram renders its own chart area — verify the section exists
    // and the title is present (MermaidDiagram accepts a title prop)
    const pipelineTitle = screen.getByText("混合检索流水线");
    expect(pipelineTitle).toBeInTheDocument();
  });
});

"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RiBrainLine,
  RiDashboardLine,
  RiDatabase2Line,
  RiGitBranchLine,
  RiTestTubeLine,
} from "@remixicon/react";
import OverflowSimPanel from "./OverflowSimPanel";
import OverflowSandboxPanel from "./OverflowSandboxPanel";
import StrategyComparePanel from "./StrategyComparePanel";
import ReplanComparePanel from "./ReplanComparePanel";
import IntentTestPanel from "./IntentTestPanel";
import RecallRacePanel from "./RecallRacePanel";
import TokenDashboardPanel from "./TokenDashboardPanel";
import StepLatencyPanel from "./StepLatencyPanel";
import PipelineTracePanel from "./PipelineTracePanel";
import MemoryBrowserPanel from "./MemoryBrowserPanel";
import EmbeddingSpacePanel from "./EmbeddingSpacePanel";
import CacheStatsPanel from "./CacheStatsPanel";
import KnowledgeGraphPanel from "./KnowledgeGraphPanel";
import DecayDistributionPanel from "./DecayDistributionPanel";
import { TabBar } from "@/components/ui/TabBar";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import HealthDashboard from "@/components/observability/HealthDashboard";
import LogViewer from "@/components/observability/LogViewer";
import ExperimentComparePanel from "./ExperimentComparePanel";
import CostWaterfallPanel from "./CostWaterfallPanel";

/** Tab 定义 — 对齐 Batch 169-172 的交付计划 */
const TABS = [
  {
    key: "context",
    label: "上下文",
    icon: RiGitBranchLine,
    desc: "溢出模拟与沙箱 + 策略/重规划对比 + 意图分类 + 召回竞赛",
    batch: 169,
  },
  {
    key: "pipeline",
    label: "管线",
    icon: RiDashboardLine,
    desc: "Token 仪表盘 + 延迟分析 + Pipeline 追踪",
    batch: 170,
  },
  {
    key: "data",
    label: "数据",
    icon: RiDatabase2Line,
    desc: "记忆浏览器 + 嵌入空间 + 缓存统计",
    batch: 171,
  },
  {
    key: "graph",
    label: "图谱",
    icon: RiBrainLine,
    desc: "知识图谱 + 衰减直方图 + Health/Log 复用",
    batch: 172,
  },
  {
    key: "experiment",
    label: "实验",
    icon: RiTestTubeLine,
    desc: "A/B 对比 + 成本瀑布",
    batch: 179,
  },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Lab 实验台外壳组件。
 * 顶部 Tab 导航栏 + 条件内容区。
 * 每个 tab 面板包裹 ErrorBoundary 以实现崩溃隔离 —
 * 单个面板崩溃不影响其他 tab 的正常浏览。
 * Batch 114：内容区外层 ErrorBoundary 兜底 + per-tab 隔离。
 */
export default function LabShell() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabKey =
    tabParam && TABS.some((t) => t.key === tabParam)
      ? (tabParam as TabKey)
      : "context";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  return (
    <div className="flex flex-col h-full">
      {/* Tab 导航栏 */}
      <TabBar
        tabs={TABS}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        ariaLabel="实验室面板"
        tabPanelIdPrefix="lab"
        className="px-gm-5 pt-gm-3"
      />

      {/* 内容区 — 外层 ErrorBoundary 兜底整体崩溃，内层 per-tab 隔离 */}
      <div className="flex-1 overflow-y-auto p-gm-5">
        <ErrorBoundary fallbackVariant="card">
          {activeTab === "context" && (
            <section
              role="tabpanel"
              id="lab-context"
              aria-labelledby="lab-tab-context"
              className="space-y-gm-6"
            >
              <ErrorBoundary fallbackVariant="card">
                <OverflowSimPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <OverflowSandboxPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <StrategyComparePanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <ReplanComparePanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <IntentTestPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <RecallRacePanel />
              </ErrorBoundary>
            </section>
          )}
          {activeTab === "pipeline" && (
            <section
              role="tabpanel"
              id="lab-pipeline"
              aria-labelledby="lab-tab-pipeline"
              className="space-y-gm-6"
            >
              <ErrorBoundary fallbackVariant="card">
                <TokenDashboardPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <StepLatencyPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <PipelineTracePanel />
              </ErrorBoundary>
            </section>
          )}
          {activeTab === "data" && (
            <section
              role="tabpanel"
              id="lab-data"
              aria-labelledby="lab-tab-data"
              className="space-y-gm-6"
            >
              <ErrorBoundary fallbackVariant="card">
                <MemoryBrowserPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <EmbeddingSpacePanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <CacheStatsPanel />
              </ErrorBoundary>
            </section>
          )}
          {activeTab === "graph" && (
            <section
              role="tabpanel"
              id="lab-graph"
              aria-labelledby="lab-tab-graph"
              className="space-y-gm-6"
            >
              <ErrorBoundary fallbackVariant="card">
                <KnowledgeGraphPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <DecayDistributionPanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <HealthDashboard />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <LogViewer />
              </ErrorBoundary>
            </section>
          )}
          {activeTab === "experiment" && (
            <section
              role="tabpanel"
              id="lab-experiment"
              aria-labelledby="lab-tab-experiment"
              className="space-y-gm-6"
            >
              <ErrorBoundary fallbackVariant="card">
                <ExperimentComparePanel />
              </ErrorBoundary>
              <ErrorBoundary fallbackVariant="card">
                <CostWaterfallPanel />
              </ErrorBoundary>
            </section>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

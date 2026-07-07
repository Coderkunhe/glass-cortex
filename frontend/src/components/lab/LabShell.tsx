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
 * 顶部 Tab 导航栏 + 条件内容区。Batch 168 搭建外壳，
 * Batch 169-172 分批交付四 Tab 实装面板。
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
        className="px-gm-5 pt-gm-3"
      />

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-gm-5">
        {activeTab === "context" && (
          <div className="space-y-gm-6">
            <OverflowSimPanel />
            <OverflowSandboxPanel />
            <StrategyComparePanel />
            <ReplanComparePanel />
            <IntentTestPanel />
            <RecallRacePanel />
          </div>
        )}
        {activeTab === "pipeline" && (
          <div className="space-y-gm-6">
            <TokenDashboardPanel />
            <StepLatencyPanel />
            <PipelineTracePanel />
          </div>
        )}
        {activeTab === "data" && (
          <div className="space-y-gm-6">
            <MemoryBrowserPanel />
            <EmbeddingSpacePanel />
            <CacheStatsPanel />
          </div>
        )}
        {activeTab === "graph" && (
          <div className="space-y-gm-6">
            <KnowledgeGraphPanel />
            <DecayDistributionPanel />
            <HealthDashboard />
            <LogViewer />
          </div>
        )}
        {activeTab === "experiment" && (
          <div className="space-y-gm-6">
            <ExperimentComparePanel />
            <CostWaterfallPanel />
          </div>
        )}
      </div>
    </div>
  );
}

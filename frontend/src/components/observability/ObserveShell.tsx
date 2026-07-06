"use client";

import { useState } from "react";
import { TabBar } from "@/components/ui/TabBar";
import HealthDashboard from "./HealthDashboard";
import LogViewer from "./LogViewer";
import PipelineTracePanel from "@/components/lab/PipelineTracePanel";
import CompressionLogPanel from "./CompressionLogPanel";

const TABS = [
  { key: "health", label: "健康仪表盘" },
  { key: "logs", label: "日志查看器" },
  { key: "traces", label: "Trace 历史" },
  { key: "compression", label: "压缩日志" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Observability 页面外壳组件。
 * 顶部 Tab 导航栏 + 条件内容区。
 * 四个 tab 全部接入真实面板：健康仪表盘 / 日志查看器 / Trace 历史 / 压缩日志。
 */
export default function ObserveShell() {
  const [activeTab, setActiveTab] = useState<TabKey>("health");

  return (
    <div className="flex flex-col h-full">
      {/* Tab 导航栏 */}
      <TabBar
        tabs={TABS}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        ariaLabel="可观测性面板"
        className="px-gm-5 pt-gm-3"
      />

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-gm-5">
        {activeTab === "health" && <HealthDashboard />}
        {activeTab === "logs" && <LogViewer />}
        {activeTab === "traces" && <PipelineTracePanel />}
        {activeTab === "compression" && <CompressionLogPanel />}
      </div>
    </div>
  );
}

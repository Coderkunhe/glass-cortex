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
  { key: "traces", label: "调用追踪" },
  { key: "compression", label: "压缩日志" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Observability 页面外壳组件。
 * 顶部 Tab 导航栏 + 条件内容区。
 * 四个 tab 全部接入真实面板：健康仪表盘 / 日志查看器 / 调用追踪 / 压缩日志。
 */
export default function ObserveShell() {
  const [activeTab, setActiveTab] = useState<TabKey>("health");

  return (
    <div className="flex flex-col h-full">
      {/* 页面标题 — 屏幕阅读器可感知 */}
      <h1 className="sr-only">可观测性</h1>

      {/* Tab 导航栏 */}
      <TabBar
        tabs={TABS}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        ariaLabel="可观测性面板"
        tabPanelIdPrefix="obs"
        className="px-gm-5 pt-gm-3"
      />

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-gm-5">
        {activeTab === "health" && (
          <section
            role="tabpanel"
            id="obs-health"
            aria-labelledby="obs-tab-health"
          >
            <HealthDashboard />
          </section>
        )}
        {activeTab === "logs" && (
          <section
            role="tabpanel"
            id="obs-logs"
            aria-labelledby="obs-tab-logs"
          >
            <LogViewer />
          </section>
        )}
        {activeTab === "traces" && (
          <section
            role="tabpanel"
            id="obs-traces"
            aria-labelledby="obs-tab-traces"
          >
            <PipelineTracePanel />
          </section>
        )}
        {activeTab === "compression" && (
          <section
            role="tabpanel"
            id="obs-compression"
            aria-labelledby="obs-tab-compression"
          >
            <CompressionLogPanel />
          </section>
        )}
      </div>
    </div>
  );
}

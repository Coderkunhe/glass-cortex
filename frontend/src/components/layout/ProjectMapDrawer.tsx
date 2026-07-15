"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Drawer from "@/components/ui/Drawer";
import {
  RiCloseLine,
  RiRoadMapLine,
  RiFocus3Line,
  RiBrainLine,
  RiLayoutMasonryLine,
  RiCpuLine,
  RiChat3Line,
  RiArchiveLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiFlowChart,
} from "@remixicon/react";
import ExplainTooltip from "@/components/ui/ExplainTooltip";
import { getTermsGrouped, CATEGORY_LABELS } from "@/lib/glossary";
import type { GlossaryCategory } from "@/lib/glossary";
import {
  getFlowchartsGrouped,
  FLOWCHART_CATEGORY_LABELS,
} from "@/lib/flowcharts";
import type { FlowchartCategory } from "@/lib/flowcharts";

/** 懒加载 MermaidDiagram — mermaid.js 打独立 chunk，Drawer 打开才下载 */
const MermaidDiagram = dynamic(
  () => import("@/components/ui/MermaidDiagram"),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 120,
          background: "var(--gm-surface-alt)",
          borderRadius: "var(--gm-radius-sm, 4px)",
          border: "1px solid var(--gm-border)",
          fontSize: "0.75rem",
          color: "var(--gm-text-muted)",
        }}
      >
        加载流程图...
      </div>
    ),
  },
);

/** 抽屉滑入动画参数 */

interface ProjectMapDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 消息旅程步骤 */
interface JourneyStep {
  step: number;
  icon: typeof RiBrainLine;
  title: string;
  desc: string;
}

const JOURNEY_STEPS: JourneyStep[] = [
  {
    step: 1,
    icon: RiFocus3Line,
    title: "意图识别",
    desc: "Planner 判断你想做什么——提问、指令、闲聊还是探索？不同意图走不同管线。",
  },
  {
    step: 2,
    icon: RiBrainLine,
    title: "记忆召回",
    desc: "从长期记忆中检索相关内容。语义相似度 + 衰减强度 + 重要性综合排序。",
  },
  {
    step: 3,
    icon: RiLayoutMasonryLine,
    title: "上下文组装",
    desc: "四区 token 分配——系统提示词、记忆召回、对话历史、工具定义按预算填入上下文窗口。",
  },
  {
    step: 4,
    icon: RiCpuLine,
    title: "模型推理",
    desc: "DeepSeek LLM 处理组装好的上下文，生成回复。每次调用的请求/响应全量可解剖。",
  },
  {
    step: 5,
    icon: RiChat3Line,
    title: "回复生成",
    desc: "AI 的回复返回给你，同时触发后续处理——事实提取、记忆存储、Token 记账。",
  },
  {
    step: 6,
    icon: RiArchiveLine,
    title: "记忆存储",
    desc: "对话存入长期记忆。FactExtractor 抽取三元组知识，ForgettingEngine 启动衰减周期。",
  },
];

/** 页面导航条目 */
interface NavEntry {
  href: string;
  icon: typeof RiRoadMapLine;
  title: string;
  desc: string;
}

const NAV_ENTRIES: NavEntry[] = [
  {
    href: "/",
    icon: RiChat3Line,
    title: "聊天",
    desc: "与 AI 对话，实时观察记忆、上下文、Token 的变化",
  },
  {
    href: "/learn",
    icon: RiArchiveLine,
    title: "文档",
    desc: "93 问认知地图——逐层揭开 AI 工作原理",
  },
  {
    href: "/observability",
    icon: RiCpuLine,
    title: "可观测",
    desc: "健康仪表盘 + 日志查看器 + Pipeline 追踪",
  },
  {
    href: "/lab",
    icon: RiFocus3Line,
    title: "实验室",
    desc: "上下文溢出模拟、Token 分析、知识图谱等 11 个面板",
  },
  {
    href: "/profile",
    icon: RiBrainLine,
    title: "画像",
    desc: "你的记忆画像——标签云、置信度管理、知识溯源",
  },
];

/**
 * 项目地图右侧滑入抽屉。
 *
 * 全局单例（AppShell 中渲染），由 Header 的地图按钮触发。
 * 纯前端组件，内容为静态文本（无 API 调用）。
 *
 * 五段内容：
 * 1. 项目介绍 — GlassCortex 是什么
 * 2. 消息旅程 — 6 步管线
 * 3. 流程图 — 3 张 Mermaid 图（记忆管线/上下文分区/遗忘曲线）
 * 4. 页面导航 — 5 页链接卡片
 * 5. 概念速查 — 按分类分组的术语 accordion
 */
export default function ProjectMapDrawer({
  isOpen,
  onClose,
}: ProjectMapDrawerProps) {
  const router = useRouter();

  // ── 概念速查 accordion 状态 ──
  const [expandedCats, setExpandedCats] = useState<Set<GlossaryCategory>>(
    new Set(),
  );
  const groupedTerms = getTermsGrouped();

  const toggleCat = (cat: GlossaryCategory) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // ── 流程图 accordion 状态 ──
  const [expandedFlowCats, setExpandedFlowCats] = useState<
    Set<FlowchartCategory>
  >(new Set());
  const groupedFlowcharts = getFlowchartsGrouped();

  const toggleFlowCat = (cat: FlowchartCategory) => {
    setExpandedFlowCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} maxWidth={480} duration={600} ariaLabel="项目地图">
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-gm-3 px-gm-5 py-gm-4"
          style={{ borderBottom: "1px solid var(--gm-border)" }}
        >
          <div className="flex items-center gap-gm-2">
            <RiRoadMapLine
              className="text-gm-xl shrink-0"
              style={{ color: "var(--gm-brand)" }}
            />
            <h2
              className="text-gm-lg font-semibold"
              style={{ color: "var(--gm-text)" }}
            >
              项目地图
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-gm-sm p-gm-1 text-text-muted hover:bg-surface-alt transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
            aria-label="关闭项目地图"
          >
            <RiCloseLine className="text-gm-icon" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-gm-5 py-gm-4 min-h-0">
          {/* ── 1. 项目介绍 ── */}
          <section className="mb-gm-6">
            <h3
              className="text-gm-base font-semibold mb-gm-3"
              style={{ color: "var(--gm-text)" }}
            >
              📖 项目介绍
            </h3>
            <div
              className="text-gm-sm"
              style={{
                color: "var(--gm-text-secondary)",
                lineHeight: "var(--gm-leading-relaxed, 1.7)",
              }}
            >
              <div className="mb-gm-2">
                <ExplainTooltip termId="glasscortex">
                  GlassCortex
                </ExplainTooltip>{" "}
                （玻璃皮层）是一个开源教育项目——透明化 AI
                Robot 的认知层，让记忆、上下文、Token 消费和任务规划变得
                可见、可理解、可交互。
              </div>
              <div className="mb-gm-2">
                它不碰基模推理本身（那是黑盒），而是透明化包裹大模型的
                「皮层」——记忆如何形成与遗忘、上下文如何组装与溢出、Token
                如何计量与节省、
                <ExplainTooltip termId="intent-recognition">
                  意图如何识别
                </ExplainTooltip>
                与任务如何规划。
              </div>
              <div>
                技术栈：Next.js 16 + FastAPI + Python
                引擎。所有 AI 交互可解剖——每条 LLM
                调用的完整请求/响应/耗时/Token 都有存档。
              </div>
            </div>
          </section>

          {/* ── 2. 消息旅程 ── */}
          <section className="mb-gm-6">
            <h3
              className="text-gm-base font-semibold mb-gm-3"
              style={{ color: "var(--gm-text)" }}
            >
              🗺️ 消息旅程
            </h3>
            <div className="flex flex-col gap-gm-3">
              {JOURNEY_STEPS.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.step} className="flex gap-gm-3">
                    {/* 步骤编号圆形 */}
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gm-xs font-semibold"
                      style={{
                        background: "var(--gm-brand)",
                        color: "#fff",
                      }}
                    >
                      {step.step}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-gm-1_5 mb-gm-0_5">
                        <Icon
                          className="text-gm-sm shrink-0"
                          style={{ color: "var(--gm-text-muted)" }}
                        />
                        <span
                          className="text-gm-sm font-medium"
                          style={{ color: "var(--gm-text)" }}
                        >
                          {step.title}
                        </span>
                      </div>
                      <p
                        className="text-gm-xs"
                        style={{ color: "var(--gm-text-muted)" }}
                      >
                        {step.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── 3. 流程图 ── */}
          <section className="mb-gm-6">
            <h3
              className="text-gm-base font-semibold mb-gm-3"
              style={{ color: "var(--gm-text)" }}
            >
              🔄 流程图
            </h3>
            <div className="flex flex-col gap-gm-2">
              {(Object.entries(groupedFlowcharts) as [
                FlowchartCategory,
                (typeof groupedFlowcharts)[FlowchartCategory],
              ][]).map(([cat, charts]) => {
                if (charts.length === 0) return null;
                const isExpanded = expandedFlowCats.has(cat);
                return (
                  <div
                    key={cat}
                    className="rounded-gm-lg overflow-hidden"
                    style={{
                      background: "var(--gm-surface-alt)",
                      border: "1px solid var(--gm-border)",
                    }}
                  >
                    {/* Category header — clickable accordion */}
                    <button
                      onClick={() => toggleFlowCat(cat)}
                      className="flex w-full items-center justify-between gap-gm-2 px-gm-3 py-gm-2_5 transition-all hover:bg-surface-alt/50 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
                    >
                      <span className="flex items-center gap-gm-2">
                        <RiFlowChart
                          className="text-gm-sm"
                          style={{ color: "var(--gm-brand)" }}
                        />
                        <span
                          className="text-gm-sm font-medium"
                          style={{ color: "var(--gm-text)" }}
                        >
                          {FLOWCHART_CATEGORY_LABELS[cat]}
                        </span>
                      </span>
                      <span className="flex items-center gap-gm-2">
                        <span
                          className="text-gm-xs"
                          style={{ color: "var(--gm-text-muted)" }}
                        >
                          {charts.length} 张图
                        </span>
                        {isExpanded ? (
                          <RiArrowUpSLine
                            className="text-gm-sm"
                            style={{ color: "var(--gm-text-muted)" }}
                          />
                        ) : (
                          <RiArrowDownSLine
                            className="text-gm-sm"
                            style={{ color: "var(--gm-text-muted)" }}
                          />
                        )}
                      </span>
                    </button>

                    {/* Flowcharts */}
                    <div
                      style={{
                        maxHeight: isExpanded ? "2000px" : "0px",
                        opacity: isExpanded ? 1 : 0,
                        overflow: "hidden",
                        transition:
                          "max-height var(--gm-duration-slow) ease-in-out, opacity var(--gm-duration-base) ease-in-out",
                      }}
                    >
                      <div
                        className="px-gm-3 pb-gm-3 flex flex-col gap-gm-4"
                        style={{ borderTop: "1px solid var(--gm-border)" }}
                      >
                        {charts.map((fc) => (
                          <div key={fc.id} className="pt-gm-3">
                            <MermaidDiagram
                              chart={fc.chart}
                              title={fc.title}
                              description={fc.description}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── 4. 页面导航 ── */}
          <section className="mb-gm-6">
            <h3
              className="text-gm-base font-semibold mb-gm-3"
              style={{ color: "var(--gm-text)" }}
            >
              🧭 页面导航
            </h3>
            <div className="grid grid-cols-2 gap-gm-3">
              {NAV_ENTRIES.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.href}
                    onClick={() => {
                      router.push(entry.href);
                      onClose();
                    }}
                    className="gm-card-lift text-left rounded-gm-lg p-gm-3 transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]"
                    style={{
                      background: "var(--gm-surface-alt)",
                      border: "1px solid var(--gm-border)",
                    }}
                  >
                    <Icon
                      className="text-gm-base mb-gm-1"
                      style={{ color: "var(--gm-brand)" }}
                    />
                    <div
                      className="text-gm-sm font-medium mb-gm-0_5"
                      style={{ color: "var(--gm-text)" }}
                    >
                      {entry.title}
                    </div>
                    <p
                      className="text-gm-xs"
                      style={{ color: "var(--gm-text-muted)" }}
                    >
                      {entry.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── 5. 概念速查 ── */}
          <section>
            <h3
              className="text-gm-base font-semibold mb-gm-3"
              style={{ color: "var(--gm-text)" }}
            >
              📚 概念速查
            </h3>
            <div className="flex flex-col gap-gm-2">
              {(Object.entries(groupedTerms) as [GlossaryCategory, typeof groupedTerms[GlossaryCategory]][]).map(
                ([cat, terms]) => {
                  if (terms.length === 0) return null;
                  const isExpanded = expandedCats.has(cat);
                  return (
                    <div
                      key={cat}
                      className="rounded-gm-lg overflow-hidden"
                      style={{
                        background: "var(--gm-surface-alt)",
                        border: "1px solid var(--gm-border)",
                      }}
                    >
                      {/* Category header — clickable accordion */}
                      <button
                        onClick={() => toggleCat(cat)}
                        className="flex w-full items-center justify-between gap-gm-2 px-gm-3 py-gm-2_5 transition-all hover:bg-surface-alt/50 focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.99]"
                      >
                        <span
                          className="text-gm-sm font-medium"
                          style={{ color: "var(--gm-text)" }}
                        >
                          {CATEGORY_LABELS[cat]}
                        </span>
                        <span className="flex items-center gap-gm-2">
                          <span
                            className="text-gm-xs"
                            style={{ color: "var(--gm-text-muted)" }}
                          >
                            {terms.length} 个术语
                          </span>
                          {isExpanded ? (
                            <RiArrowUpSLine
                              className="text-gm-sm"
                              style={{ color: "var(--gm-text-muted)" }}
                            />
                          ) : (
                            <RiArrowDownSLine
                              className="text-gm-sm"
                              style={{ color: "var(--gm-text-muted)" }}
                            />
                          )}
                        </span>
                      </button>

                      {/* Terms list */}
                      <div
                        style={{
                          maxHeight: isExpanded ? "800px" : "0px",
                          opacity: isExpanded ? 1 : 0,
                          overflow: "hidden",
                          transition:
                            "max-height var(--gm-duration-slow) ease-in-out, opacity var(--gm-duration-base) ease-in-out",
                        }}
                      >
                        <div
                          className="px-gm-3 pb-gm-3 flex flex-col gap-gm-2"
                          style={{ borderTop: "1px solid var(--gm-border)" }}
                        >
                          {terms.map((term) => (
                            <div key={term.id} className="pt-gm-2">
                              <div
                                className="text-gm-sm font-medium mb-gm-0_5"
                                style={{ color: "var(--gm-text)" }}
                              >
                                {term.term}
                              </div>
                              <p
                                className="text-gm-xs"
                                style={{ color: "var(--gm-text-muted)" }}
                              >
                                {term.shortDef}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </section>
        </div>
    </Drawer>
  );
}

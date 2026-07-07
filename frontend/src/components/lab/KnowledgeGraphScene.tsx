"use client";

import { useRef, useEffect, useMemo } from "react";
import * as echarts from "echarts";
import type { GraphNode, GraphEdge } from "@/lib/api/types";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";

// ── 图谱可视化专用色板 ──
// 不同于 UI 文本 token（灰色系），图谱需鲜艳、高对比度的数据可视化配色。
// 仅 tooltip/表面/边框复用 CSS 自定义属性以保证与主题系统对齐。

interface GraphColors {
  catSubject: string;
  catObject: string;
  nodeLabel: string;
  edgeColor: string;
  edgeLabel: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  itemBorder: string;
  itemShadow: string;
  emphasisShadow: string;
  emphasisBorder: string;
}

function getGraphColors(isDark: boolean): GraphColors {
  // UI 结构色从 CSS token 读取（tooltip / 表面 / 边框）
  const s =
    typeof document === "undefined"
      ? null
      : getComputedStyle(document.documentElement);
  const css = (prop: string, fallback: string) =>
    (s?.getPropertyValue(prop) || fallback).trim();

  return isDark
    ? {
        // 暗色模式：亮色节点 + 柔和标签
        catSubject: css("--gm-brand", "#818cf8"), // indigo-400
        catObject: "#2dd4bf", // teal-400 — 与 indigo 区分度高
        nodeLabel: "#e2e8f0", // slate-200 — 近白，max 可读性
        edgeColor: "#a5b4fc", // indigo-300 — 非灰，暗底上柔和可见
        edgeLabel: css("--gm-text-secondary", "#cbd5e1"), // slate-300
        tooltipBg: css("--gm-surface-elevated", "#1e293b"),
        tooltipBorder: css("--gm-border-strong", "#475569"),
        tooltipText: css("--gm-text", "#f1f5f9"),
        itemBorder: "rgba(255,255,255,0.15)",
        itemShadow: "rgba(0,0,0,0.3)",
        emphasisShadow: "rgba(129,140,248,0.5)",
        emphasisBorder: "rgba(255,255,255,0.4)",
      }
    : {
        // 亮色模式：深色标签 + 鲜艳客体色
        catSubject: css("--gm-brand", "#4f46e5"), // indigo-600
        catObject: "#0d9488", // teal-600 — 与 indigo 区分度高，不灰
        nodeLabel: "#1e293b", // slate-800 — 近黑，max 可读性
        edgeColor: "#c7d2fe", // indigo-200 — 极淡蓝紫，非灰但不跳
        edgeLabel: "#475569", // slate-600 — 深灰，比 muted 清晰
        tooltipBg: css("--gm-surface-elevated", "#ffffff"),
        tooltipBorder: css("--gm-border-strong", "#cbd5e1"),
        tooltipText: css("--gm-text", "#0f172a"),
        itemBorder: "rgba(0,0,0,0.1)",
        itemShadow: "rgba(0,0,0,0.05)",
        emphasisShadow: "rgba(79,70,229,0.25)",
        emphasisBorder: "rgba(79,70,229,0.5)",
      };
}

// ── 节点大小计算 ──

const NODE_SIZE_MIN = 14;
const NODE_SIZE_MAX = 48;

function buildSizeFn(weights: number[]): (w: number) => number {
  if (weights.length <= 1) return () => 28;
  const max = Math.max(...weights);
  const min = Math.min(...weights);
  const range = max - min || 1;
  return (w: number) =>
    NODE_SIZE_MIN + ((w - min) / range) * (NODE_SIZE_MAX - NODE_SIZE_MIN);
}

// ── Props ──

export interface KnowledgeGraphSceneProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── 构建 ECharts 配置 ──

function buildOption(
  nodes: GraphNode[],
  edges: GraphEdge[],
  isDark: boolean,
  c: GraphColors,
): echarts.EChartsOption | null {
  if (nodes.length === 0) return null;

  const getSize = buildSizeFn(nodes.map((n) => n.weight));

  // 度数统计
  const degreeMap = new Map<string, number>();
  for (const n of nodes) degreeMap.set(n.id, 0);
  for (const e of edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }

  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter: (params: unknown) => {
        const p = params as { dataType?: string; data?: Record<string, unknown> };
        if (p.dataType === "node" && p.data) {
          const d = p.data;
          const groupLabel =
            d.category === 0 ? "主体 (Subject)" : "客体 (Object)";
          return `<strong style="font-size:13px">${d.name}</strong><br/>
            <span style="color:${c.edgeLabel}">${groupLabel}</span><br/>
            关联事实：${d.factCount ?? 0} 条<br/>
            连接数：${d.degree ?? 0}`;
        }
        if (p.data) {
          const d = p.data as Record<string, unknown>;
          const pct = ((d.confidence as number) ?? 0) * 100;
          return `<span style="color:${c.edgeLabel}">${d.edgeLabel ?? ""}</span> — ${pct.toFixed(0)}%`;
        }
        return "";
      },
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        animation: true,
        animationDuration: 1200,
        animationEasingUpdate: "elasticOut",

        categories: [
          { name: "主体 (Subject)", itemStyle: { color: c.catSubject } },
          { name: "客体 (Object)", itemStyle: { color: c.catObject } },
        ],

        data: nodes.map((n) => ({
          id: n.id,
          name: n.label,
          symbolSize: getSize(n.weight),
          category: n.group === "subject" ? 0 : 1,
          factCount: n.weight,
          degree: degreeMap.get(n.id) ?? 0,
        })),

        edges: edges.map((e) => ({
          source: e.source,
          target: e.target,
          edgeLabel: e.label,
          confidence: e.confidence,
          label: {
            show: true,
            formatter: e.label,
            fontSize: 9,
            color: c.edgeLabel,
          },
          lineStyle: {
            curveness: 0.2 + e.confidence * 0.15,
            // 有色边比灰边显眼，降低不透明度上限
            opacity: 0.18 + e.confidence * 0.42,
            width: 1.2 + e.confidence * 3.5,
            color: c.edgeColor,
          },
        })),

        force: {
          repulsion: 350,
          gravity: 0.06,
          edgeLength: [100, 280],
          layoutAnimation: true,
          friction: 0.6,
        },

        // 节点标签：使用高对比度颜色（近黑/近白），不再用灰色
        label: {
          show: true,
          position: "bottom",
          offset: [0, 6],
          fontSize: 10,
          color: c.nodeLabel,
          overflow: "truncate",
          width: 80,
        },

        itemStyle: {
          borderColor: c.itemBorder,
          borderWidth: 1,
          shadowBlur: 8,
          shadowColor: c.itemShadow,
        },

        emphasis: {
          focus: "adjacency",
          itemStyle: {
            shadowBlur: 24,
            shadowColor: c.emphasisShadow,
            borderWidth: 2,
            borderColor: c.emphasisBorder,
          },
          lineStyle: {
            width: 5,
            opacity: 0.9,
          },
          label: {
            fontSize: 12,
            fontWeight: "bold",
          },
        },

        blur: {
          itemStyle: { opacity: 0.15 },
          lineStyle: { opacity: 0.04 },
          label: { opacity: 0.15 },
        },

        lineStyle: {
          color: c.edgeColor,
          opacity: 0.25,
          curveness: 0.25,
        },
      } satisfies echarts.SeriesOption,
    ],
  };
}

// ── ECharts 轻量包装器 ──

function EChartsWrapper({ option }: { option: echarts.EChartsOption }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.setOption(option, { notMerge: true });
    }
  }, [option]);

  return (
    <div
      ref={containerRef}
      data-testid="echarts-container"
      style={{ height: "clamp(340px, 60vh, 700px)", width: "100%" }}
    />
  );
}

// ── 导出组件 ──

/**
 * ECharts 力导向知识图谱。
 *
 * 2D Canvas 渲染 — 节点色按 category 区分（主体 indigo / 客体 teal），
 * 边自动弯曲，粗细/透明度随置信度变化，hover 高亮邻接节点，
 * 支持拖拽/缩放/漫游。颜色通过双主题色板适配亮/暗模式。
 */
export default function KnowledgeGraphScene({
  nodes,
  edges,
}: KnowledgeGraphSceneProps) {
  const isDark = useIsDarkTheme();

  const graphColors = useMemo(() => getGraphColors(isDark), [isDark]);

  const option = useMemo(
    () => buildOption(nodes, edges, isDark, graphColors),
    [nodes, edges, isDark, graphColors],
  );

  if (!option) {
    return (
      <div
        className="flex items-center justify-center text-text-muted select-none"
        style={{ height: "clamp(340px, 60vh, 700px)" }}
      >
        <p className="text-gm-sm">暂无图谱数据</p>
      </div>
    );
  }

  return <EChartsWrapper option={option} />;
}

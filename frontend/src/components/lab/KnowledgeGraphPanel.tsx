"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { RiMindMap } from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import KnowledgeGraphScene from "./KnowledgeGraphScene";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import type { KnowledgeGraphResponse, FetchState } from "@/lib/api/types";

// ── 图例色 — 与 KnowledgeGraphScene 的 GraphColors 保持同步 ──
const LEGEND_COLORS = {
  subject: { light: "#4f46e5", dark: "#818cf8" }, // indigo
  object: { light: "#0d9488", dark: "#2dd4bf" }, // teal
};

// ── 主组件 ──

/**
 * 知识图谱可视化面板。
 * ECharts 力导向图——节点大小表示关联事实数，节点颜色区分主体/客体，
 * 边粗细/透明度表示置信度，边自动弯曲，hover 高亮邻接节点。
 * 交互：拖拽/缩放/漫游 · hover 高亮邻接 · tooltip 详情。
 * 置信度筛选器：滑块过滤低置信度边及孤立节点。
 */
export default function KnowledgeGraphPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<KnowledgeGraphResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);
  const [minConfidence, setMinConfidence] = useState(0);
  const isDark = useIsDarkTheme();

  const fetchGraph = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getKnowledgeGraph();
      setData(result);
      setState(result.total_facts > 0 ? "success" : "idle");
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("获取知识图谱失败")
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGraph();
  }, [fetchGraph]);

  // 置信度筛选：过滤边 → 保留有边的节点
  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!data) return { filteredNodes: [], filteredEdges: [] };
    if (minConfidence <= 0) {
      return { filteredNodes: data.nodes, filteredEdges: data.edges };
    }
    const edges = data.edges.filter((e) => e.confidence >= minConfidence);
    const connectedIds = new Set<string>();
    for (const e of edges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }
    const nodes = data.nodes.filter((n) => connectedIds.has(n.id));
    return { filteredNodes: nodes, filteredEdges: edges };
  }, [data, minConfidence]);

  // 重取时重置筛选器
  const handleRefresh = useCallback(() => {
    setMinConfidence(0);
    fetchGraph();
  }, [fetchGraph]);

  // 置信度滑块变更
  const handleConfidenceChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setMinConfidence(Number(e.target.value));
    },
    [],
  );

  const hasData = state === "success" && data && data.nodes.length > 0;
  const filtered = minConfidence > 0;
  const filteredCount =
    filtered ? `${filteredNodes.length}/${data?.nodes.length ?? 0}` : null;

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiMindMap className="w-5 h-5 text-info shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">知识图谱</h3>
        <span className="text-gm-xs text-text-muted">
          三元组可视化 · 共 {data?.total_facts ?? 0} 条事实
        </span>
        {state === "success" && (
          <RefreshButton onClick={handleRefresh} className="ml-auto" />
        )}
      </div>

      <DataState
        state={state}
        error={error}
        onRetry={fetchGraph}
        loadingMessage="加载知识图谱…"
        loadingIconClassName="text-info"
        emptyIcon={RiMindMap}
        emptyMessage="暂无三元组数据，执行一些对话后回来查看"
        isEmpty={
          state === "idle" ||
          (state === "success" && (!data || data.nodes.length === 0))
        }
      >
        {/* Success — ECharts 力导向图 */}
        {hasData && (
          <div className="border-t border-border pt-gm-4">
            {/* 置信度筛选器 */}
            <div className="flex items-center gap-gm-3 mb-gm-3 px-gm-1">
              <label
                htmlFor="confidence-filter"
                className="text-gm-xs text-text-secondary whitespace-nowrap select-none"
              >
                置信度 ≥ {Math.round(minConfidence * 100)}%
              </label>
              <input
                id="confidence-filter"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={minConfidence}
                onChange={handleConfidenceChange}
                className="flex-1 h-1.5 accent-indigo-600 cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--gm-brand, #4f46e5) ${minConfidence * 100}%, var(--gm-border, #e2e8f0) ${minConfidence * 100}%)`,
                }}
              />
              {filtered && filteredCount && (
                <span className="text-gm-xs text-text-muted whitespace-nowrap">
                  筛选 {filteredNodes.length} 节点 · {filteredEdges.length} 边
                </span>
              )}
            </div>

            <KnowledgeGraphScene nodes={filteredNodes} edges={filteredEdges} />

            {/* Legend */}
            <div className="flex items-center justify-center gap-gm-4 mt-gm-2">
              <span className="flex items-center gap-gm-1 text-gm-xs text-text-muted">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{
                    backgroundColor: isDark
                      ? LEGEND_COLORS.subject.dark
                      : LEGEND_COLORS.subject.light,
                  }}
                />
                主体 (Subject)
              </span>
              <span className="flex items-center gap-gm-1 text-gm-xs text-text-muted">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{
                    backgroundColor: isDark
                      ? LEGEND_COLORS.object.dark
                      : LEGEND_COLORS.object.light,
                  }}
                />
                客体 (Object)
              </span>
              <span className="flex items-center gap-gm-1 text-gm-xs text-text-muted">
                <span
                  className="w-4 h-0.5 inline-block align-middle"
                  style={{ backgroundColor: "var(--gm-text-muted)" }}
                />
                关系 (Relation)
              </span>
            </div>

            {/* 统计摘要 */}
            <p className="text-gm-xs text-text-muted/70 text-center mt-gm-2">
              共 {data.total_facts} 条事实 ·{" "}
              {filtered
                ? `${filteredNodes.length}/${data.nodes.length} 节点 · ${filteredEdges.length}/${data.edges.length} 边`
                : `${data.nodes.length} 个节点 · ${data.edges.length} 条边`}
            </p>
          </div>
        )}
      </DataState>
    </section>
  );
}

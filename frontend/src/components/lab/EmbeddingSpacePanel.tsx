"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  RiBubbleChartLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import ImageViewer from "@/components/ui/ImageViewer";
import type { EmbeddingCoordsResponse, FetchState } from "@/lib/api/types";


/** SVG viewBox 和边距常量 */
const VB_W = 600;
const VB_H = 400;
const PAD = { top: 20, right: 20, bottom: 40, left: 50 };
const PLOT_W = VB_W - PAD.left - PAD.right; // 530
const PLOT_H = VB_H - PAD.top - PAD.bottom; // 340

/**
 * 嵌入空间可视化面板。
 * 纯 SVG 2D 散点图：x/y = PCA 坐标，z → 半径，kind → 颜色。
 */
export default function EmbeddingSpacePanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<EmbeddingCoordsResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  // ── Lightbox state ──
  const [lightboxSvg, setLightboxSvg] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchCoords = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getEmbeddingCoords(500);
      setData(result);
      setState(result.coords.length > 0 ? "success" : "idle");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取嵌入坐标失败"));
      setState("error");
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => fetchCoords(), 0);
    return () => clearTimeout(id);
  }, [fetchCoords]);


  // ── 坐标缩放逻辑 ──
  function computeScales(coords: EmbeddingCoordsResponse["coords"]) {
    if (!coords || coords.length === 0) return null;

    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;

    for (const c of coords) {
      if (c.x < xMin) xMin = c.x;
      if (c.x > xMax) xMax = c.x;
      if (c.y < yMin) yMin = c.y;
      if (c.y > yMax) yMax = c.y;
      if (c.z < zMin) zMin = c.z;
      if (c.z > zMax) zMax = c.z;
    }

    // 处理单点/等值情况
    if (xMax === xMin) { xMin -= 1; xMax += 1; }
    if (yMax === yMin) { yMin -= 1; yMax += 1; }
    if (zMax === zMin) { zMin -= 0.1; zMax += 0.1; }

    const scaleX = (v: number) =>
      PAD.left + ((v - xMin) / (xMax - xMin)) * PLOT_W;
    const scaleY = (v: number) =>
      PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;
    const radius = (z: number) =>
      2 + ((z - zMin) / (zMax - zMin)) * 6;

    return { scaleX, scaleY, radius, xMin, xMax, yMin, yMax };
  }

  const scales = data ? computeScales(data.coords) : null;

  // ── 坐标轴刻度 ──
  function niceTicks(min: number, max: number, count = 4): number[] {
    const step = (max - min) / (count - 1);
    return Array.from({ length: count }, (_, i) => min + step * i);
  }

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiBubbleChartLine className="w-5 h-5 text-accent shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">嵌入空间</h3>
        <span className="text-gm-xs text-text-muted">
          PCA 降维可视化 · 共 {data?.total_vectors ?? 0} 个向量
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchCoords} className="ml-auto" />
        )}
      </div>



      <DataState
        state={state}
        error={error}
        onRetry={fetchCoords}
        loadingMessage="加载嵌入坐标…"
        loadingIconClassName="text-accent"
        emptyIcon={RiBubbleChartLine}
        emptyMessage="暂无向量数据，先创建一些记忆再回来查看"
        isEmpty={
          state === "idle" ||
        (state === "success" && (!data || data.coords.length === 0))
        }
      >
      {/* Success — SVG 散点图 */}
      {state === "success" && data && scales && data.coords.length > 0 && (
        <div
          className="border-t border-border pt-gm-4"
          style={{ cursor: "zoom-in" }}
          role="img"
          aria-label="嵌入空间 SVG 可视化"
          tabIndex={0}
          title="点击查看大图"
          onClick={() => {
            if (svgRef.current) {
              setLightboxSvg(svgRef.current.outerHTML);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (svgRef.current) {
                setLightboxSvg(svgRef.current.outerHTML);
              }
            }
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="w-full"
            style={{ maxHeight: "420px" }}
          >
            {/* 背景网格线 */}
            {niceTicks(scales.xMin, scales.xMax).map((tick) => (
              <line
                key={`gx-${tick}`}
                x1={scales.scaleX(tick)}
                y1={PAD.top}
                x2={scales.scaleX(tick)}
                y2={PAD.top + PLOT_H}
                stroke="var(--gm-border, #e2e8f0)"
                strokeWidth="0.5"
              />
            ))}
            {niceTicks(scales.yMin, scales.yMax).map((tick) => (
              <line
                key={`gy-${tick}`}
                x1={PAD.left}
                y1={scales.scaleY(tick)}
                x2={PAD.left + PLOT_W}
                y2={scales.scaleY(tick)}
                stroke="var(--gm-border, #e2e8f0)"
                strokeWidth="0.5"
              />
            ))}

            {/* 坐标轴 */}
            <line
              x1={PAD.left} y1={PAD.top + PLOT_H}
              x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H}
              stroke="var(--gm-text-muted, #94a3b8)" strokeWidth="1"
            />
            <line
              x1={PAD.left} y1={PAD.top}
              x2={PAD.left} y2={PAD.top + PLOT_H}
              stroke="var(--gm-text-muted, #94a3b8)" strokeWidth="1"
            />

            {/* X 轴刻度 */}
            {niceTicks(scales.xMin, scales.xMax).map((tick) => (
              <text
                key={`tx-${tick}`}
                x={scales.scaleX(tick)}
                y={PAD.top + PLOT_H + 16}
                textAnchor="middle"
                className="fill-text-muted"
                fontSize="9"
              >
                {tick.toFixed(1)}
              </text>
            ))}

            {/* Y 轴刻度 */}
            {niceTicks(scales.yMin, scales.yMax).map((tick) => (
              <text
                key={`ty-${tick}`}
                x={PAD.left - 6}
                y={scales.scaleY(tick) + 3}
                textAnchor="end"
                className="fill-text-muted"
                fontSize="9"
              >
                {tick.toFixed(1)}
              </text>
            ))}

            {/* 散点 */}
            {data.coords.map((c) => (
              <circle
                key={c.id}
                data-dot="true"
                cx={scales.scaleX(c.x)}
                cy={scales.scaleY(c.y)}
                r={scales.radius(c.z)}
                fill={c.color}
                opacity="0.7"
              >
                <title>{c.label}</title>
              </circle>
            ))}
          </svg>

          {/* PCA 方差 */}
          {data.pca_variance_explained.length > 0 && (
            <p className="text-gm-xs text-text-muted/70 text-center mt-gm-2">
              PCA 方差解释：PC1{" "}
              {(data.pca_variance_explained[0] * 100).toFixed(0)}% · PC2{" "}
              {(data.pca_variance_explained[1] * 100).toFixed(0)}%
              {data.pca_variance_explained[2] !== undefined &&
                ` · PC3 ${(data.pca_variance_explained[2] * 100).toFixed(0)}%`}
            </p>
          )}

          {/* Legend */}
          <div className="flex items-center justify-center gap-gm-4 mt-gm-2">
            <span className="flex items-center gap-gm-1 text-gm-xs text-text-muted">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: "var(--gm-brand)" }}
              />
              记忆 (Episode)
            </span>
            <span className="flex items-center gap-gm-1 text-gm-xs text-text-muted">
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: "var(--gm-accent)" }}
              />
              知识 (Fact)
            </span>
          </div>
        </div>
      )}

      {/* Lightbox — 点击 SVG 放大查看 */}
      {lightboxSvg && (
        <ImageViewer
          svgHtml={lightboxSvg}
          alt="嵌入空间 SVG 可视化"
          isOpen={true}
          onClose={() => setLightboxSvg(null)}
        />
      )}
      </DataState>
    </section>
  );
}

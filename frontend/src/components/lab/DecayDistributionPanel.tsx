"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  RiBarChartGroupedLine,
} from "@remixicon/react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import ImageViewer from "@/components/ui/ImageViewer";
import type { DecayDistributionResponse, FetchState } from "@/lib/api/types";


/** λ → 衰减速度标签 */
function getDecaySpeedLabel(lambda: number): { label: string; tone: string } {
  if (lambda < 0.5) return { label: "快速衰减", tone: "text-warning" };
  if (lambda <= 1.5) return { label: "衰减适中", tone: "text-text-muted" };
  return { label: "缓慢衰减", tone: "text-success" };
}

/** SVG viewBox 和边距常量 */
const VB_W = 700;
const VB_H = 400;
const PAD = { top: 20, right: 30, bottom: 60, left: 50 };
const PLOT_W = VB_W - PAD.left - PAD.right; // 620
const PLOT_H = VB_H - PAD.top - PAD.bottom; // 320
const BAR_GAP = 0.18; // 柱间间隙比例

/**
 * 衰减分布直方图面板。
 * 纯 SVG 垂直柱状图——10 个强度区间 (bin_label)，柱色按中间值线性插值蓝→橙。
 */
export default function DecayDistributionPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<DecayDistributionResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  // ── Lightbox state ──
  const [lightboxSvg, setLightboxSvg] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchDistribution = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.getDecayDistribution();
      setData(result);
      setState(
        result.total_episodes > 0 && result.bins.length > 0 ? "success" : "idle"
      );
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("获取衰减分布失败")
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDistribution();
  }, [fetchDistribution]);


  // ── 柱状图缩放 ──
  function computeBarScales(bins: NonNullable<typeof data>["bins"]) {
    if (!bins || bins.length === 0) return null;
    const maxCount = Math.max(...bins.map((b) => b.count), 1);
    const barCount = bins.length;
    const slotWidth = PLOT_W / barCount;
    const barWidth = slotWidth * (1 - BAR_GAP * 2);

    const scaleX = (index: number) =>
      PAD.left + index * slotWidth + slotWidth * BAR_GAP;
    const scaleY = (count: number) =>
      PAD.top + PLOT_H - (count / maxCount) * PLOT_H;

    return { scaleX, scaleY, barWidth, maxCount };
  }

  // ── 柱色渐变（蓝→橙，按 bin 中值线性插值）──
  function barColor(binLabel: string): string {
    const parts = binLabel.split("-");
    if (parts.length < 2) return "rgb(59,130,246)"; // fallback blue
    const mid = (parseFloat(parts[0]) + parseFloat(parts[1])) / 2;
    // blue(59,130,246) → orange(249,115,22)
    const r = Math.round(59 + mid * (249 - 59));
    const g = Math.round(130 + mid * (115 - 130));
    const b = Math.round(246 + mid * (22 - 246));
    return `rgb(${r},${g},${b})`;
  }

  // ── 坐标轴刻度 ──
  function niceTicks(min: number, max: number, count = 5): number[] {
    if (max <= 0) return [0];
    const step = max / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(step * i));
  }

  const scales = data && data.bins.length > 0 ? computeBarScales(data.bins) : null;

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiBarChartGroupedLine className="w-5 h-5 text-warning shrink-0" />
        <h3 className="text-gm-sm font-semibold text-text">衰减分布</h3>
        <span className="text-gm-xs text-text-muted">
          Ebbinghaus 遗忘曲线 · 共 {data?.total_episodes ?? 0} 条记忆
        </span>
        {state === "success" && (
          <RefreshButton onClick={fetchDistribution} className="ml-auto" />
        )}
      </div>



      <DataState
        state={state}
        error={error}
        onRetry={fetchDistribution}
        loadingMessage="加载衰减分布…"
        loadingIconClassName="text-warning"
        emptyIcon={RiBarChartGroupedLine}
        emptyMessage="暂无衰减数据，创建一些记忆后回来查看"
        isEmpty={
          state === "idle" ||
        (state === "success" && (!data || data.bins.length === 0))
        }
      >
      {/* Success — SVG 柱状图 */}
      {state === "success" && data && scales && data.bins.length > 0 && (
        <div
          className="border-t border-border pt-gm-4"
          style={{ cursor: "zoom-in" }}
          role="img"
          aria-label="衰减分布 SVG 可视化"
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
            {/* 背景网格线（水平） */}
            {niceTicks(0, scales.maxCount).map((tick) => (
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

            {/* Y 轴 */}
            <line
              x1={PAD.left}
              y1={PAD.top}
              x2={PAD.left}
              y2={PAD.top + PLOT_H}
              stroke="var(--gm-text-muted, #94a3b8)"
              strokeWidth="1"
            />

            {/* X 轴 */}
            <line
              x1={PAD.left}
              y1={PAD.top + PLOT_H}
              x2={PAD.left + PLOT_W}
              y2={PAD.top + PLOT_H}
              stroke="var(--gm-text-muted, #94a3b8)"
              strokeWidth="1"
            />

            {/* Y 轴刻度标签 */}
            {niceTicks(0, scales.maxCount).map((tick) => (
              <text
                key={`ty-${tick}`}
                x={PAD.left - 6}
                y={scales.scaleY(tick) + 3}
                textAnchor="end"
                className="fill-text-muted"
                fontSize="9"
              >
                {tick}
              </text>
            ))}

            {/* X 轴刻度标签（旋转 -45° 防重叠） */}
            {data.bins.map((bin, i) => (
              <text
                key={`tx-${bin.bin_label}`}
                x={scales.scaleX(i) + scales.barWidth / 2}
                y={PAD.top + PLOT_H + 12}
                textAnchor="end"
                className="fill-text-muted"
                fontSize="8"
                transform={`rotate(-45, ${scales.scaleX(i) + scales.barWidth / 2}, ${PAD.top + PLOT_H + 12})`}
              >
                {bin.bin_label}
              </text>
            ))}

            {/* 柱 */}
            {data.bins.map((bin, i) => {
              const barTop = scales.scaleY(bin.count);
              const barHeight = PAD.top + PLOT_H - barTop;
              return (
                <g key={bin.bin_label}>
                  <rect
                    data-bar="true"
                    x={scales.scaleX(i)}
                    y={barTop}
                    width={scales.barWidth}
                    height={barHeight > 0 ? barHeight : 0}
                    fill={barColor(bin.bin_label)}
                    opacity="0.85"
                    rx="2"
                  >
                    <title>
                      {bin.bin_label}: {bin.count} 条, 平均强度{" "}
                      {bin.avg_strength.toFixed(3)}
                    </title>
                  </rect>
                </g>
              );
            })}

            {/* λ 衰减常数标注（图下方居中，含叙事标签） */}
            {(() => {
              const speed = getDecaySpeedLabel(data.decay_lambda);
              return (
                <text
                  x={VB_W / 2}
                  y={VB_H - 6}
                  textAnchor="middle"
                  className="fill-text-muted"
                  fontSize="10"
                >
                  λ = {data.decay_lambda.toFixed(4)} · {speed.label}
                </text>
              );
            })()}
          </svg>

          {/* 统计摘要 */}
          <p className="text-gm-xs text-text-muted/70 text-center mt-gm-2">
            共 {data.total_episodes} 条记忆 · {data.bins.length} 个强度区间 · 平均强度{" "}
            {(
              data.bins.reduce((sum, bin) => sum + bin.avg_strength * bin.count, 0) /
              (data.total_episodes || 1)
            ).toFixed(3)}
          </p>
        </div>
      )}

      {/* Lightbox — 点击 SVG 放大查看 */}
      {lightboxSvg && (
        <ImageViewer
          svgHtml={lightboxSvg}
          alt="衰减分布 SVG 可视化"
          isOpen={true}
          onClose={() => setLightboxSvg(null)}
        />
      )}
      </DataState>
    </section>
  );
}

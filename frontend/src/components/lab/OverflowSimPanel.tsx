"use client";

import { useState, useCallback } from "react";
import type { OverflowStrategy } from "@/lib/chatParams";
import {
  RiFlaskLine,
  RiLoader4Line,
  RiCheckLine,
  RiCloseLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import { WindowSizeInput } from "@/components/ui/WindowSizeInput";
import type { OverflowSimResponse, FetchState } from "@/lib/api/types";

/** 溢出策略 → 标签映射（与 ParamSliders OVERFLOW_LABELS 一致） */
const OVERFLOW_LABELS: Record<OverflowStrategy, string> = {
  truncate: "FIFO 截断旧记忆",
  prioritize: "按得分保留",
  summarize: "压缩旧记忆为摘要",
};

/**
 * 上下文溢出模拟面板。
 * 输入模拟参数 → 调用 api.simulateOverflow() → 展示溢出结果。
 */
export default function OverflowSimPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<OverflowSimResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  // 表单状态
  const [strategy, setStrategy] = useState<OverflowStrategy>("prioritize");
  const [windowSize, setWindowSize] = useState(4096);
  const [userInput, setUserInput] = useState("");

  // ── 即时 tooltip state — 替代原生 title 属性延迟 ──
  const [tooltipState, setTooltipState] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const fetchSimulation = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.simulateOverflow({
        strategy,
        window_size: windowSize,
        user_input: userInput || undefined,
      });
      setData(result);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("模拟失败"));
      setState("error");
    }
  }, [strategy, windowSize, userInput]);

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiFlaskLine className="w-5 h-5 text-brand" />
        <h3 className="text-gm-sm font-semibold text-text">上下文溢出模拟</h3>
        <span className="text-gm-xs text-text-muted">
          模拟上下文窗口溢出，观察各策略效果
        </span>
      </div>

      {/* ── 实验参数卡 ── */}
      <div className="rounded-gm-sm border border-border bg-surface-alt/50 p-gm-4 mb-gm-4">
        <h4 className="text-gm-xs font-semibold text-text-secondary mb-gm-3 uppercase tracking-wider">
          实验参数
        </h4>

        {/* 溢出策略 */}
        <div className="mb-gm-3">
          <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
            溢出策略
          </label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as OverflowStrategy)}
            className="w-full rounded-gm-xs border border-border bg-surface-elevated
                       px-gm-2 py-gm-1.5 text-gm-sm text-text
                       focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          >
            {(Object.keys(OVERFLOW_LABELS) as OverflowStrategy[]).map((s) => (
              <option key={s} value={s}>
                {OVERFLOW_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        {/* 窗口大小 — combo box */}
        <div className="mb-gm-3">
          <WindowSizeInput value={windowSize} onChange={setWindowSize} />
        </div>

        {/* 用户输入 — 大文本域 */}
        <div className="mb-gm-3">
          <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
            用户输入（可选，用于 token 估算）
          </label>
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="输入一段文本模拟用户消息…"
            rows={5}
            className="w-full rounded-gm-xs border border-border bg-surface-alt
                       px-gm-2 py-gm-1.5 text-gm-sm text-text
                       placeholder:text-text-muted/50
                       focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30
                       resize-y min-h-[80px]"
          />
        </div>

        {/* 运行按钮 — 全宽 */}
        <button
          onClick={fetchSimulation}
          disabled={state === "loading"}
          className="w-full rounded-gm-sm bg-brand px-gm-4 py-gm-2 text-gm-sm
                     font-medium text-white hover:bg-brand-600 transition-all focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none active:scale-[0.98]
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === "loading" ? (
            <span className="flex items-center justify-center gap-gm-1">
              <RiLoader4Line className="w-4 h-4 animate-spin" />
              模拟中…
            </span>
          ) : (
            "运行模拟"
          )}
        </button>
      </div>

      <DataState
        state={state}
        error={error}
        onRetry={fetchSimulation}
        loadingMessage="运行溢出模拟…"
        loadingIconClassName="text-brand"
        emptyIcon={RiFlaskLine}
        emptyMessage="调整参数后点击「运行模拟」查看溢出效果"
        isEmpty={state === "idle"}
      >
      {state === "success" && data && (
        <div className="border-t border-border pt-gm-4">
          {/* 摘要行 */}
          <div className="flex items-center gap-gm-3 mb-gm-4">
            <p className="text-gm-sm font-medium text-text">
              {data.summary_line}
            </p>
            {data.overflow_triggered ? (
              <span className="inline-flex items-center gap-gm-1 rounded-full bg-danger/10 border border-danger/20 px-gm-2 py-px text-gm-xs text-danger font-medium">
                <RiCloseLine className="w-3.5 h-3.5" />
                已溢出
              </span>
            ) : (
              <span className="inline-flex items-center gap-gm-1 rounded-full bg-success/10 border border-success/20 px-gm-2 py-px text-gm-xs text-success font-medium">
                <RiCheckLine className="w-3.5 h-3.5" />
                未溢出
              </span>
            )}
          </div>

          {/* 指标卡片 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-gm-3 mb-gm-4">
            <div className="rounded-gm-xs border border-border bg-surface-alt px-gm-3 py-gm-2 text-center">
              <p className="text-gm-xs text-text-muted">使用率</p>
              <p className="text-gm-lg font-semibold text-text tabular-nums">
                {data.usage_pct.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-gm-xs border border-border bg-surface-alt px-gm-3 py-gm-2 text-center">
              <p className="text-gm-xs text-text-muted">浪费 token</p>
              <p className="text-gm-lg font-semibold text-warning tabular-nums">
                {data.wasted_tokens}
              </p>
            </div>
            <div className="rounded-gm-xs border border-border bg-surface-alt px-gm-3 py-gm-2 text-center">
              <p className="text-gm-xs text-text-muted">可用 token</p>
              <p className="text-gm-lg font-semibold text-success tabular-nums">
                {data.available_tokens}
              </p>
            </div>
          </div>

          {/* 保留/丢弃 记忆列表 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-gm-4">
            {/* 保留 */}
            <div>
              <h4 className="text-gm-xs font-semibold text-success mb-gm-2">
                保留的记忆 ({data.memories_after})
              </h4>
              {data.kept_items.length === 0 ? (
                <p className="text-gm-xs text-text-muted italic">
                  无保留记忆（窗口可能全部空闲或溢出模拟无回忆数据）
                </p>
              ) : (
                <ul className="space-y-gm-1">
                  {data.kept_items.slice(0, 20).map((item, i) => (
                    <li
                      key={i}
                      className="text-gm-xs text-text-secondary bg-surface-alt rounded-gm-xs px-gm-2 py-gm-1 truncate"
                      onMouseEnter={(e) =>
                        setTooltipState({
                          x: e.clientX,
                          y: e.clientY,
                          text: typeof item.content === "string"
                            ? item.content
                            : String(item.content),
                        })
                      }
                      onMouseMove={(e) =>
                        setTooltipState((prev) =>
                          prev ? { ...prev, x: e.clientX, y: e.clientY } : null,
                        )
                      }
                      onMouseLeave={() => setTooltipState(null)}
                    >
                      {typeof item.content === "string"
                        ? item.content.slice(0, 80)
                        : String(item.content).slice(0, 80)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 丢弃 */}
            <div>
              <h4 className="text-gm-xs font-semibold text-danger mb-gm-2">
                丢弃的记忆 ({data.dropped_count})
              </h4>
              {data.dropped_items.length === 0 ? (
                <p className="text-gm-xs text-text-muted italic">
                  无丢弃记忆
                </p>
              ) : (
                <ul className="space-y-gm-1">
                  {data.dropped_items.map((item, i) => (
                    <li
                      key={i}
                      className="text-gm-xs text-text-muted bg-danger/5 rounded-gm-xs px-gm-2 py-gm-1 truncate"
                    >
                      {item.slice(0, 80)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      </DataState>

      {/* 即时 tooltip — 替代原生 title 延迟 */}
      {tooltipState && (
        <div
          className="fixed z-50 rounded-gm-sm border border-border-strong
                     bg-surface-elevated px-gm-2.5 py-gm-1.5
                     shadow-gm-md pointer-events-none max-w-xs"
          style={{
            left: tooltipState.x + 12,
            top: tooltipState.y - 8,
          }}
        >
          <p className="text-gm-xs text-text break-words">{tooltipState.text}</p>
        </div>
      )}
    </section>
  );
}

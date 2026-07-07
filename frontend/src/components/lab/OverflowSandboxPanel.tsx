"use client";

import { useState, useCallback, useMemo, type ComponentType } from "react";
import {
  RiFlaskLine,
  RiLoader4Line,
  RiCheckLine,
  RiCloseLine,
  RiFileEditLine,
  RiFileReduceLine,
  RiQuestionLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import type {
  CompareStrategiesResponse,
  OverflowSimResponse,
  FetchState,
} from "@/lib/api/types";

// ── Types ─────────────────────────────────────────────────────

interface SandboxItem {
  id: string;
  content: string;
  score: number;
  kind: "episode" | "fact";
}

interface PresetOption {
  label: string;
  desc: string;
  items: SandboxItem[];
}

// ── Presets — crafted to reveal strategy differences ──────────

const PRESETS: PresetOption[] = [
  {
    label: "日常对话",
    desc: "相关度参差不齐的日常聊天记忆",
    items: [
      { id: "m1", content: "用户想买台新电脑，预算 8000 左右", score: 0.95, kind: "episode" },
      { id: "m2", content: "这周末打算和女朋友去爬山", score: 0.80, kind: "episode" },
      { id: "m3", content: "用户是后端开发，工作 5 年了", score: 0.85, kind: "fact" },
      { id: "m4", content: "昨天吃了顿火锅，觉得味道一般", score: 0.30, kind: "episode" },
      { id: "m5", content: "上周看的电影特效很不错", score: 0.20, kind: "episode" },
      { id: "m6", content: "邻居家的狗每天早上很吵", score: 0.15, kind: "episode" },
    ],
  },
  {
    label: "事实密集",
    desc: "全部高置信度的事实陈述，窗口无法全容纳",
    items: [
      { id: "f1", content: "用户居住在上海市浦东新区", score: 0.95, kind: "fact" },
      { id: "f2", content: "用户生日是 1990 年 8 月 15 日", score: 0.92, kind: "fact" },
      { id: "f3", content: "用户目前在字节跳动做后端开发", score: 0.90, kind: "fact" },
      { id: "f4", content: "用户精通 Go 和 Python 语言", score: 0.88, kind: "fact" },
      { id: "f5", content: "用户最近在学 Kubernetes 和 Docker", score: 0.85, kind: "fact" },
      { id: "f6", content: "用户早上 9 点上班、晚上 6 点下班", score: 0.82, kind: "fact" },
      { id: "f7", content: "用户已婚，有一个 3 岁的女儿", score: 0.80, kind: "fact" },
      { id: "f8", content: "用户每周去两次健身房", score: 0.78, kind: "fact" },
    ],
  },
  {
    label: "长尾低分",
    desc: "大量低相关度记忆，强推溢出",
    items: Array.from({ length: 20 }, (_, i) => ({
      id: `l${i}`,
      content: `闲聊话题 ${i + 1}：${["天气不错", "午饭吃了面", "地铁很挤", "昨晚失眠", "手机没电了", "周末想出去玩", "新买了个杯子", "咖啡喝多了", "股票跌了", "楼下装修很吵", "想换个椅子", "狗子生病了", "空调制冷差", "最近在追剧", "想学做菜", "朋友结婚了", "公积金调整了", "快递还没到", "小区停水了", "今天特别困"][i]}`,
      score: +(Math.random() * 0.4 + 0.1).toFixed(2), // 0.1–0.5
      kind: "episode" as const,
    })),
  },
  {
    label: "混合内容",
    desc: "长短 mix + episode/fact 混合",
    items: [
      { id: "h1", content: "用户的核心技术栈是 Go/Python/K8s", score: 0.92, kind: "fact" },
      { id: "h2", content: "用户说最近项目压测遇到性能瓶颈，主要在数据库查询优化上", score: 0.88, kind: "episode" },
      { id: "h3", content: "去年团队从 PHP 迁到 Go，整体性能提升了 3 倍", score: 0.75, kind: "episode" },
      { id: "h4", content: "用户今年目标是读完 12 本技术书", score: 0.70, kind: "fact" },
      { id: "h5", content: "昨天加班到 11 点修了一个线上 Bug", score: 0.45, kind: "episode" },
      { id: "h6", content: "周末看了《奥本海默》", score: 0.25, kind: "episode" },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────

/** 将 SandboxItem 转换为后端 API 期望的 recalled 格式。 */
function toRecalled(items: SandboxItem[]): Array<Record<string, unknown>> {
  return items.map((item) => {
    if (item.kind === "fact") {
      return {
        _row_type: "fact",
        content: item.content,
        confidence: item.score,
      };
    }
    return {
      _row_type: "episode",
      content: item.content,
      initial_strength: item.score,
      importance: 1.0,
    };
  });
}

/** 检查某条记忆内容在策略结果中是否被保留。 */
function wasKept(content: string, result: OverflowSimResponse): boolean {
  return result.kept_items.some(
    (k) =>
      typeof k.content === "string" && k.content.includes(content.slice(0, 40)),
  );
}

/** 检查某条记忆内容在策略结果中是否被显示丢弃。 */
function wasDropped(content: string, result: OverflowSimResponse): boolean {
  return result.dropped_items.some(
    (d: string) => content.includes(d.slice(0, 20)) || d.includes(content.slice(0, 20)),
  );
}

// ── Cell Status ───────────────────────────────────────────────

type CellStatus = "kept" | "dropped" | "summarized" | "unknown";

function getCellStatus(
  itemContent: string,
  strategy: string,
  result: OverflowSimResponse,
): CellStatus {
  if (wasKept(itemContent, result)) return "kept";
  if (wasDropped(itemContent, result)) return "dropped";
  if (strategy === "summarize" && result.overflow_triggered) return "summarized";
  return "dropped";
}

// ── Component ─────────────────────────────────────────────────

const STRATEGY_META = [
  { key: "truncate", label: "FIFO 截断", color: "text-info" },
  { key: "prioritize", label: "相关度优先", color: "text-success" },
  { key: "summarize", label: "压缩摘要", color: "text-accent" },
] as const;

const CELL_RENDER: Record<CellStatus, { Icon: ComponentType<{ className?: string }>; className: string; label: string }> = {
  kept: { Icon: RiCheckLine, className: "text-success bg-success/10", label: "保留" },
  dropped: { Icon: RiCloseLine, className: "text-danger bg-danger/10", label: "丢弃" },
  summarized: { Icon: RiFileReduceLine, className: "text-accent bg-accent/10", label: "摘要" },
  unknown: { Icon: RiQuestionLine, className: "text-text-muted bg-surface-alt", label: "未知" },
};

/**
 * 溢出策略对比沙箱面板。
 *
 * 用户可以切换预设记忆数据集，调整窗口大小和用户输入，
 * 运行三种溢出策略的并排对比，以矩阵形式可视化每条记忆被各策略如何处理。
 */
export default function OverflowSandboxPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<CompareStrategiesResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  // 表单状态
  const [presetIndex, setPresetIndex] = useState(0);
  const [windowSize, setWindowSize] = useState(4096);
  const [userInput, setUserInput] = useState("");

  const currentPreset = PRESETS[presetIndex];
  const items = currentPreset.items;

  const runComparison = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await api.compareStrategies({
        recalled: toRecalled(items),
        window_size: windowSize,
        user_input: userInput || undefined,
      });
      setData(result);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("对比失败"));
      setState("error");
    }
  }, [items, windowSize, userInput]);

  // 统计摘要
  const summary = useMemo(() => {
    if (!data) return null;
    const entries = STRATEGY_META.map(({ key, label }) => {
      const r = data[key];
      return {
        label,
        key,
        kept: r.memories_after,
        total: r.memories_before,
        usagePct: r.usage_pct,
        wasted: r.wasted_tokens,
        overflowTriggered: r.overflow_triggered,
      };
    });
    return entries;
  }, [data]);

  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* ── Header ── */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiFlaskLine className="w-5 h-5 text-brand" />
        <h3 className="text-gm-sm font-semibold text-text">溢出策略沙箱</h3>
        <span className="text-gm-xs text-text-muted">
          自定义记忆数据 → 三种策略如何处理？
        </span>
      </div>

      {/* ── Preset Selector ── */}
      <div className="mb-gm-4">
        <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
          预设数据集
        </label>
        <div className="flex flex-wrap gap-gm-2">
          {PRESETS.map((preset, i) => (
            <button
              key={preset.label}
              onClick={() => {
                setPresetIndex(i);
                setData(null);
                setState("idle");
              }}
              aria-pressed={i === presetIndex}
              className={`rounded-gm-xs px-gm-3 py-gm-1 text-gm-xs font-medium transition-colors ${
                i === presetIndex
                  ? "bg-brand text-white"
                  : "bg-surface-alt text-text-secondary hover:bg-surface-alt/80 border border-border"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="text-gm-xs text-text-muted mt-gm-1">{currentPreset.desc}</p>
      </div>

      {/* ── Memory Items Preview ── */}
      <div className="mb-gm-4">
        <div className="flex items-center justify-between mb-gm-2">
          <span className="text-gm-xs font-medium text-text-secondary">
            记忆数据（{items.length} 条）
          </span>
          <span className="text-gm-xs text-text-muted flex items-center gap-gm-1">
            <RiFileEditLine className="w-3 h-3" />
            切换预设更换数据
          </span>
        </div>
        <div className="rounded-gm-xs border border-border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[3.5rem_1fr_4.5rem] gap-0 bg-surface-alt border-b border-border text-gm-xs font-medium text-text-muted">
            <div className="px-gm-2 py-gm-1 text-center">得分</div>
            <div className="px-gm-2 py-gm-1">内容</div>
            <div className="px-gm-2 py-gm-1 text-center">类型</div>
          </div>
          {/* Items */}
          {items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[3.5rem_1fr_4.5rem] gap-0 border-b border-border last:border-b-0 text-gm-xs"
            >
              <div className="px-gm-2 py-gm-1 text-center tabular-nums text-text font-medium">
                {item.score.toFixed(2)}
              </div>
              <div
                className="px-gm-2 py-gm-1 text-text-secondary truncate"
                title={item.content}
              >
                {item.content}
              </div>
              <div className="px-gm-2 py-gm-1 text-center">
                <span
                  className={`inline-block rounded-gm-xs px-gm-1.5 py-px text-gm-xs font-medium ${
                    item.kind === "fact"
                      ? "bg-info/10 text-info"
                      : "bg-surface-alt text-text-muted"
                  }`}
                >
                  {item.kind === "fact" ? "事实" : "对话"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-gm-3 mb-gm-4">
        {/* Window size */}
        <div>
          <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
            窗口大小: {windowSize} tokens
          </label>
          <input
            type="range"
            min={256}
            max={8192}
            step={256}
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
            className="gm-slider w-full"
          />
          <div className="flex justify-between text-gm-xs text-text-muted mt-gm-0.5">
            <span>256</span>
            <span>8192</span>
          </div>
        </div>

        {/* User input */}
        <div>
          <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
            用户输入（可选）
          </label>
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="输入一段文本模拟用户消息…"
            rows={2}
            className="w-full rounded-gm-xs border border-border bg-surface-alt
                       px-gm-2 py-gm-1.5 text-gm-sm text-text
                       placeholder:text-text-muted/50
                       focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30
                       resize-none"
          />
        </div>

        {/* Run button */}
        <div className="flex items-end">
          <button
            onClick={runComparison}
            disabled={state === "loading"}
            className="w-full rounded-gm-sm bg-brand px-gm-4 py-gm-1.5 text-gm-sm
                       font-medium text-white hover:bg-brand-600 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state === "loading" ? (
              <span className="flex items-center justify-center gap-gm-1">
                <RiLoader4Line className="w-4 h-4 animate-spin" />
                对比中…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-gm-1">
                <RiFlaskLine className="w-4 h-4" />
                运行对比
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Results ── */}
      <DataState
        state={state}
        error={error}
        onRetry={runComparison}
        loadingMessage="运行三种策略对比…"
        loadingIconClassName="text-brand"
        emptyIcon={RiFlaskLine}
        emptyMessage="选择预设数据后点击「运行对比」查看三种策略的差异"
        isEmpty={state === "idle"}
      >
        {state === "success" && data && (
          <div className="border-t border-border pt-gm-4 space-y-gm-4">
            {/* Comparison Matrix */}
            <div>
              <h4 className="text-gm-xs font-semibold text-text mb-gm-2">
                逐条对比
              </h4>
              <div className="rounded-gm-xs border border-border overflow-x-auto">
                {/* Table header */}
                <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(4.5rem,1fr))] gap-0 bg-surface-alt border-b border-border text-gm-xs font-medium">
                  <div className="px-gm-2 py-gm-1.5 text-text-muted">
                    记忆内容
                  </div>
                  {STRATEGY_META.map((s) => (
                    <div
                      key={s.key}
                      className={`px-gm-2 py-gm-1.5 text-center ${s.color}`}
                    >
                      {s.label}
                    </div>
                  ))}
                </div>
                {/* Rows */}
                {items.map((item) => {
                  return (
                    <div
                      key={item.id}
                      className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(4.5rem,1fr))] gap-0 border-b border-border last:border-b-0 text-gm-xs"
                    >
                      {/* Item content */}
                      <div className="px-gm-2 py-gm-1 flex items-center gap-gm-1.5">
                        <span
                          className={`inline-block min-w-[2rem] text-center text-gm-xs font-medium tabular-nums rounded-gm-xs px-gm-0.5 ${
                            item.score >= 0.7
                              ? "text-success"
                              : item.score >= 0.4
                                ? "text-warning"
                                : "text-text-muted"
                          }`}
                        >
                          {item.score.toFixed(2)}
                        </span>
                        <span
                          className="truncate text-text-secondary"
                          title={item.content}
                        >
                          {item.content}
                        </span>
                      </div>
                      {/* Per-strategy cell */}
                      {STRATEGY_META.map((s) => {
                        const status = getCellStatus(item.content, s.key, data[s.key]);
                        const { Icon, className: cellClassName, label } = CELL_RENDER[status];
                        return (
                          <div
                            key={s.key}
                            className={`px-gm-2 py-gm-1 text-center ${cellClassName} flex items-center justify-center gap-gm-1`}
                            title={`${s.label}: ${label}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span className="text-gm-xs hidden sm:inline">
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary Cards */}
            <div>
              <h4 className="text-gm-xs font-semibold text-text mb-gm-2">
                策略指标对比
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-gm-3">
                {summary?.map((s) => (
                  <div
                    key={s.key}
                    className="rounded-gm-xs border border-border bg-surface-alt p-gm-3"
                  >
                    <div className="flex items-center justify-between mb-gm-2">
                      <span className="text-gm-sm font-semibold text-text">
                        {s.label}
                      </span>
                      {s.overflowTriggered ? (
                        <span className="inline-flex items-center gap-gm-0.5 rounded-full bg-danger/10 px-gm-1.5 py-px text-gm-xs text-danger font-medium">
                          <RiCloseLine className="w-3 h-3" />
                          溢出
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-gm-0.5 rounded-full bg-success/10 px-gm-1.5 py-px text-gm-xs text-success font-medium">
                          <RiCheckLine className="w-3 h-3" />
                          未溢出
                        </span>
                      )}
                    </div>
                    <div className="space-y-gm-1">
                      <div className="flex justify-between text-gm-xs">
                        <span className="text-text-muted">保留/总计</span>
                        <span className="text-text font-medium tabular-nums">
                          {s.kept}/{s.total}
                        </span>
                      </div>
                      <div className="flex justify-between text-gm-xs">
                        <span className="text-text-muted">使用率</span>
                        <span className="text-text font-medium tabular-nums">
                          {s.usagePct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-gm-xs">
                        <span className="text-text-muted">浪费 token</span>
                        <span
                          className={`font-medium tabular-nums ${
                            s.wasted > 0 ? "text-warning" : "text-success"
                          }`}
                        >
                          {s.wasted.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Teaching note */}
            <div className="rounded-gm-xs bg-info/5 border border-info/20 px-gm-4 py-gm-3">
              <p className="text-gm-xs text-text-secondary leading-relaxed">
                <strong className="text-text">💡 关键观察：</strong>
                FIFO 截断按时间顺序保留最早的，不关心内容质量；
                相关度优先总是保留高得分项，但可能丢掉时间线连续性；
                压缩摘要在保留高价值内容的同时尽力保留信息完整性，但摘要会丢失细节。
                同一条记忆在不同策略下的命运不同 —— 选择策略就是在选择&ldquo;记住什么、忘掉什么&rdquo;。
              </p>
            </div>
          </div>
        )}
      </DataState>
    </section>
  );
}

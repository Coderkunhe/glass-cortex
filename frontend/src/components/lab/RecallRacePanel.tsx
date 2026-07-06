"use client";

import { RiSearchLine, RiCheckLine, RiCloseLine } from "@remixicon/react";
import MermaidDiagram from "@/components/ui/MermaidDiagram";

/** 三条检索路线的对比数据 — 固定示例，不依赖后端 */
const ROUTES = [
  {
    key: "semantic" as const,
    label: "语义检索",
    subtitle: "Embedding → FAISS 向量搜索",
    emoji: "🔢",
    principle:
      "将查询编码为 768 维向量，在高维空间中找最相似的记忆——理解「意思」而非「原话」。",
    strengths: ["同义词/近义表达自动匹配", "不依赖精确拼写", "对新语言表达泛化好"],
    weaknesses: ["罕见实体名易误匹配", "代码片段/URL 区分度低", "依赖 embedding 模型质量"],
    results: [
      { content: "我最近在写那个 Python 数据分析项目，用 pandas 做清洗…", score: 0.92, relevant: true },
      { content: "Python 3.14 发布了新的模式匹配语法…", score: 0.87, relevant: false },
      { content: "项目需要支持 CSV 和 JSON 两种输入格式…", score: 0.84, relevant: true },
    ],
  },
  {
    key: "keyword" as const,
    label: "关键词检索",
    subtitle: "BM25 / FTS 倒排索引",
    emoji: "📝",
    principle:
      "精确匹配查询中的实体名、术语——不在乎「意思」，只在乎「这个词出现过没有」。",
    strengths: ["实体名/代码片段一击即中", "对拼写敏感=高精度", "延迟极低（倒排索引）"],
    weaknesses: ["同义词完全盲区", "不会理解语义近似", "对拼写错误零容忍"],
    results: [
      { content: "项目代号是 GlassCortex，Python + FastAPI 栈…", score: 0.95, relevant: true },
      { content: "Python 项目部署到 AWS Lambda 上的配置…", score: 0.85, relevant: true },
      { content: "我写了个 Python 脚本处理日志，和项目无关…", score: 0.72, relevant: false },
    ],
  },
  {
    key: "hybrid" as const,
    label: "MMR 混合",
    subtitle: "语义 + 关键词 + 图遍历 → MMR 重排",
    emoji: "⚖️",
    principle:
      "三条路线并跑 → 候选合并 → MMR 贪心重排：λ=0.7 平衡相关性与多样性，确保结果「既准又多样」。",
    strengths: ["三条路线盲区互相覆盖", "MMR 确保多样性", "来源可追溯（每条标注路线）"],
    weaknesses: ["延迟 = 三条路线中最慢的", "需要更多基础设施", "λ 调参是艺术不是科学"],
    results: [
      { content: "GlassCortex 项目目前用 Python + FastAPI，代号 GC…", score: 0.94, relevant: true },
      { content: "我最近在写那个 Python 数据分析项目，用 pandas 做清洗…", score: 0.88, relevant: true },
      { content: "团队讨论过用 Rust 重写核心引擎…", score: 0.81, relevant: true },
    ],
  },
] as const;

/** MMR 流水线 mermaid 图 — 三条路线 → 合并 → MMR → 输出 */
const HYBRID_PIPELINE_CHART = `graph LR
    Q["🔍 查询<br/>'Python 项目叫什么？'"]
    Q --> S["🔢 语义路线<br/>Embedding → FAISS<br/>top-50"]
    Q --> K["📝 关键词路线<br/>实体识别 → BM25<br/>top-20"]
    Q --> G["🕸️ 图遍历<br/>1-hop → 2-hop<br/>关联节点"]
    S --> MERGE["🔀 候选合并<br/>去重 → 综合评分<br/>score = sim × 强度 × 重要性"]
    K --> MERGE
    G --> MERGE
    MERGE --> MMR["⚖️ MMR 重排<br/>λ×相关性 + (1-λ)×多样性<br/>贪心 top_k"]
    MMR --> OUT["✅ 最终结果<br/>既准又多样"]`;

/**
 * 召回竞赛面板。
 * 固定示例数据展示三条检索路线（语义/关键词/MMR 混合）并排对比，
 * 让用户直观理解混合检索策略的权衡。纯前端面板，无 API 依赖。
 */
export default function RecallRacePanel() {
  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiSearchLine className="w-5 h-5 text-brand" />
        <h3 className="text-gm-sm font-semibold text-text">召回竞赛</h3>
        <span className="text-gm-xs text-text-muted">
          同一查询 → 三条检索路线并排对比
        </span>
      </div>

      {/* 固定示例查询 */}
      <div className="rounded-gm-sm bg-surface-alt border border-border px-gm-3 py-gm-2 mb-gm-5">
        <span className="text-gm-xs text-text-muted mr-gm-1.5">示例查询：</span>
        <span className="text-gm-sm text-text font-medium">
          &quot;我之前说的那个 Python 项目叫什么来着？&quot;
        </span>
      </div>

      {/* 三列卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-gm-3 mb-gm-5">
        {ROUTES.map((route) => (
          <div
            key={route.key}
            className={`rounded-gm-sm border-2 p-gm-4 ${
              route.key === "hybrid"
                ? "border-brand/40 bg-brand/[0.03] ring-1 ring-brand/30"
                : "border-border bg-surface-alt"
            }`}
          >
            {/* 卡片头 */}
            <div className="flex items-center gap-gm-1.5 mb-gm-2">
              <span className="text-lg" aria-hidden>
                {route.emoji}
              </span>
              <span className="text-gm-sm font-semibold text-text">
                {route.label}
              </span>
              {route.key === "hybrid" && (
                <span className="inline-flex items-center rounded-full bg-brand/15 text-brand text-gm-xs font-medium px-gm-1.5 py-px">
                  <RiCheckLine className="w-3 h-3 mr-gm-0_5" />
                  推荐
                </span>
              )}
            </div>
            <p className="text-gm-xs text-text-muted mb-gm-2">{route.subtitle}</p>

            {/* 原理一句话 */}
            <p className="text-gm-xs text-text-secondary leading-relaxed mb-gm-3">
              {route.principle}
            </p>

            {/* 强项/弱项 */}
            <div className="space-y-gm-2 mb-gm-3">
              <div>
                <span className="text-gm-xs font-medium text-success">强项</span>
                <ul className="mt-gm-0.5 space-y-gm-0.5">
                  {route.strengths.map((s, i) => (
                    <li
                      key={i}
                      className="text-gm-xs text-text-secondary flex items-start gap-gm-1"
                    >
                      <RiCheckLine className="w-3 h-3 text-success mt-gm-0_5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="text-gm-xs font-medium text-danger">盲区</span>
                <ul className="mt-gm-0.5 space-y-gm-0.5">
                  {route.weaknesses.map((w, i) => (
                    <li
                      key={i}
                      className="text-gm-xs text-text-secondary flex items-start gap-gm-1"
                    >
                      <RiCloseLine className="w-3 h-3 text-danger mt-gm-0_5 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 示例结果 */}
            <div className="border-t border-border-light pt-gm-2">
              <span className="text-gm-xs font-medium text-text-muted block mb-gm-1.5">
                本查询结果示例
              </span>
              <ul className="space-y-gm-1.5">
                {route.results.map((r, i) => (
                  <li
                    key={i}
                    className={`text-gm-xs px-gm-1.5 py-gm-1 rounded-gm-xs flex items-start gap-gm-1 ${
                      r.relevant
                        ? "bg-success/5 border border-success/20"
                        : "bg-danger/5 border border-danger/20"
                    }`}
                  >
                    {r.relevant ? (
                      <RiCheckLine className="w-3 h-3 text-success mt-px shrink-0" />
                    ) : (
                      <RiCloseLine className="w-3 h-3 text-danger mt-px shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="text-text-secondary leading-snug">
                        {r.content}
                      </span>
                      <span className="text-text-muted/60 ml-gm-1 tabular-nums">
                        {r.score.toFixed(2)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {/* MMR 流水线示意图 */}
      <div className="border-t border-border pt-gm-4">
        <h4 className="text-gm-xs font-semibold text-text-secondary mb-gm-2">
          混合检索流水线
        </h4>
        <MermaidDiagram
          chart={HYBRID_PIPELINE_CHART}
          title="混合检索流水线"
          className="mx-auto"
        />
        <p className="text-gm-xs text-text-muted/70 mt-gm-2 text-center">
          代码入口：<code className="text-gm-xs bg-surface-alt px-gm-1 rounded-gm-xs">src/memory/recall.py</code> — RecallEngine.recall() + mmr_rerank()
        </p>
      </div>
    </section>
  );
}

/**
 * ProcessDrawer — LLM 调用档案抽屉组件。
 *
 * 从 DrawerContext 获取当前选中的 API trace，以侧滑抽屉展示完整的
 * LLM 调用链路：请求参数、模型响应、意图解析和 Token 消耗统计。
 * 通过 DrawerContext 与 ChatMessage 中的 IntentPill 联动打开。
 *
 * @module components/chat/ProcessDrawer
 */

"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { RiCloseLine, RiSearchLine, RiShareBoxLine, RiDownloadLine, RiFileListLine, RiHashtag, RiErrorWarningLine, RiGitBranchLine } from "@remixicon/react";
import { useDrawer } from "./DrawerContext";
import Drawer from "@/components/ui/Drawer";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { KVRow } from "@/components/ui/KVRow";
import { formatAsPython, formatAsJson, reprTruncated } from "@/lib/code-format";
import MermaidDiagram from "@/components/ui/MermaidDiagram";
import Prism from "@/lib/prism";
import { createRoot, type Root } from "react-dom/client";
import { CopyButton } from "@/components/ui/CopyButton";
import type { ApiTrace } from "@/lib/api/types";
import { getExtra, getExtraString } from "@/lib/getExtra";

// ── Constants ──────────────────────────────────────────────────────────

const DRAWER_MAX_WIDTH = 520;
const DRAWER_ANIMATION_DURATION_MS = 600;
const CODE_SNIPPET_TRUNCATION_LENGTH = 80;

/** Generates a synthetic Python OpenAI SDK call from ApiTrace data, for educational display. */
function generatePythonRequestCode(trace: ApiTrace): string {
  const systemPrompt = (getExtra(trace, "system_prompt") as string) ?? "";
  const userPrompt = (getExtra(trace, "user_prompt") as string) ?? "";

  const lines: string[] = [];
  lines.push("from openai import OpenAI");
  lines.push("");
  lines.push("client = OpenAI(");
  lines.push('    api_key="sk-...",');
  lines.push(")");
  lines.push("");
  lines.push("response = client.chat.completions.create(");
  lines.push(`    model="${trace.model}",`);

  const messages: string[] = [];
  if (systemPrompt) {
    messages.push(`        {"role": "system", "content": ${reprTruncated(systemPrompt)}},`);
  }
  if (userPrompt) {
    messages.push(`        {"role": "user", "content": ${reprTruncated(userPrompt)}},`);
  }
  if (messages.length === 0) {
    messages.push('        {"role": "user", "content": "..."},');
  }
  lines.push("    messages=[");
  lines.push(...messages);
  lines.push("    ],");
  lines.push(`    temperature=${trace.temperature},`);
  lines.push(`    max_tokens=${trace.max_tokens},`);
  lines.push(")");

  return lines.join("\n");
}

/** Generates Python code representing the standalone classifier (Planner) API call. */
function generateClassifierRequestCode(
  model: string,
  systemPrompt: string,
  userPrompt: string,
): string {
  const lines: string[] = [];
  lines.push("# 独立分类器调用 — 将用户消息分类为 5 种意图");
  lines.push("classify_response = client.chat.completions.create(");
  lines.push(`    model="${model}",`);
  lines.push("    messages=[");
  if (systemPrompt) {
    lines.push(`        {"role": "system", "content": ${reprTruncated(systemPrompt, CODE_SNIPPET_TRUNCATION_LENGTH)}},`);
  }
  lines.push(`        {"role": "user", "content": ${reprTruncated(userPrompt, CODE_SNIPPET_TRUNCATION_LENGTH)}},`);
  lines.push("    ],");
  lines.push("    # temperature / max_tokens 由 planner 配置控制");
  lines.push(")");

  return lines.join("\n");
}

/** Build a Mermaid flowchart TD string from plan DAG data in trace extras. */
function buildPlanDAGChart(trace: ApiTrace): string {
  const subtasks = (getExtra(trace, "plan_subtasks") as Array<Record<string, unknown>>) ?? [];
  const edges = (getExtra(trace, "plan_dag_edges") as Array<[string, string]>) ?? [];

  if (subtasks.length === 0) return "flowchart TD\n  empty[\"无任务分解数据\"]";

  const lines: string[] = ["flowchart TD"];
  // 节点定义：使用安全的 id 前缀避免 mermaid 解析问题
  for (const t of subtasks) {
    const id = String(t.id ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const desc = String(t.description ?? "").replace(/"/g, "'").slice(0, 40);
    lines.push(`  n${id}["${desc}"]`);
  }
  // 边：前置任务 → 当前任务
  for (const [from, to] of edges) {
    const fId = String(from).replace(/[^a-zA-Z0-9_-]/g, "_");
    const tId = String(to).replace(/[^a-zA-Z0-9_-]/g, "_");
    lines.push(`  n${fId} --> n${tId}`);
  }

  return lines.join("\n");
}

// ── Sub-components ──────────────────────────────────────────────────

/** Shared layout — prevents overflow on both pre and code.
 *  Inline style beats Prism's code[class*="language-"] { white-space: pre }. */
const CODE_LAYOUT: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  wordBreak: "break-word",
};

/**
 * Pre-compute Prism syntax highlighting during React render.
 * Returns highlighted HTML string, or plain text if language is unsupported.
 * This avoids the timing gap between Drawer mount and useEffect DOM mutation —
 * the highlighted HTML is in the DOM from the first paint.
 */
function highlightCode(code: string, language?: string): string {
  if (!language || !code) return code;
  const lang = language.replace("language-", "");
  if (!lang || !Prism.languages[lang]) return code;
  try {
    return Prism.highlight(code, Prism.languages[lang], lang);
  } catch {
    return code;
  }
}

/** Reusable code <pre> wrapper with consistent styling.
 *  @param language — Prism-compatible language class (e.g. "language-python", "language-json").
 *  When omitted, the block is skipped by code highlighting. */
function CodePre({ children, language }: { children: React.ReactNode; language?: string }) {
  const code = typeof children === "string" ? children : "";
  const highlighted = highlightCode(code, language);

  return (
    <pre
      className="text-gm-xs leading-relaxed p-gm-3 rounded-gm-md bg-bg-subtle text-text-secondary border border-border"
      style={CODE_LAYOUT}
    >
      <code
        className={language}
        style={CODE_LAYOUT}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}

/** 代码块：标签 + Python 风格代码 + 附加说明文字 */
function CodeBlock({
  label,
  code,
  note,
  language,
}: {
  label: string;
  code: string;
  /** 人类可读的说明文字 */
  note?: string;
  /** Prism 语法高亮语言类（如 "language-python"），省略则不启用高亮 */
  language?: string;
}) {
  const formatted = formatAsPython(code);

  return (
    <div className="mt-gm-3">
      <div
        className="text-gm-xs text-text-muted font-medium mb-gm-1_5 flex items-center gap-gm-1"
      >
        <span className="inline-block w-1 h-3 rounded-full bg-brand" />
        {label}
      </div>
      {note && (
        <p
          className="text-gm-xs text-text-muted leading-relaxed mb-gm-2"
        >
          {note}
        </p>
      )}
      <CodePre language={language}>{formatted}</CodePre>
    </div>
  );
}

/** JSON 代码块：标签 + 格式化 JSON + 附加说明文字 */
function JsonBlock({
  label,
  json,
  note,
}: {
  label: string;
  json: string;
  note?: string;
}) {
  return (
    <div className="mt-gm-3">
      <div
        className="text-gm-xs text-text-muted font-medium mb-gm-1_5 flex items-center gap-gm-1"
      >
        <span className="inline-block w-1 h-3 rounded-full bg-accent" />
        {label}
      </div>
      {note && (
        <p
          className="text-gm-xs text-text-muted leading-relaxed mb-gm-2"
        >
          {note}
        </p>
      )}
      <CodePre language="language-json">{json}</CodePre>
    </div>
  );
}


/**
 * Token 统计卡片式展示。
 *
 * 在 ProcessDrawer 的 Token 消耗统计区渲染单格卡片，显示标签和数值。
 * 数值颜色通过 Tailwind text-* class 控制（S3 修复：inline style → className）。
 */
function TokenStat({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div
      className="flex flex-col items-center gap-gm-0_5 rounded-gm-md p-gm-2 flex-1 min-w-0 bg-bg-subtle"
    >
      <span className="text-gm-xs text-text-muted font-medium">{label}</span>
      <span
        className={`text-gm-base font-bold font-mono ${colorClass ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}

/** Slide-out drawer displaying the full LLM call trace: request, response, intent classification, routing, degradation, and token breakdown. */
export default function ProcessDrawer() {
  const { isOpen, trace, closeDrawer, setCloseDuration } = useDrawer();
  /** Stable store for the scroll container DOM node (set by callback ref). */
  const scrollStore = useRef<HTMLDivElement | null>(null);
  /** Copy button React roots — cleaned up on unmount or re-highlight. */
  const copyRoots = useRef<Map<HTMLElement, Root>>(new Map());

  // S1: 同步关闭延迟与抽屉动画时长 — DrawerContext 默认 420ms，ProcessDrawer 动画 600ms
  useEffect(() => {
    setCloseDuration(DRAWER_ANIMATION_DURATION_MS);
  }, [setCloseDuration]);

  /** Add line-numbers class + copy buttons to all code blocks in the container.
   *  Syntax highlighting is already done at render time via Prism.highlight(). */
  const enhanceCodeBlocks = useCallback((container: HTMLElement) => {
    const codeElements = container.querySelectorAll<HTMLElement>(
      "pre code[class*='language-']",
    );
    if (codeElements.length === 0) return;

    const activePres = new Set<HTMLElement>();
    codeElements.forEach((code) => {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") return;
      activePres.add(pre);

      // line-numbers — Prism plugin CSS adds gutter via pseudo-elements
      pre.classList.add("line-numbers");

      // copy button — mount React component via createRoot
      if (!copyRoots.current.has(pre)) {
        const btnContainer = document.createElement("span");
        btnContainer.className = "gm-code-copy-btn";
        pre.appendChild(btnContainer);
        const root = createRoot(btnContainer);
        copyRoots.current.set(pre, root);
        root.render(<CopyButton text={code.textContent || ""} />);
      } else {
        copyRoots.current.get(pre)!.render(<CopyButton text={code.textContent || ""} />);
      }
    });

    // Cleanup stale roots
    copyRoots.current.forEach((root, pre) => {
      if (!activePres.has(pre)) {
        queueMicrotask(() => root.unmount());
        copyRoots.current.delete(pre);
      }
    });
  }, []);

  // Add line-numbers + copy buttons on drawer open: callback ref fires when the
  // <div> mounts inside Drawer. Code is already highlighted at render time.
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollStore.current = node;
    if (node) {
      requestAnimationFrame(() => enhanceCodeBlocks(node));
    }
  }, [enhanceCodeBlocks]);

  // Re-apply enhancements on trace change while drawer is already open.
  useEffect(() => {
    if (!trace || !isOpen) return;
    const container = scrollStore.current;
    if (!container) return;
    requestAnimationFrame(() => enhanceCodeBlocks(container));
  }, [trace, isOpen, enhanceCodeBlocks]);

  // Cleanup copy button roots on unmount
  useEffect(() => {
    const roots = copyRoots.current;
    return () => {
      roots.forEach((root) => queueMicrotask(() => root.unmount()));
      roots.clear();
    };
  }, []);

  // ── 即时 tooltip state — 替代原生 title 1-2s 延迟 ──
  const [closeTooltip, setCloseTooltip] = useState<{ x: number; y: number } | null>(null);

  if (!trace) return null;

  // Read extra fields — use getExtraString for validated string access
  const systemPrompt = getExtraString(trace, "system_prompt");
  const userPrompt = getExtraString(trace, "user_prompt");
  const rawResponse = getExtraString(trace, "raw_response");
  const parsedResult = getExtraString(trace, "parsed_result");

  // P1 fix: Read planner_parse_error first, fall back to main engine parse_error
  const plannerParseError = (getExtra(trace, "planner_parse_error") as string | null) ?? null;
  const mainParseError = (getExtra(trace, "parse_error") as string | null) ?? null;
  const parseError = plannerParseError ?? mainParseError;

  // Planner trace fields — classifier call chain transparency
  const plannerSystemPrompt = (getExtra(trace, "planner_system_prompt") as string) ?? "";
  const plannerTokenUsage = getExtra(trace, "planner_token_usage") as
    | { prompt_tokens: number; completion_tokens: number }
    | null;
  // R11: planner_raw_response — classifier raw LLM response before parsing (B41)
  const plannerRawResponse = (getExtra(trace, "planner_raw_response") as string) ?? "";

  // R12: routing_decision — model routing choice (B41)
  const routingDecision = getExtra(trace, "routing_decision") as
    | { model: string; reason: string; intent_category: string; complexity: string;
        fallback_model?: string | null; fallback_triggered?: boolean; attempts?: number }
    | null;

  // R13: degradation — budget-driven degradation trace (B41)
  const degradation = getExtra(trace, "degradation") as
    | { query_class: string; budget_zones: Record<string, number>;
        estimated_recall_tokens: number; degradation_level: string; degradation_reason: string }
    | null;

  const totalTokens = trace.prompt_tokens + trace.completion_tokens;

  // Generate Python request code from trace
  const pythonRequestCode = generatePythonRequestCode(trace);

  return (
    <>
    <Drawer isOpen={isOpen} onClose={closeDrawer} maxWidth={DRAWER_MAX_WIDTH} duration={DRAWER_ANIMATION_DURATION_MS} ariaLabel="深度抽屉">
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-gm-5 py-gm-4 shrink-0 bg-surface-elevated border-b border-border"
        >
          <div className="flex items-center gap-gm-2">
            <RiSearchLine className="w-4 h-4" />
            <span className="text-gm-sm font-semibold">LLM 调用档案</span>
            <span
              className="text-gm-xs px-gm-1_5 py-gm-0_5 rounded-full font-medium bg-bg-subtle text-text-muted"
            >
              {trace.model}
            </span>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            className="flex items-center justify-center rounded-gm-md p-gm-1_5 transition-all hover:scale-110 active:scale-90 text-text-muted bg-bg-subtle cursor-pointer focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none"
            aria-label="关闭"
            onMouseEnter={(e) => setCloseTooltip({ x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setCloseTooltip((prev) => prev ? { x: e.clientX, y: e.clientY } : null)}
            onMouseLeave={() => setCloseTooltip(null)}
          >
            <RiCloseLine className="text-gm-icon" />
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden py-gm-3 min-h-0">
          {/* Section 1: Request — always open */}
          <CollapsibleSection className="mx-gm-4 mb-gm-3" icon={<RiShareBoxLine className="w-4 h-4" />} title="请求参数" variant="card" defaultOpen animated>
            <KVRow label="模型" value={trace.model} />
            <KVRow label="温度" value={String(trace.temperature)} />
            <KVRow label="最大 Token" value={String(trace.max_tokens)} />
            {systemPrompt && (
              <CodeBlock
                label="System Prompt — 系统指令"
                code={systemPrompt}
                note="系统预设指令，定义了 AI 的角色、行为约束和知识边界。"
              />
            )}
            {userPrompt && (
              <CodeBlock
                label="User Prompt — 用户输入"
                code={userPrompt}
                note="本次对话中用户发送的原始消息内容。"
              />
            )}
            {/* Python 请求源码展示 */}
            {pythonRequestCode && (
              <CodeBlock
                label="Python Request — 请求源码"
                code={pythonRequestCode}
                note="根据当前参数自动生成的 OpenAI SDK 调用代码。"
                language="language-python"
              />
            )}
          </CollapsibleSection>

          {/* R12: 路由决策 — model routing choice (B41) */}
          {routingDecision && (
            <CollapsibleSection className="mx-gm-4 mb-gm-3" icon={<RiGitBranchLine className="w-4 h-4" />} title="路由决策" variant="card" animated>
              <KVRow label="选中模型" value={routingDecision.model} />
              <KVRow label="意图类别" value={routingDecision.intent_category} />
              <KVRow label="复杂度" value={routingDecision.complexity === "complex" ? "复杂" : "简单"} />
              <KVRow label="理由" value={routingDecision.reason} />
              {routingDecision.fallback_model && (
                <KVRow label="回退模型" value={routingDecision.fallback_model} />
              )}
              {routingDecision.fallback_triggered && (
                <KVRow label="回退触发" value="是" />
              )}
              {routingDecision.attempts !== undefined && routingDecision.attempts > 1 && (
                <KVRow label="调用次数" value={String(routingDecision.attempts)} />
              )}
              <p className="text-gm-xs text-text-muted mt-gm-2">
                路由引擎根据意图复杂度自动选择模型——简单意图走轻量模型节省成本，复杂意图走主力模型保证质量。
              </p>
            </CollapsibleSection>
          )}

          {/* R13: 降级追踪 — budget-driven degradation (B41) */}
          {degradation && (
            <CollapsibleSection className="mx-gm-4 mb-gm-3" icon={<RiErrorWarningLine className="w-4 h-4" />} title="降级追踪" variant="card" animated>
              <KVRow label="查询类别" value={degradation.query_class} />
              <KVRow label="降级级别" value={degradation.degradation_level} />
              <KVRow
                label="召回 Token 估算"
                value={degradation.estimated_recall_tokens.toLocaleString()}
              />
              <KVRow label="降级原因" value={degradation.degradation_reason} />
              {degradation.budget_zones && Object.keys(degradation.budget_zones).length > 0 && (
                <div className="mt-gm-2">
                  <div className="text-gm-xs text-text-muted font-medium mb-gm-1">
                    预算分区
                  </div>
                  {Object.entries(degradation.budget_zones).map(([zone, tokens]) => (
                    <KVRow key={zone} label={zone} value={tokens.toLocaleString()} />
                  ))}
                </div>
              )}
              <p className="text-gm-xs text-text-muted mt-gm-2">
                上下文预算不足时，系统自动降级——缩减召回数量或跳过事实抽取，确保核心对话质量不受影响。
              </p>
            </CollapsibleSection>
          )}

          {/* Section 2: Response — open only when rawResponse is non-empty */}
          <CollapsibleSection
            className="mx-gm-4 mb-gm-3"
            icon={<RiDownloadLine className="w-4 h-4" />}
            title="模型响应"
            variant="card"
            defaultOpen={!!rawResponse}
            animated
          >
            <KVRow label="响应耗时" value={`${trace.elapsed_ms} ms`} />
            {rawResponse && (
              <CodeBlock
                label="Raw Response — 原始响应"
                code={rawResponse}
                note="模型返回的原始文本。当前引擎会额外提取意图和事实信息。"
              />
            )}
          </CollapsibleSection>

          {/* Section 3: Intent Classification — full classifier call chain */}
          <CollapsibleSection className="mx-gm-4 mb-gm-3" icon={<RiSearchLine className="w-4 h-4" />} title="意图解析" variant="card" animated>
            {plannerSystemPrompt && (
              <CodeBlock
                label="Classifier System Prompt — 分类器系统指令"
                code={plannerSystemPrompt}
                note="发送给 LLM 的分类器系统指令，定义 5 种意图类别及响应格式。"
              />
            )}
            {plannerSystemPrompt && (
              <CodeBlock
                label="Classifier Python Request — 分类器请求源码"
                code={generateClassifierRequestCode(trace.model, plannerSystemPrompt, userPrompt)}
                note="Planner 对用户输入进行意图分类的独立 LLM 调用。与主对话调用共用同一个 client。"
                language="language-python"
              />
            )}
            {/* R11: planner_raw_response — classifier raw LLM response before parsing (B41) */}
            {plannerRawResponse && (
              <JsonBlock
                label="Classifier Raw Response — 分类器原始响应"
                json={formatAsJson(plannerRawResponse)}
                note="分类器返回的原始 JSON 响应，经 Planner 解析后提取意图类别和置信度。"
              />
            )}
            {parsedResult && (
              <JsonBlock
                label="Parsed Result — 解析结果"
                json={formatAsJson(parsedResult)}
                note="分类器原始响应经 Planner 解析后的结构化意图分类结果。"
              />
            )}
            {parseError ? (
              <KVRow label="解析状态" value={parseError} error />
            ) : (
              <KVRow label="解析状态" value="正常 — 意图分类成功" />
            )}
          </CollapsibleSection>

          {/* Section 5: Task Planning — DAG visualization (plan data from PlanGenerator L2) */}
          {(() => {
            const planSubtasks = getExtra(trace, "plan_subtasks") as Array<Record<string, unknown>> | undefined;
            if (!planSubtasks || planSubtasks.length === 0) return null;
            const planEdges = (getExtra(trace, "plan_dag_edges") as Array<[string, string]>) ?? [];
            const planRationale = getExtraString(trace, "plan_rationale");
            const planConfidence = (getExtra(trace, "plan_confidence") as number) ?? 0;
            const planTokenUsage = getExtra(trace, "plan_token_usage") as
              | { prompt_tokens: number; completion_tokens: number }
              | null;

            return (
              <CollapsibleSection className="mx-gm-4 mb-gm-3" icon={<RiFileListLine className="w-4 h-4" />} title="任务规划" variant="card" animated>
                <KVRow label="子任务数" value={String(planSubtasks.length)} />
                <KVRow label="置信度" value={`${Math.round(planConfidence * 100)}%`} />
                {planRationale && (
                  <KVRow label="规划理由" value={planRationale} />
                )}
                {planSubtasks.length > 0 && (
                  <div className="mt-gm-3">
                    <div
                      className="text-gm-xs text-text-muted font-medium mb-gm-1_5 flex items-center gap-gm-1"
                    >
                      <span className="inline-block w-1 h-3 rounded-full bg-warning" />
                      任务依赖图 (DAG)
                    </div>
                    <div className="rounded-gm-md p-gm-2 bg-bg-subtle border border-border">
                      <MermaidDiagram
                        chart={buildPlanDAGChart(trace)}
                        title={`任务分解: ${planSubtasks.length} 个子任务`}
                        maxHeight={320}
                      />
                    </div>
                  </div>
                )}
                {planEdges.length > 0 && (
                  <p className="text-gm-xs text-text-muted mt-gm-2">
                    {planEdges.length} 条依赖关系 — 箭头表示「前置任务 → 后续任务」
                  </p>
                )}
                {planTokenUsage && (
                  <div className="flex gap-gm-2 mt-gm-2">
                    <TokenStat
                      label="规划器输入"
                      value={planTokenUsage.prompt_tokens.toLocaleString()}
                      colorClass="text-warning"
                    />
                    <TokenStat
                      label="规划器输出"
                      value={planTokenUsage.completion_tokens.toLocaleString()}
                      colorClass="text-accent"
                    />
                  </div>
                )}
              </CollapsibleSection>
            );
          })()}

          {/* Section 4: Token */}
          <CollapsibleSection className="mx-gm-4 mb-gm-3" icon={<RiHashtag className="w-4 h-4" />} title="Token 消耗统计" variant="card" animated>
            <div className="flex gap-gm-2">
              <TokenStat label="主调用输入" value={trace.prompt_tokens.toLocaleString()} colorClass="text-brand" />
              <TokenStat label="主调用输出" value={trace.completion_tokens.toLocaleString()} colorClass="text-text-secondary" />
              <TokenStat label="主调用合计" value={totalTokens.toLocaleString()} colorClass="text-text" />
            </div>
            {plannerTokenUsage && (
              <div className="flex gap-gm-2 mt-gm-2">
                <TokenStat
                  label="分类器输入"
                  value={plannerTokenUsage.prompt_tokens.toLocaleString()}
                  colorClass="text-info"
                />
                <TokenStat
                  label="分类器输出"
                  value={plannerTokenUsage.completion_tokens.toLocaleString()}
                  colorClass="text-accent"
                />
                <TokenStat
                  label="分类合计"
                  value={(plannerTokenUsage.prompt_tokens + plannerTokenUsage.completion_tokens).toLocaleString()}
                  colorClass="text-text-muted"
                />
              </div>
            )}
            <p
              className="text-gm-xs text-text-muted mt-gm-2 text-center"
            >
              本次调用消耗约 {totalTokens.toLocaleString()} tokens
            </p>
          </CollapsibleSection>
        </div>
    </Drawer>
    {closeTooltip && (
      <div
        className="fixed z-50 rounded-gm-sm border border-border-strong
                   bg-surface-elevated px-gm-2.5 py-gm-1.5
                   shadow-gm-md pointer-events-none"
        style={{
          left: closeTooltip.x + 12,
          top: closeTooltip.y - 8,
        }}
      >
        <p className="text-gm-xs text-text whitespace-nowrap">关闭 (Esc)</p>
      </div>
    )}
    </>
  );
}

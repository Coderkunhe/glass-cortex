"use client";

import { useState, useCallback, useEffect } from "react";
import {
  RiFocus3Line,
  RiLoader4Line,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import DataState from "@/components/ui/DataState";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import IntentPill from "@/components/chat/IntentPill";
import type { PlannerClassifyResponse, FetchState } from "@/lib/api/types";


/**
 * 意图测试面板。
 * 独立测试意图分类 — 输入文本 → 调用 /planner/classify → 展示分类结果和 trace。
 */
export default function IntentTestPanel() {
  const [state, setState] = useState<FetchState>("idle");
  const [data, setData] = useState<PlannerClassifyResponse | null>(null);
  const [error, setError] = useState<Error | string | null>(null);
  const [userInput, setUserInput] = useState("");
  const [isMac, setIsMac] = useState(false);

  // Platform detection is inherently client-side — useEffect is the correct
  // place for this, and the hydration mismatch is harmless (⌘ vs Ctrl text).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(/Mac/.test(navigator.userAgent));
  }, []);

  const fetchClassify = useCallback(async () => {
    if (!userInput.trim()) return;
    setState("loading");
    setError(null);
    try {
      const result = await api.classifyIntent({ user_msg: userInput.trim() });
      setData(result);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("分类失败"));
      setState("error");
    }
  }, [userInput]);


  return (
    <section className="rounded-gm-sm border border-border bg-surface-elevated p-gm-5">
      {/* Header */}
      <div className="flex items-center gap-gm-2 mb-gm-4">
        <RiFocus3Line className="w-5 h-5 text-brand" />
        <h3 className="text-gm-sm font-semibold text-text">意图分类测试</h3>
        <span className="text-gm-xs text-text-muted">
          独立测试意图分类，无需完整聊天管线
        </span>
      </div>

      {/* 表单区 */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-gm-3 mb-gm-4">
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="输入待分类的文本，例如：『帮我写一段 Python 代码来解析 JSON』…"
          rows={4}
          className="w-full rounded-gm-xs border border-border bg-surface-alt
                     px-gm-2 py-gm-1.5 text-gm-sm text-text
                     placeholder:text-text-muted/50
                     focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30
                     resize-y min-h-[80px]"
          aria-keyshortcuts={isMac ? "Meta+Enter" : "Ctrl+Enter"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              fetchClassify();
            }
          }}
        />
        <div className="flex items-end">
          <button
            onClick={fetchClassify}
            disabled={state === "loading" || !userInput.trim()}
            className="rounded-gm-sm bg-brand px-gm-4 py-gm-1.5 text-gm-sm
                       font-medium text-white hover:bg-brand-600 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {state === "loading" ? (
              <span className="flex items-center gap-gm-1">
                <RiLoader4Line className="w-4 h-4 animate-spin" />
                分类中…
              </span>
            ) : (
              "测试分类"
            )}
          </button>
        </div>
      </div>
      <p className="text-gm-xs text-text-muted/60 mt-gm-1 mb-gm-4">
        {isMac ? "⌘" : "Ctrl"}+Enter 快速提交
      </p>

      <DataState
        state={state}
        error={error}
        onRetry={fetchClassify}
        loadingMessage="正在分类…"
        loadingIconClassName="text-brand"
        emptyIcon={RiFocus3Line}
        emptyMessage="输入文本后点击「测试分类」查看意图识别结果"
        isEmpty={
          state === "idle"
        }
      >
      {/* Success */}
      {state === "success" && data && (
        <div className="border-t border-border pt-gm-4 space-y-gm-4">
          {/* 分类结果 */}
          <div className="flex items-center gap-gm-3">
            <span className="text-gm-xs text-text-muted">分类结果:</span>
            <IntentPill
              category={data.category}
              confidence={data.confidence}
              large
            />
          </div>

          {/* 理由 */}
          {data.rationale && (
            <div>
              <span className="text-gm-xs text-text-muted block mb-gm-1">
                分类理由
              </span>
              <p className="text-gm-sm text-text-secondary bg-surface-alt rounded-gm-xs px-gm-3 py-gm-2">
                {data.rationale}
              </p>
            </div>
          )}

          {/* 分类过程 — 默认展开，trace 为空时展示降级说明 */}
          <CollapsibleSection title="分类过程" defaultOpen={true}>
            <div className="space-y-gm-3">
              {data.trace && Object.keys(data.trace).length > 0 ? (
                <>
                  {!!data.trace.user_prompt && (
                    <div>
                      <span className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
                        User Prompt
                      </span>
                      <pre className="rounded-gm-xs bg-surface-alt p-gm-2 text-gm-xs text-text-secondary overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {String(data.trace.user_prompt)}
                      </pre>
                    </div>
                  )}
                  {!!data.trace.system_prompt && (
                    <div>
                      <span className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
                        System Prompt
                      </span>
                      <pre className="rounded-gm-xs bg-surface-alt p-gm-2 text-gm-xs text-text-secondary overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {String(data.trace.system_prompt)}
                      </pre>
                    </div>
                  )}
                  {!!data.trace.raw_response && (
                    <div>
                      <span className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
                        Raw Response
                      </span>
                      <pre className="rounded-gm-xs bg-surface-alt p-gm-2 text-gm-xs text-text-secondary overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {String(data.trace.raw_response)}
                      </pre>
                    </div>
                  )}
                  {!!data.trace.parse_error && (
                    <div className="rounded-gm-xs border border-danger/20 bg-danger/5 p-gm-2">
                      <span className="text-gm-xs font-medium text-danger">
                        Parse Error
                      </span>
                      <pre className="mt-gm-1 text-gm-xs text-danger/80 whitespace-pre-wrap">
                        {String(data.trace.parse_error)}
                      </pre>
                    </div>
                  )}
                  {!!data.trace.token_usage && (
                    <div>
                      <span className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
                        Token Usage
                      </span>
                      <pre className="rounded-gm-xs bg-surface-alt p-gm-2 text-gm-xs text-text-secondary overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {JSON.stringify(data.trace.token_usage, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-gm-xs bg-warning/5 border border-warning/20 px-gm-3 py-gm-2">
                  <p className="text-gm-xs text-text-secondary leading-relaxed">
                    分类过程详情不可用 — LLM API 未配置或调用失败，当前为降级分类结果。
                    配置 API key 后可查看完整的分类调用链（System Prompt · Raw Response · Token Usage · Parse Error）。
                  </p>
                </div>
              )}
            </div>
          </CollapsibleSection>
        </div>
      )}

      </DataState>
    </section>
  );
}

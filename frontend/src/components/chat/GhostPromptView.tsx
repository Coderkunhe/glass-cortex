"use client";

import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { CopyButton } from "@/components/ui/CopyButton";

interface GhostPromptViewProps {
  /** 完整 system prompt 文本（来自 ChatResponse.system_prompt） */
  systemPrompt?: string | null;
}

/** Ghost Prompt 视图 — 展示当前对话的完整 system prompt 源码。
 *
 * 默认折叠，点击展开后显示带行号的代码块。
 * 支持一键复制到剪贴板。
 */
export default function GhostPromptView({ systemPrompt }: GhostPromptViewProps) {

  if (!systemPrompt) {
    return (
      <p className="text-gm-xs text-text-muted">
        👻 本次对话未返回 system prompt（可能引擎未附加）
      </p>
    );
  }

  const estimatedTokens = Math.ceil(systemPrompt.length / 3); // 粗略估算

  return (
    <div role="region" aria-label="Ghost Prompt 视图">
      <CollapsibleSection
        variant="bordered"
        title={`👻 Ghost Prompt · ~${estimatedTokens.toLocaleString()} tokens`}
        rightAccessory={<CopyButton text={systemPrompt} />}
      >
        <pre className="text-gm-xs font-mono text-text-secondary
                        leading-relaxed whitespace-pre-wrap break-all
                        max-h-80 overflow-y-auto bg-bg-subtle/50 rounded-gm-xs p-gm-3">
          {systemPrompt}
        </pre>
      </CollapsibleSection>
    </div>
  );
}

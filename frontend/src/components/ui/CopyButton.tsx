"use client";

import { useState } from "react";
import { RiFileCopyLine } from "@remixicon/react";

// ── Types ──────────────────────────────────────────────────────────────

export interface CopyButtonProps {
  /** Text to copy to the clipboard. */
  text: string;

  // ── Styling overrides ──

  /** Appended to the outermost button element. */
  className?: string;
  /** Data attribute for test querying. */
  "data-testid"?: string;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * CopyButton — 复制到剪贴板按钮
 *
 * Extracted from 2 identical inline implementations
 * (ModelInferencePanel + GhostPromptView).
 * Features: clipboard copy with 2s visual feedback ("已复制").
 */
const FEEDBACK_DURATION_MS = 2000;

export function CopyButton({
  text,
  className = "",
  "data-testid": dataTestId,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), FEEDBACK_DURATION_MS);
    } catch (err) {
      // Clipboard API may not be available (non-HTTPS / localhost)
      console.error("Copy to clipboard failed:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "已复制到剪贴板" : "复制到剪贴板"}
      className={`shrink-0 inline-flex items-center gap-gm-1
                  px-gm-2 py-gm-0_5 text-gm-xs rounded-gm-xs
                  bg-bg-subtle hover:bg-brand/10 text-text-muted
                  hover:text-brand transition-colors
                  focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                  active:scale-[0.98] ${className}`.trim()}
      data-testid={dataTestId}
    >
      <RiFileCopyLine className="text-gm-icon" />
      {copied ? "已复制" : "复制"}
    </button>
  );
}

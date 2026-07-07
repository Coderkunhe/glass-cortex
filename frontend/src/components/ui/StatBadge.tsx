"use client";

import { fmtNum } from "@/lib/formatNum";

/** Shared stat badge with two visual variants for different information hierarchy levels. */
export interface StatBadgeProps {
  /** Label text — position depends on variant (hero: right of value · pill: left of value). */
  label: string;
  /** Display value — numbers are formatted via fmtNum; strings pass through as-is. */
  value: string | number;
  /** Visual variant: "hero" = large bold number, no container (primary metrics) · "pill" = bordered container (inline metadata). */
  variant?: "hero" | "pill";
  /** Pill variant only: highlight with warning colors when true. */
  warn?: boolean;
}

export function StatBadge({
  label,
  value,
  variant = "pill",
  warn,
}: StatBadgeProps) {
  const displayValue = typeof value === "number" ? fmtNum(value) : value;

  if (variant === "hero") {
    return (
      <div className="flex items-baseline gap-gm-1_5">
        <span className="text-gm-2xl font-bold text-text tabular-nums">
          {displayValue}
        </span>
        <span className="text-gm-xs text-text-muted">{label}</span>
      </div>
    );
  }

  return (
    <span
      className={
        "inline-flex items-center gap-gm-1_5 rounded-gm-sm border px-gm-2_5 py-gm-1_5 text-gm-xs " +
        (warn
          ? "border-warning/30 bg-warning/5 text-warning"
          : "border-border/40 bg-surface text-text-secondary")
      }
    >
      <span className="text-text-muted">{label}</span>
      <span className="font-medium">{displayValue}</span>
    </span>
  );
}

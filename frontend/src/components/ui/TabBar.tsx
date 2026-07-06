"use client";

import React from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface TabDef {
  /** Unique key for the tab (used as React key + onChange arg). */
  key: string;
  /** Display label shown on the tab button. */
  label: string;
  /** Optional icon rendered before the label. */
  icon?: React.ComponentType<{ className?: string }>;
}

export interface TabBarProps {
  /** Ordered list of tab definitions. */
  tabs: ReadonlyArray<TabDef>;

  /** Currently active tab key (controlled component). */
  activeKey: string;

  /** Called when the user clicks a different tab. */
  onChange: (key: string) => void;

  /**
   * Color theme for the active tab indicator (bottom border + text).
   * @default "brand"
   */
  activeColor?: "brand" | "info";

  /**
   * Size preset controlling padding and font size.
   * - `"sm"`: panel-level tabs with icons (LabShell / ObserveShell)
   * - `"xs"`: compact sub-tabs (MemoryBrowserPanel)
   * @default "sm"
   */
  size?: "sm" | "xs";

  /** Accessible label for the tablist navigation landmark. */
  ariaLabel: string;

  /** Appended to the outermost `<nav>` element. Use for `px-gm-5 pt-gm-3` etc. */
  className?: string;
}

// ── Style maps ─────────────────────────────────────────────────────────

const SIZE_STYLE: Record<"sm" | "xs", string> = {
  sm: "px-gm-4 py-gm-2 text-gm-sm",
  xs: "px-gm-3 py-gm-1.5 text-gm-xs",
};

const ACTIVE_COLOR: Record<"brand" | "info", string> = {
  brand: "border-brand text-brand",
  info: "border-info text-info",
};

// ── Component ──────────────────────────────────────────────────────────

/**
 * TabBar — 统一 Tab 导航栏
 *
 * Extracted from 3 inline implementations
 * (ObserveShell + LabShell + MemoryBrowserPanel).
 * Controlled component: consumer owns useState, passes activeKey + onChange.
 *
 * Features: icon support, two size presets (sm/xs), brand/info color themes,
 * ARIA tablist/tab/aria-selected, border-b overlap technique.
 */
export function TabBar({
  tabs,
  activeKey,
  onChange,
  activeColor = "brand",
  size = "sm",
  ariaLabel,
  className = "",
}: TabBarProps) {
  const activeCls = ACTIVE_COLOR[activeColor];
  const sizeCls = SIZE_STYLE[size];

  return (
    <nav
      className={`flex border-b border-border ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const Icon = tab.icon;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`inline-flex items-center gap-gm-1.5 ${sizeCls} font-medium transition-colors border-b-2 -mb-[1px] ${
              isActive
                ? activeCls
                : "border-transparent text-text-muted hover:text-text-secondary hover:border-border-strong"
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

"use client";

import { useCallback, type ChangeEvent } from "react";
import { clampWindow, MIN_WINDOW, MAX_WINDOW } from "@/lib/clampWindow";

// ── Constants ─────────────────────────────────────────────────────────

const PRESETS = [128, 256, 512, 1024, 2048, 4096] as const;

function formatPreset(v: number): string {
  return v >= 1024 ? `${v / 1024}K` : String(v);
}

// ── Types ──────────────────────────────────────────────────────────────

export interface WindowSizeInputProps {
  /** Current window size in tokens. */
  value: number;
  /** Called with the clamped/rounded value on change. */
  onChange: (v: number) => void;

  /** Label text above the input. Default: "窗口大小". */
  label?: string;

  /** Appended to the outermost wrapper element. */
  className?: string;
  /** Data attribute for test querying. */
  "data-testid"?: string;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * WindowSizeInput — 窗口大小自由输入 + 快捷预设
 *
 * 数字输入 + 快捷预设按钮组合。输入自动 clamp 到 [128, 8192]，
 * 不做 step 圆整——用户可自由输入任意整数值。
 *
 * 用于 Lab 上下文 Tab 各面板的窗口大小控件。
 */
export function WindowSizeInput({
  value,
  onChange,
  label = "窗口大小",
  className = "",
  "data-testid": dataTestId,
}: WindowSizeInputProps) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const raw = parseInt(e.target.value, 10);
      if (isNaN(raw)) return;
      onChange(clampWindow(raw));
    },
    [onChange],
  );

  const handlePreset = useCallback(
    (v: number) => {
      onChange(v);
    },
    [onChange],
  );

  return (
    <div className={className} data-testid={dataTestId}>
      <label className="text-gm-xs font-medium text-text-secondary block mb-gm-1">
        {label}
      </label>
      <div className="flex items-center gap-gm-2">
        <input
          type="number"
          min={MIN_WINDOW}
          max={MAX_WINDOW}
          step={1}
          value={value}
          onChange={handleChange}
          className="w-28 rounded-gm-xs border border-border bg-surface-elevated
                     px-gm-2 py-gm-1.5 text-gm-sm text-text
                     focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30
                     [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-gm-xs text-text-muted">tokens</span>
      </div>
      <div className="flex gap-gm-1 mt-gm-1.5">
        {PRESETS.map((v) => {
          const isActive = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => handlePreset(v)}
              aria-pressed={isActive}
              className={`rounded-gm-xs px-gm-2 py-gm-0.5 text-gm-xs font-medium transition-all
                focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none
                active:scale-[0.98] ${
                isActive
                  ? "bg-brand text-white"
                  : "bg-surface-alt text-text-secondary hover:bg-surface-alt/80 border border-border"
              }`}
            >
              {formatPreset(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

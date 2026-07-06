"use client";

import { useState, useEffect, useCallback } from "react";
import { RiVipCrownLine, RiDoorLine, RiQuillPenLine } from "@remixicon/react";
import { api } from "@/lib/api/client";
import ErrorDisplay from "@/components/ui/ErrorDisplay";
import type { StrategyPersona as StrategyPersonaType } from "@/lib/api/types";

/** API icon 字符串到 Remix Icon 组件的映射表。
 *
 * 三种溢出策略各自携带独立的 icon 字段（ri-*-line），
 * 前端不再硬编码单一图标，改为按数据驱动选择。 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "ri-door-line": RiDoorLine,
  "ri-vip-crown-line": RiVipCrownLine,
  "ri-quill-pen-line": RiQuillPenLine,
};

interface StrategyPersonaProps {
  /** 当前激活的策略 ID */
  activeStrategy: string;
}

/** 策略人格卡片 — 展示当前上下文溢出策略的拟人化描述。
 *
 * 数据从 GET /lab/strategy-personas 获取并客户端缓存。
 * 高亮当前激活策略，其余策略淡化。
 */
export default function StrategyPersona({ activeStrategy }: StrategyPersonaProps) {
  const [personas, setPersonas] = useState<StrategyPersonaType[] | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  const fetchPersonas = useCallback(async () => {
    try {
      const data = await api.getStrategyPersonas();
      setPersonas(data.personas);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("加载策略失败"));
    }
  }, []);

  // 挂载时加载策略数据
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchPersonas is async; all setState calls happen after await
    void fetchPersonas();
  }, [fetchPersonas]);

  // 按 activeStrategy 排序：激活的排最前
  const sorted = personas
    ? [...personas].sort((a, b) => {
        if (a.id === activeStrategy) return -1;
        if (b.id === activeStrategy) return 1;
        return 0;
      })
    : [];

  return (
    <div role="region" aria-label="策略人格卡片" className="space-y-gm-2">
      {error && (
        <ErrorDisplay variant="inline" error={error} onRetry={fetchPersonas} />
      )}
      {sorted.map((p) => {
        const isActive = p.id === activeStrategy;
        return (
          <div
            key={p.id}
            className={`rounded-gm-sm border px-gm-3 py-gm-2 transition-all ${
              isActive
                ? "border-brand/40 bg-brand/5"
                : "border-border bg-surface-elevated opacity-60"
            }`}
          >
            <div className="flex items-center gap-gm-2">
              {/* 图标 — 数据驱动：从 API icon 字段映射到 Remix Icon 组件 */}
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-gm-sm ${isActive ? "" : "bg-bg-subtle text-text-muted"}`}
                style={isActive ? { backgroundColor: `${p.color}20`, color: p.color } : undefined}
              >
                {(() => {
                  const IconComponent = ICON_MAP[p.icon] ?? RiVipCrownLine;
                  return <IconComponent />;
                })()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-gm-1_5">
                  <span
                    className={`text-gm-sm font-semibold ${isActive ? "" : "text-text-secondary"}`}
                    style={isActive ? { color: p.color } : undefined}
                  >
                    {p.name}
                  </span>
                  {isActive && (
                    <span className="text-gm-xs px-gm-1 rounded-full bg-brand/15 text-brand font-medium">
                      当前
                    </span>
                  )}
                </div>
                <p className="text-gm-xs text-text-muted">{p.subtitle}</p>
              </div>
            </div>
            {isActive && (
              <p className="mt-gm-1 text-gm-xs text-text-secondary leading-relaxed">
                {p.description}
              </p>
            )}
          </div>
        );
      })}
      {!personas && !error && (
        <p className="text-gm-xs text-text-muted animate-pulse">加载策略…</p>
      )}
    </div>
  );
}

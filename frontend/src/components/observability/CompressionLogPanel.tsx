"use client";

import { useState, useEffect, useCallback } from "react";
import { RiFileReduceLine } from "@remixicon/react";
import DataState from "@/components/ui/DataState";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { api } from "@/lib/api/client";
import type { CompressionStatsResponse, FetchState } from "@/lib/api/types";

/** 统计卡片定义 — label + 从响应数据中提取值的函数 */
interface StatCard {
  label: string;
  value: (data: CompressionStatsResponse) => string;
}

const STAT_CARDS: StatCard[] = [
  {
    label: "当前会话压缩次数",
    value: (d) => d.session_compression_count.toLocaleString(),
  },
  {
    label: "Token 节省量",
    value: (d) => d.session_tokens_saved.toLocaleString(),
  },
  {
    label: "压缩 Prompt 消耗",
    value: (d) => d.session_prompt_tokens.toLocaleString(),
  },
  {
    label: "压缩 Completion 消耗",
    value: (d) => d.session_completion_tokens.toLocaleString(),
  },
  {
    label: "历史压缩次数",
    value: (d) => d.historical_compression_count.toLocaleString(),
  },
];

/**
 * 压缩日志面板组件。
 *
 * 挂载时调用 GET /metrics/compression，以 stat-card 网格展示
 * 当前会话 + 历史压缩统计数据。详细事件日志列表在后续批次补齐。
 */
export default function CompressionLogPanel() {
  const [state, setState] = useState<FetchState>("loading");
  const [data, setData] = useState<CompressionStatsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  const fetchStats = useCallback(async () => {
    setState("loading");
    try {
      const result = await api.getCompressionStats();
      setData(result);
      setState("success");
    } catch (e) {
      setError(e);
      setState("error");
    }
  }, []);

  useEffect(() => {
    // 挂载时获取压缩统计数据 — setState 在 useCallback 内部
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="flex flex-col gap-gm-4">
      {/* 标题栏 + 刷新 */}
      <div className="flex items-center justify-between">
        <h3 className="text-gm-sm font-medium text-text-secondary">
          压缩统计
        </h3>
        <RefreshButton
          onClick={fetchStats}
          loading={state === "loading"}
          aria-label="刷新压缩统计"
        />
      </div>

      {/* 统计卡片 — 通过 DataState 统一管理 loading / error / success */}
      <DataState
        state={state}
        error={error}
        onRetry={fetchStats}
        loadingMessage="加载压缩统计…"
        emptyMessage="暂无压缩统计数据"
      >
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-gm-3">
            {STAT_CARDS.map(({ label, value }) => (
              <div
                key={label}
                className="bg-surface border border-border rounded-gm-sm p-gm-3"
              >
                <div className="text-gm-xs text-text-muted mb-gm-1">
                  {label}
                </div>
                <div className="text-gm-lg font-semibold text-text">
                  {value(data)}
                </div>
              </div>
            ))}
          </div>
        )}
      </DataState>

      {/* 事件列表占位 — 后续批次补齐 */}
      <div className="border-t border-border pt-gm-4 mt-gm-2">
        <div className="flex flex-col items-center justify-center py-gm-8 text-text-muted/50 gap-gm-2">
          <RiFileReduceLine className="w-8 h-8" />
          <p className="text-gm-xs">压缩事件日志即将上线</p>
        </div>
      </div>
    </div>
  );
}

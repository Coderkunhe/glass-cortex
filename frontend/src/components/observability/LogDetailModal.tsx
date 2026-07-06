"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RiCloseLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiFileCodeLine,
} from "@remixicon/react";
import { api } from "@/lib/api/client";
import type { LogDetailResponse } from "@/lib/api/types";

/** 日志级别 → 文字颜色 */
function levelColor(level: string): string {
  switch (level) {
    case "DEBUG":
      return "text-text-muted";
    case "INFO":
      return "text-info";
    case "WARNING":
      return "text-warning";
    case "ERROR":
    case "PARSE_ERROR":
      return "text-danger";
    default:
      return "text-text-secondary";
  }
}

/** 日志级别 → 背景色 */
function levelBg(level: string): string {
  switch (level) {
    case "ERROR":
    case "PARSE_ERROR":
      return "bg-danger/10";
    case "WARNING":
      return "bg-warning/10";
    case "INFO":
      return "bg-info/10";
    default:
      return "bg-surface-lowered";
  }
}

export interface LogDetailModalProps {
  /** 要查看的日志行号 */
  logId: number;
  /** 关闭回调 */
  onClose: () => void;
  /** 导航到指定行号 */
  onNavigate: (id: number) => void;
}

/**
 * 单条日志详情抽屉组件。
 * 从右侧滑入，展示完整日志内容（时间/级别/来源/消息/原始 JSON），
 * 支持前后导航和 ESC 关闭。
 */
export default function LogDetailModal({
  logId,
  onClose,
  onNavigate,
}: LogDetailModalProps) {
  const [data, setData] = useState<LogDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getLogById(logId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
  }, [fetchDetail]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // 点击遮罩关闭
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-gm-drawer flex justify-end"
      onClick={handleBackdropClick}
    >
      {/* 半透明遮罩 */}
      <div className="absolute inset-0 bg-black/40" />

      {/* 抽屉面板 */}
      <div className="relative w-full max-w-lg bg-surface-elevated border-l border-border shadow-gm-lg flex flex-col h-full animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center gap-gm-2 px-gm-5 py-gm-3 border-b border-border shrink-0">
          <RiFileCodeLine className="w-5 h-5 text-text-muted shrink-0" />
          <h3 className="text-gm-sm font-semibold text-text">日志详情</h3>

          {/* 导航按钮 */}
          <div className="flex items-center gap-gm-1 ml-auto mr-gm-2">
            <button
              type="button"
              onClick={() => data?.prev_id && onNavigate(data.prev_id)}
              disabled={!data?.prev_id}
              className="inline-flex items-center gap-gm-0_5 rounded-gm-sm border border-border bg-surface px-gm-2 py-gm-0.5 text-gm-xs text-text-secondary hover:text-text hover:bg-surface-alt disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="上一条"
            >
              <RiArrowLeftSLine className="w-4 h-4" />
              上一条
            </button>
            <button
              type="button"
              onClick={() => data?.next_id && onNavigate(data.next_id)}
              disabled={!data?.next_id}
              className="inline-flex items-center gap-gm-0_5 rounded-gm-sm border border-border bg-surface px-gm-2 py-gm-0.5 text-gm-xs text-text-secondary hover:text-text hover:bg-surface-alt disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="下一条"
            >
              下一条
              <RiArrowRightSLine className="w-4 h-4" />
            </button>
          </div>

          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={onClose}
            className="p-gm-1 rounded-gm-sm text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
            aria-label="关闭详情"
          >
            <RiCloseLine className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-gm-5">
          {loading && (
            <p className="text-gm-sm text-text-muted text-center py-gm-8">
              加载中…
            </p>
          )}

          {error && (
            <div className="rounded-gm-sm border border-danger/20 bg-danger/5 p-gm-4">
              <p className="text-gm-sm font-medium text-danger mb-gm-1">
                加载失败
              </p>
              <p className="text-gm-xs text-text-secondary">{error}</p>
            </div>
          )}

          {data && (
            <div className="space-y-gm-4">
              {/* 元信息 */}
              <div className="rounded-gm-sm border border-border bg-surface p-gm-4">
                <div className="grid grid-cols-2 gap-gm-3 text-gm-xs">
                  <div>
                    <span className="text-text-muted">行号</span>
                    <p className="text-text font-mono tabular-nums">
                      #{data.id}
                    </p>
                  </div>
                  <div>
                    <span className="text-text-muted">级别</span>
                    <p
                      className={`font-semibold ${levelColor(data.level)}`}
                    >
                      [{data.level}]
                    </p>
                  </div>
                  <div>
                    <span className="text-text-muted">时间</span>
                    <p className="text-text-secondary font-mono">
                      {data.timestamp || "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-text-muted">来源</span>
                    <p className="text-brand font-mono">{data.logger || "-"}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-text-muted">文件位置</span>
                    <p className="text-text-secondary font-mono">
                      第 {data.id}/{data.total_lines} 行
                    </p>
                  </div>
                </div>
              </div>

              {/* 消息 */}
              <div className="rounded-gm-sm border border-border bg-surface p-gm-4">
                <p className="text-gm-xs font-semibold text-text-muted mb-gm-2">
                  消息内容
                </p>
                <pre
                  className={`text-gm-sm whitespace-pre-wrap break-all font-mono rounded-gm-sm p-gm-3 ${levelBg(data.level)}`}
                >
                  {data.message}
                </pre>
              </div>

              {/* 原始 JSON */}
              <div className="rounded-gm-sm border border-border bg-surface p-gm-4">
                <p className="text-gm-xs font-semibold text-text-muted mb-gm-2">
                  原始数据
                </p>
                <pre className="text-gm-xs text-text-secondary whitespace-pre-wrap break-all font-mono bg-surface-lowered rounded-gm-sm p-gm-3 max-h-60 overflow-y-auto">
                  {data.raw}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

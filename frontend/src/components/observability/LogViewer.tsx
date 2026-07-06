"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RiFileListLine,
  RiSearchLine,
  RiCloseLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from "@remixicon/react";
import DataState from "@/components/ui/DataState";
import { api } from "@/lib/api/client";
import type { LogResponse, LogQueryParams, LogEntry, FetchState } from "@/lib/api/types";
import LogDetailModal from "./LogDetailModal";

/* ── 常量 ─────────────────────────────────────────── */

const LEVELS = ["", "DEBUG", "INFO", "WARNING", "ERROR"] as const;
const LEVEL_LABELS: Record<string, string> = {
  "": "全部",
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARNING: "WARN",
  ERROR: "ERROR",
};
const TAIL_OPTIONS = [50, 100, 200, 500, 1000];
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 日志级别 → 文字颜色（用于行渲染） */
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

/** 文件大小格式化 */
function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/* ── 组件 ─────────────────────────────────────────── */

/**
 * 日志查看器 Tab 内容组件。
 * 调用 GET /logs API，提供级别过滤、关键字搜索、分页浏览和日志行渲染。
 */
export default function LogViewer() {
  /* ── 查询参数 ─────────────────────── */
  const [level, setLevel] = useState<string>("");
  const [tailN, setTailN] = useState(200);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  /* ── 响应数据 ─────────────────────── */
  const [data, setData] = useState<LogResponse | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [errorMsg, setErrorMsg] = useState<unknown>(null);

  /* ── 详情弹窗 ─────────────────────── */
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

  /* ── 防抖 ─────────────────────────── */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedKeyword, setDebouncedKeyword] = useState("");

  // keyword 变化 → 300ms 后同步到 debouncedKeyword
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedKeyword(keyword);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [keyword]);

  /* ── 数据获取 ─────────────────────── */
  const fetchLogs = useCallback(async () => {
    setFetchState("loading");
    setErrorMsg(null);
    try {
      const params: LogQueryParams = {
        profile: "default",
        tail_n: tailN,
        page,
        page_size: pageSize,
      };
      if (level) params.level = level;
      if (debouncedKeyword) params.keyword = debouncedKeyword;
      const result = await api.getLogs(params);
      setData(result);
      setFetchState("success");
    } catch (err) {
      setErrorMsg(err);
      setFetchState("error");
    }
  }, [level, tailN, debouncedKeyword, page, pageSize]);

  useEffect(() => {
    // 挂载时获取日志 — setState 在 useCallback 内部
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
  }, [fetchLogs]);

  /* ── 过滤器变更时重置页码 ─────────── */
  const changeLevel = useCallback((lv: string) => {
    setLevel(lv);
    setPage(1);
  }, []);
  const changeTailN = useCallback((n: number) => {
    setTailN(n);
    setPage(1);
  }, []);
  const changeKeyword = useCallback((kw: string) => {
    setKeyword(kw);
    setPage(1);
  }, []);

  /* ── 计算 ─────────────────────────── */
  const totalPages = data ? Math.ceil(data.total_lines / data.page_size) : 0;
  const hasActiveFilter = level !== "" || debouncedKeyword !== "";

  /* ── 辅助渲染函数 ──────────────────── */

  /** 渲染单行日志，idx 确保 React key 唯一（同秒同源条目 raw 前缀可能重复） */
  function renderLogRow(entry: LogEntry, idx: number) {
    const longMessage = entry.message.length > 300;

    return (
      <div
        key={`${entry.timestamp}-${idx}`}
        className="flex gap-gm-3 px-gm-4 py-gm-1 border-b border-border/50 font-mono text-gm-xs leading-relaxed cursor-pointer hover:bg-surface-alt/50 transition-colors"
        onClick={() => setSelectedLogId(entry.id)}
        title="点击查看详情"
      >
        {/* 时间戳 — truncate 防溢出 */}
        <span className="shrink-0 truncate text-text-muted" style={{ width: 155 }}>
          {entry.timestamp.substring(0, 19)}
        </span>

        {/* 级别 — truncate 防溢出 */}
        <span
          className={`shrink-0 truncate font-semibold ${levelColor(entry.level)}`}
          style={{ width: 70 }}
        >
          [{LEVEL_LABELS[entry.level] ?? entry.level}]
        </span>

        {/* Logger — truncate + title 显示全名 */}
        <span className="shrink-0 truncate text-brand" style={{ width: 180 }} title={entry.logger}>
          {entry.logger}
        </span>

        {/* 消息 */}
        <span className="flex-1 min-w-0 break-all text-text-secondary">
          {longMessage ? (
            <>
              <details className="cursor-pointer">
                <summary className="text-text-muted select-none">
                  {entry.message.substring(0, 300)}…
                </summary>
                <span className="text-text-secondary">
                  {entry.message.substring(300)}
                </span>
              </details>
            </>
          ) : (
            entry.message
          )}
        </span>
      </div>
    );
  }

  /* ── Success ───────────────────────── */
  const entries = data?.entries ?? [];
  const isEmpty = entries.length === 0;

  return (
    <>
    <DataState
      state={fetchState}
      error={errorMsg}
      onRetry={fetchLogs}
      loadingMessage="加载日志…"
    >
      <div className="flex flex-col gap-gm-4">
      {/* 文件元信息 */}
      {data && (
        <div className="flex items-center gap-gm-4 rounded-gm-sm bg-surface-elevated border border-border px-gm-4 py-gm-2 text-gm-xs text-text-muted">
          <span>
            <span className="text-text-secondary font-medium">文件：</span>
            glasscortex.log
          </span>
          <span>
            <span className="text-text-secondary font-medium">大小：</span>
            {formatBytes(data.file_size_bytes)}
          </span>
          <span>
            <span className="text-text-secondary font-medium">总行数：</span>
            {data.total_lines.toLocaleString()}
          </span>
        </div>
      )}

      {/* 过滤工具栏 */}
      <div className="flex flex-wrap items-center gap-gm-3">
        {/* 日志级别 */}
        <div
          className="flex items-center rounded-gm-sm border border-border overflow-hidden"
          role="radiogroup"
          aria-label="日志级别过滤"
        >
          {LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              role="radio"
              aria-checked={level === lv}
              onClick={() => changeLevel(lv)}
              className={`px-gm-3 py-gm-1 text-gm-xs font-medium transition-colors border-r border-border last:border-r-0 ${
                level === lv
                  ? "bg-brand text-text-on-brand"
                  : "bg-surface-elevated text-text-muted hover:text-text-secondary hover:bg-surface-alt"
              }`}
            >
              {LEVEL_LABELS[lv]}
            </button>
          ))}
        </div>

        {/* 行数选择 */}
        <select
          value={tailN}
          onChange={(e) => changeTailN(Number(e.target.value))}
          className="rounded-gm-sm border border-border bg-surface-elevated px-gm-2 py-gm-1 text-gm-xs text-text-secondary"
        >
          {TAIL_OPTIONS.map((n) => (
            <option key={n} value={n}>
              最近 {n} 行
            </option>
          ))}
        </select>

        {/* 关键字搜索 */}
        <div className="relative flex items-center">
          <RiSearchLine className="absolute left-gm-2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => changeKeyword(e.target.value)}
            placeholder="搜索关键字…"
            className="rounded-gm-sm border border-border bg-surface-elevated pl-gm-6 pr-gm-8 py-gm-1 text-gm-xs text-text w-48 focus:outline-none focus:border-brand"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => changeKeyword("")}
              className="absolute right-gm-1 p-0.5 text-text-muted hover:text-text"
              aria-label="清除搜索"
            >
              <RiCloseLine className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 日志列表 / 空状态 */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-gm-3 py-gm-12">
          <RiFileListLine className="w-10 h-10 text-text-muted/50" />
          <p className="text-gm-sm font-medium text-text-muted">
            暂无日志记录
          </p>
          <p className="text-gm-xs text-text-muted">
            {hasActiveFilter
              ? "当前过滤条件未匹配任何日志"
              : "日志文件为空或尚未生成"}
          </p>
        </div>
      ) : (
        <div className="rounded-gm-sm border border-border bg-surface-elevated overflow-hidden">
          {/* 表头 + 日志行共享同一滚动容器 → 列宽天然对齐，无 z-index 冲突 */}
          <div className="max-h-[500px] overflow-y-auto">
            {/* 列头 — 随内容滚动，固定列宽 + truncate 防溢出 */}
            <div className="flex gap-gm-3 px-gm-4 py-gm-1_5 border-b border-border bg-surface-lowered">
              <span
                className="shrink-0 truncate text-gm-xs font-semibold text-text-muted"
                style={{ width: 155 }}
              >
                时间
              </span>
              <span
                className="shrink-0 truncate text-gm-xs font-semibold text-text-muted"
                style={{ width: 70 }}
              >
                级别
              </span>
              <span
                className="shrink-0 truncate text-gm-xs font-semibold text-text-muted"
                style={{ width: 180 }}
              >
                来源
              </span>
              <span className="flex-1 min-w-0 text-gm-xs font-semibold text-text-muted">
                消息
              </span>
            </div>

            {/* 日志行 */}
            {entries.map((entry, idx) => renderLogRow(entry, idx))}
          </div>
        </div>
      )}

      {/* 分页控件 */}
      {!isEmpty && (
        <div className="flex items-center justify-between flex-wrap gap-gm-2">
          <span className="text-gm-xs text-text-muted">
            共 {data!.total_lines.toLocaleString()} 条
            {totalPages > 0 && (
              <>
                ，第 {data!.page}/{totalPages} 页
              </>
            )}
          </span>

          <div className="flex items-center gap-gm-2">
            {/* 每页条数 */}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-gm-sm border border-border bg-surface-elevated px-gm-2 py-gm-1 text-gm-xs text-text-secondary"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 条/页
                </option>
              ))}
            </select>

            {/* 上一页 */}
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-gm-0_5 rounded-gm-sm border border-border bg-surface-elevated px-gm-2 py-gm-1 text-gm-xs text-text-secondary hover:text-text hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RiArrowLeftSLine className="w-4 h-4" />
              上一页
            </button>

            {/* 下一页 */}
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-gm-0_5 rounded-gm-sm border border-border bg-surface-elevated px-gm-2 py-gm-1 text-gm-xs text-text-secondary hover:text-text hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              下一页
              <RiArrowRightSLine className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
    </DataState>

      {/* 单条日志详情抽屉 — 始终渲染以支持 Drawer 退出动画 */}
      <LogDetailModal
        isOpen={selectedLogId !== null}
        logId={selectedLogId ?? 0}
        onClose={() => setSelectedLogId(null)}
        onNavigate={(id) => setSelectedLogId(id)}
      />
    </>
  );
}

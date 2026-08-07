"use client";

/**
 * AdminShell — Admin 管理面板客户端壳。
 *
 * 职责：密码门禁 + Dashboard 状态管理 + Tab 路由。
 * 健康数据 / 文档数据拉取在组件内通过 fetch 完成（不增加 api client 复杂度）。
 *
 * @module app/admin/AdminShell
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { RiLockLine, RiEyeLine, RiEyeOffLine, RiArrowLeftLine, RiRefreshLine } from "@remixicon/react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { api } from "@/lib/api/client";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { useCodeHighlight } from "@/hooks/useCodeHighlight";
import type {
  AdminHealthResponse,
  DocListItem,
  DocContentResponse,
} from "@/lib/api/types";

// ── 常量 ──────────────────────────────────────────────────────────────

/** sessionStorage 键 — 认证通过标记 */
const AUTH_KEY = "gm-admin-authed";
/** 默认密码（环境变量未设置时） */
const DEFAULT_PASSWORD = "Coder@9527";

// ── 工具函数 ──────────────────────────────────────────────────────────

/** 获取配置的 Admin 密码 */
function getAdminPassword(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ADMIN_PASSWORD) {
    return process.env.NEXT_PUBLIC_ADMIN_PASSWORD;
  }
  return DEFAULT_PASSWORD;
}

/** 格式化字节数 */
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 格式化日期 — "2026-08-07" → "8月7日" */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ═══════════════════════════════════════════════════════════════════════
// AdminShell — 主组件
// ═══════════════════════════════════════════════════════════════════════

/** Tab 键 */
type TabKey = "health" | "docs";

export default function AdminShell() {
  // ── 认证状态 — 从 sessionStorage 惰性初始化（关 tab 即失效）──
  const [authed, setAuthed] = useState(() => {
    if (typeof sessionStorage !== "undefined") {
      return sessionStorage.getItem(AUTH_KEY) === "1";
    }
    return false;
  });

  // ── Tab 状态 ──
  const [activeTab, setActiveTab] = useState<TabKey>("health");

  // ── 文档选中 ──
  const [selectedDoc, setSelectedDoc] = useState<DocListItem | null>(null);
  const [docContent, setDocContent] = useState<DocContentResponse | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  /** 加载文档内容 */
  const loadDoc = useCallback(async (item: DocListItem) => {
    if (item.is_directory) return;
    setSelectedDoc(item);
    setDocContent(null);
    setDocError(null);
    setDocLoading(true);
    try {
      const data = await api.getDocContent(item.path.replace(/^docs\//, ""));
      setDocContent(data);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setDocLoading(false);
    }
  }, []);

  /** 返回文档列表 */
  const backToDocs = useCallback(() => {
    setSelectedDoc(null);
    setDocContent(null);
    setDocError(null);
  }, []);

  // ── 渲染 ──

  if (!authed) {
    return <PasswordGate onSuccess={() => { sessionStorage.setItem(AUTH_KEY, "1"); setAuthed(true); }} />;
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* 顶部栏 */}
      <TopBar activeTab={activeTab} onTab={setActiveTab} onLogout={() => { sessionStorage.removeItem(AUTH_KEY); setAuthed(false); }} />

      {/* 内容区 */}
      <main className="mx-auto max-w-7xl px-gm-5 py-gm-5">
        {activeTab === "health" && <HealthPanel />}
        {activeTab === "docs" && (
          selectedDoc ? (
            <DocViewer
              item={selectedDoc}
              content={docContent}
              loading={docLoading}
              error={docError}
              onBack={backToDocs}
            />
          ) : (
            <DocsPanel onSelectDoc={loadDoc} />
          )
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PasswordGate — 密码门禁
// ═══════════════════════════════════════════════════════════════════════

function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [shaking, setShaking] = useState(false);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (input === getAdminPassword()) {
      onSuccess();
    } else {
      setError(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  }, [input, onSuccess]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-lowered">
      <div className={`w-full max-w-sm mx-gm-4 rounded-gm-xl bg-surface-elevated border border-border shadow-gm-lg p-gm-8 ${shaking ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
        {/* Logo + 标题 */}
        <div className="text-center mb-gm-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-gm-xl bg-brand-50 mb-gm-3">
            <RiLockLine className="text-gm-xl text-brand" />
          </div>
          <h1 className="text-gm-lg font-semibold text-text">工程管理面板</h1>
          <p className="text-gm-xs text-text-muted mt-gm-1">请输入管理密码以继续</p>
        </div>

        {/* 密码表单 */}
        <form onSubmit={handleSubmit} className="space-y-gm-3">
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(false); }}
              placeholder="输入密码"
              autoFocus
              className={`w-full rounded-gm-md border bg-surface-lowered px-gm-4 py-gm-2 pr-gm-10 text-gm-sm text-text placeholder:text-text-muted/50 outline-none transition-colors focus:ring-2 focus:ring-brand/40 ${
                error ? "border-red-500 bg-red-50/30" : "border-border focus:border-brand"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-gm-2 top-1/2 -translate-y-1/2 p-gm-1 text-text-muted hover:text-text-secondary transition-colors"
              aria-label={showPw ? "隐藏密码" : "显示密码"}
            >
              {showPw ? <RiEyeOffLine className="text-gm-icon" /> : <RiEyeLine className="text-gm-icon" />}
            </button>
          </div>
          {error && (
            <p className="text-gm-xs text-red-500 animate-[fadeIn_0.2s_ease-in-out]">密码错误，请重试</p>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-full rounded-gm-md bg-brand text-white text-gm-sm font-medium py-gm-2 transition-all hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            进入面板
          </button>
        </form>
      </div>

      {/* 抖动关键帧 */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(4px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TopBar — 顶部工具栏
// ═══════════════════════════════════════════════════════════════════════

const TABS: { key: TabKey; label: string }[] = [
  { key: "health", label: "健康概览" },
  { key: "docs", label: "文档清单" },
];

function TopBar({
  activeTab,
  onTab,
  onLogout,
}: {
  activeTab: TabKey;
  onTab: (t: TabKey) => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 bg-surface-elevated/80 backdrop-blur border-b border-border shadow-gm-xs">
      <div className="mx-auto max-w-7xl px-gm-5 py-gm-3 flex items-center justify-between">
        <div className="flex items-center gap-gm-5">
          {/* 品牌 */}
          <div className="flex items-center gap-gm-2 select-none">
            <div className="w-7 h-7 rounded-gm-md bg-brand-50 flex items-center justify-center">
              <RiLockLine className="text-gm-sm text-brand" />
            </div>
            <span className="text-gm-sm font-semibold text-text tracking-tight">
              GlassCortex Admin
            </span>
          </div>

          {/* Tab 导航 */}
          <nav className="flex items-center gap-gm-1 ml-gm-3">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onTab(key)}
                className={`rounded-gm-sm px-gm-3 py-gm-1 text-gm-sm transition-all ${
                  activeTab === key
                    ? "text-brand bg-brand-50/50 font-medium"
                    : "text-text-muted hover:text-text-secondary hover:bg-surface-alt"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* 操作区：主题切换 + 退出 */}
        <div className="flex items-center gap-gm-2">
          <ThemeToggle />
          <button
            onClick={onLogout}
            className="rounded-gm-sm px-gm-3 py-gm-1 text-gm-xs text-text-muted hover:text-red-500 hover:bg-red-50/30 transition-all"
          >
            退出
          </button>
        </div>
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HealthPanel — 健康概览面板
// ═══════════════════════════════════════════════════════════════════════

function HealthPanel() {
  const [data, setData] = useState<AdminHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await api.getAdminHealth();
      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await api.getAdminHealth();
        if (!cancelled) { setData(json); setLastUpdated(new Date()); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-gm-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-gm-lg bg-surface-elevated border border-border p-gm-5">
            <div className="w-40 h-4 rounded-gm-sm gm-skeleton-shimmer mb-gm-3" />
            <div className="w-full h-20 rounded-gm-md gm-skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">健康数据加载失败</p>
        <p className="text-gm-xs text-red-500 mt-gm-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  // ── 摘要卡片 ──
  const summaryCards = [
    {
      label: "当前 Phase",
      value: data.current_phase ? `Phase ${data.current_phase}` : "—",
      sub: data.current_batch ? `Batch ${data.current_batch}` : "",
      ok: true,
    },
    {
      label: "L5 拉通间隔",
      value: `${data.l5.batches_since_last} 批`,
      sub: data.l5.blocked ? "⚠️ 已阻断" : data.l5.last_l5_batch || "",
      ok: !data.l5.blocked,
    },
    {
      label: "违纪状态",
      value: data.violations.is_blocked ? "🔴 已阻断" : "✅ 正常",
      sub: data.violations.summary.replace(/^📊 违纪统计: /, ""),
      ok: !data.violations.is_blocked,
    },
    {
      label: "硬阻断",
      value: data.hard_failures === 0 ? "✅ 零阻断" : `❌ ${data.hard_failures} 项`,
      sub: data.hard_failures === 0 ? "所有门禁通过" : "需要修复",
      ok: data.hard_failures === 0,
    },
    {
      label: "日报状态",
      value: data.daily.today_exists ? "✅ 今日已写" : data.daily.yesterday_exists ? "⚠️ 今日未写" : "❌ 缺失",
      sub: data.daily.yesterday_date ? `昨日: ${fmtDate(data.daily.yesterday_date)}` : "",
      ok: data.daily.today_exists,
    },
    {
      label: "需求日志",
      value: data.doc_freshness.requirements_last_date
        ? `最后更新 ${fmtDate(data.doc_freshness.requirements_last_date)}`
        : "—",
      sub: "",
      ok: true,
    },
  ];

  // ── 门禁清单 ──
  const checkEntries = Object.entries(data.checks);

  return (
    <div className="space-y-gm-5">
      {/* 操作栏：刷新 + 最后更新时间 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-gm-3">
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-gm-1.5 rounded-gm-md border border-border bg-surface-elevated px-gm-3 py-gm-1.5 text-gm-xs text-text-secondary hover:bg-surface-alt transition-all disabled:opacity-50"
          >
            <RiRefreshLine className={`text-gm-icon ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          {lastUpdated && (
            <span className="text-gm-xs text-text-muted">
              最后更新：{lastUpdated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {/* 摘要卡片网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-gm-3">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-gm-lg border p-gm-4 transition-colors ${
              card.ok
                ? "bg-surface-elevated border-border"
                : "bg-red-50/10 border-red-200"
            }`}
          >
            <p className="text-gm-xs text-text-muted mb-gm-1">{card.label}</p>
            <p className={`text-gm-base font-semibold ${card.ok ? "text-text" : "text-red-500"}`}>
              {card.value}
            </p>
            {card.sub && (
              <p className="text-gm-xs text-text-muted mt-gm-0.5 truncate">{card.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* 门禁明细 */}
      <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
        <div className="px-gm-5 py-gm-3 border-b border-border bg-surface-lowered/50">
          <h2 className="text-gm-sm font-semibold text-text">门禁检查明细</h2>
        </div>
        <div className="divide-y divide-border">
          {checkEntries.map(([name, check]) => (
            <div key={name} className="px-gm-5 py-gm-3 hover:bg-surface-alt/30 transition-colors">
              <div className="flex items-start gap-gm-2">
                <span className={`mt-px text-gm-sm ${check.exit_code === 0 ? "text-green-500" : "text-red-500"}`}>
                  {check.exit_code === 0 ? "✅" : "❌"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-gm-sm font-medium ${check.exit_code === 0 ? "text-text" : "text-red-500"}${check.is_critical ? "" : ""}`}>
                    {name}
                    {check.is_critical && (
                      <span className="ml-gm-1.5 text-gm-xs text-red-400 font-normal">[阻断]</span>
                    )}
                  </p>
                  {check.lines.length > 0 && check.lines[0] && (
                    <p className="text-gm-xs text-text-muted mt-gm-0.5 line-clamp-2">{check.lines[0]}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 最近提交 */}
      <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
        <div className="px-gm-5 py-gm-3 border-b border-border bg-surface-lowered/50">
          <h2 className="text-gm-sm font-semibold text-text">最近提交</h2>
        </div>
        <div className="divide-y divide-border">
          {data.recent_commits.slice(0, 5).map((commit, i) => (
            <div key={i} className="px-gm-5 py-gm-2.5 hover:bg-surface-alt/30 transition-colors">
              <p className="text-gm-xs text-text font-mono leading-relaxed break-all">{commit}</p>
            </div>
          ))}
          {data.recent_commits.length === 0 && (
            <div className="px-gm-5 py-gm-4 text-center text-gm-xs text-text-muted">无提交记录</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DocsPanel — 文档清单面板
// ═══════════════════════════════════════════════════════════════════════

/** 文档分组排序权重（数字越小越靠前） */
const GROUP_ORDER: Record<string, number> = {
  "核心文档": 0,
  "经验库": 1,
  "治理看板": 2,
  "参考手册": 3,
  "日报": 4,
  "归档": 5,
  "其他": 99,
};

function DocsPanel({ onSelectDoc }: { onSelectDoc: (item: DocListItem) => void }) {
  const [items, setItems] = useState<DocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await api.getDocs();
        if (!cancelled) setItems(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── 按 group 分组排序 ──
  const grouped = useMemo(() => {
    const map = new Map<string, { items: DocListItem[]; dirs: DocListItem[] }>();
    for (const item of items) {
      if (!map.has(item.group)) {
        map.set(item.group, { items: [], dirs: [] });
      }
      const entry = map.get(item.group)!;
      if (item.is_directory) {
        entry.dirs.push(item);
      } else {
        entry.items.push(item);
      }
    }
    // 按 GROUP_ORDER 排序
    const sorted = Array.from(map.entries()).sort(
      (a, b) => (GROUP_ORDER[a[0]] ?? 99) - (GROUP_ORDER[b[0]] ?? 99)
    );
    return sorted;
  }, [items]);

  if (loading) {
    return (
      <div className="space-y-gm-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-gm-lg bg-surface-elevated border border-border p-gm-5">
            <div className="w-24 h-3 rounded-gm-sm gm-skeleton-shimmer mb-gm-3" />
            <div className="space-y-gm-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="w-full h-6 rounded-gm-sm gm-skeleton-shimmer" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">文档清单加载失败</p>
        <p className="text-gm-xs text-red-500 mt-gm-1">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-gm-lg bg-surface-elevated border border-border p-gm-8 text-center">
        <p className="text-gm-sm text-text-muted">暂无文档</p>
      </div>
    );
  }

  return (
    <div className="space-y-gm-4">
      {grouped.map(([group, { items: groupItems, dirs }]) => (
        <DocGroup key={group} group={group} items={groupItems} dirs={dirs} onSelectDoc={onSelectDoc} />
      ))}
    </div>
  );
}

/** 文档分组 — 可折叠区域 */
function DocGroup({
  group,
  items,
  dirs,
  onSelectDoc,
}: {
  group: string;
  items: DocListItem[];
  dirs: DocListItem[];
  onSelectDoc: (item: DocListItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-gm-5 py-gm-3 hover:bg-surface-alt/30 transition-colors text-left"
      >
        <div className="flex items-center gap-gm-2">
          <span className={`text-gm-xs transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
          <h3 className="text-gm-sm font-semibold text-text">{group}</h3>
          <span className="text-gm-xs text-text-muted">
            {items.length + dirs.length} 个文件
          </span>
        </div>
      </button>

      {expanded && (
        <div className="divide-y divide-border border-t border-border">
          {/* 目录项（日报/归档等） */}
          {dirs.map((dir) => (
            <DocDirRow key={dir.path} dir={dir} onSelectDoc={onSelectDoc} />
          ))}

          {/* 文件项 */}
          {items.map((item) => (
            <DocFileRow key={item.path} item={item} onClick={() => onSelectDoc(item)} />
          ))}

          {items.length === 0 && dirs.length === 0 && (
            <div className="px-gm-5 py-gm-3 text-center text-gm-xs text-text-muted">
              此分组下暂无文档
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 目录行 — 展开显示子文档列表 */
function DocDirRow({
  dir,
  onSelectDoc,
}: {
  dir: DocListItem;
  onSelectDoc: (item: DocListItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-gm-3 px-gm-5 py-gm-2.5 hover:bg-surface-alt/30 transition-colors text-left"
      >
        <span className={`text-gm-xs text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
        <RiLockLine className="text-gm-icon text-text-muted" />
        <span className="text-gm-sm text-text font-medium">{dir.name}</span>
        <span className="text-gm-xs text-text-muted">{dir.count ?? 0} 个文件</span>
      </button>

      {expanded && dir.children && (
        <div className="border-t border-border bg-surface-lowered/30">
          {dir.children.map((child) => (
            <DocFileRow
              key={child.path}
              item={child}
              onClick={() => onSelectDoc(child)}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 文档文件行 */
function DocFileRow({
  item,
  onClick,
  indent = false,
}: {
  item: DocListItem;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-gm-3 px-gm-5 py-gm-2.5 hover:bg-surface-alt/30 transition-colors text-left ${
        indent ? "pl-gm-10" : ""
      }`}
    >
      <span className="text-gm-sm text-text truncate flex-1">{item.name}</span>
      <span className="text-gm-xs text-text-muted shrink-0">{item.lines} 行</span>
      <span className="text-gm-xs text-text-muted/60 shrink-0 w-12 text-right">{fmtBytes(item.size_bytes)}</span>
      <span className="text-gm-xs text-text-muted/60 shrink-0 w-14 text-right">{fmtDate(item.mtime)}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DocViewer — 文档阅读器
// ═══════════════════════════════════════════════════════════════════════

function DocViewer({
  item,
  content,
  loading,
  error,
  onBack,
}: {
  item: DocListItem;
  content: DocContentResponse | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
}) {
  const docBodyRef = useRef<HTMLDivElement>(null);
  useCodeHighlight(docBodyRef, [content]);

  return (
    <div className="rounded-gm-lg bg-surface-elevated border border-border overflow-hidden">
      {/* 文档头部 */}
      <div className="flex items-center gap-gm-3 px-gm-5 py-gm-3 border-b border-border bg-surface-lowered/50">
        <button
          onClick={onBack}
          className="rounded-gm-sm p-gm-1 text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
          aria-label="返回文档列表"
        >
          <RiArrowLeftLine className="text-gm-icon" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-gm-sm font-semibold text-text truncate">{item.name}</h2>
          <p className="text-gm-xs text-text-muted">
            {item.path} · {item.lines} 行 · {fmtBytes(item.size_bytes)}
          </p>
        </div>
      </div>

      {/* 文档内容 */}
      <div className="p-gm-5 min-h-[50vh]">
        {loading && (
          <div className="space-y-gm-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-4 rounded-gm-sm gm-skeleton-shimmer"
                style={{ width: `${65 + (i * 7) % 30}%` }}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-gm-8">
            <p className="text-gm-sm text-red-500">文档加载失败</p>
            <p className="text-gm-xs text-text-muted mt-gm-1">{error}</p>
          </div>
        )}

        {content && (
          <div
            ref={docBodyRef}
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content.content) }}
          />
        )}
      </div>
    </div>
  );
}

/** Page navigation links — single source of truth shared by Header (desktop) and AppShell (mobile drawer). */

/** All 5 page links — used by Header for desktop nav. */
export const PAGE_LINKS = [
  { href: "/", label: "聊天" },
  { href: "/learn", label: "问答" },
  { href: "/observability", label: "可观测" },
  { href: "/lab", label: "实验室" },
  { href: "/profile", label: "画像" },
] as const;

/**
 * 移动端 3 页 — 移动端范围约束，见 memory mobile-scope-constraint。
 * 可观测/lab 为开发者桌面面板，移动端暂不提供服务。
 */
export const MOBILE_LINKS = [
  { href: "/", label: "聊天" },
  { href: "/learn", label: "问答" },
  { href: "/profile", label: "画像" },
] as const;

/**
 * Desktop nav link styles.
 * Extracted from Header.tsx — character-for-character identical to the inlined version.
 */
export function linkClass(href: string, pathname: string): string {
  return pathname === href
    ? "rounded-gm-sm px-gm-3 py-gm-1 text-gm-sm text-brand bg-brand-50/50 font-medium active:brightness-90 transition-all"
    : "rounded-gm-sm px-gm-3 py-gm-1 text-gm-sm text-text-muted hover:text-text-secondary active:text-text active:bg-surface-alt transition-all";
}

/**
 * Mobile drawer nav link styles: full-width blocks with larger touch targets.
 */
export function mobileLinkClass(href: string, pathname: string): string {
  return pathname === href
    ? "block rounded-gm-sm px-gm-4 py-gm-2 text-gm-sm text-brand bg-brand-50/50 font-medium active:brightness-90 transition-all"
    : "block rounded-gm-sm px-gm-4 py-gm-2 text-gm-sm text-text-muted hover:text-text-secondary hover:bg-surface-alt active:text-text active:bg-surface-alt transition-all";
}

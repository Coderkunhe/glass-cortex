import { RiBrainLine, RiDashboardLine, RiGithubFill } from "@remixicon/react";
import Link from "next/link";

/**
 * 全局底栏——全宽背景条，内容区对齐主内容列。
 * 品牌收拢：GlassCortex + 版本号 + 标语 + 工程入口 + 源码链接。
 */
export default function Footer() {
  return (
    <footer
      className="lg:col-start-1 lg:col-span-2
                 bg-surface-elevated/60 backdrop-blur
                 border-t border-border"
    >
      <div
        className="flex flex-col sm:flex-row items-center justify-between gap-gm-2
                   px-gm-5 py-gm-3
                   text-gm-xs text-text-muted"
      >
        <div className="flex items-center gap-gm-2">
          <RiBrainLine size={14} />
          <span className="font-medium text-text">GlassCortex</span>
          <span className="text-gm-xs text-text-muted">v0.1.0</span>
          <span className="text-border-strong">·</span>
          <span>逐层解剖 AI Robot 工作原理</span>
        </div>
        <div className="flex items-center gap-gm-3">
          <a
            href="https://github.com/Coderkunhe/glass-cortex"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-gm-1 hover:text-text transition-colors"
          >
            <RiGithubFill size={14} />
            <span>GitHub</span>
          </a>
          <Link
            href="/admin"
            className="flex items-center gap-gm-1 hover:text-text transition-colors"
          >
            <RiDashboardLine size={14} />
            <span>AI 工程</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}

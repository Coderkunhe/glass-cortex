import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  /** Phase 67 B1: standalone 输出——不依赖 node_modules 的自包含部署产物 */
  output: "standalone",
  /** Next.js 15.2.2+ HMR origin 白名单 — 127.0.0.1 默认被阻止，需显式允许 */
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  /**
   * Phase 67 B27: 固定 Turbopack workspace root 到 frontend/（本文件所在目录）。
   * 父目录 ai/ 存在空 package-lock.json 残留时，Next.js 会误推断 workspace root
   * 为 ai/（20+ 个项目目录），导致 Turbopack 扫描整个父目录 → 首次编译爆炸
   * （/learn 72s · next-server 内存 4.5GB）→ check-theme page.goto 超时。
   * 用 import.meta.url 定位本文件目录，不依赖启动 cwd（process.cwd() 在
   * 项目根启动时会指到无 node_modules 的根目录，导致 remixicon 解析失败）。
   */
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;

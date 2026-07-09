import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  /** Phase 67 B1: standalone 输出——不依赖 node_modules 的自包含部署产物 */
  output: "standalone",
  /** Next.js 15.2.2+ HMR origin 白名单 — 127.0.0.1 默认被阻止，需显式允许 */
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;

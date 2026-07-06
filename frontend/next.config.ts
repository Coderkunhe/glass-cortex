import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  /** Next.js 15.2.2+ HMR origin 白名单 — 127.0.0.1 默认被阻止，需显式允许 */
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;

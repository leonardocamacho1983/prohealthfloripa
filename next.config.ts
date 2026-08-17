import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this application when another lockfile exists in
  // a parent directory on a developer machine.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

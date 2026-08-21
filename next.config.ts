import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this application when another lockfile exists in
  // a parent directory on a developer machine.
  turbopack: {
    root: process.cwd(),
  },
  images: {
    qualities: [75, 80, 82, 84, 86, 88],
  },
};

export default nextConfig;

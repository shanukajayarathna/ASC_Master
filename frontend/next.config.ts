import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly: the repo root now also has a package-lock.json
  // (for the `concurrently`-based `npm run dev` that starts both frontend and backend),
  // which otherwise makes Turbopack guess wrong about which directory is the app root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

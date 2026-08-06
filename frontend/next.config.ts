import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly: the repo root now also has a package-lock.json
  // (for the `concurrently`-based `npm run dev` that starts both frontend and backend),
  // which otherwise makes Turbopack guess wrong about which directory is the app root.
  turbopack: {
    root: path.join(__dirname),
  },
  // Launchpad module tiles (frontend/src/components/shell/nav.ts) reference specific,
  // verified Unsplash CDN photos for their artwork. next/image needs the remote host
  // allow-listed; Unsplash's own image-resizing query params (w/q/fm/fit) are used
  // directly rather than duplicating that logic in next/image's own optimizer.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
};

export default nextConfig;

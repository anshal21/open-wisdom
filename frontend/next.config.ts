import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output traces the modules the server actually imports and emits
   * a self-contained bundle.
   *
   * The container previously copied the whole 517 MB `node_modules` into the
   * runtime image and then `chown -R`'d it for the non-root user — 80 seconds
   * of the build spent changing ownership on files the server never loads, and
   * a layer large enough that exporting it filled the disk.
   */
  output: "standalone",
};

export default nextConfig;

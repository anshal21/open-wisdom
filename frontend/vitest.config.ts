import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // `.tsx` is included deliberately: the previous glob was `*.test.ts`, so a
  // component test named `foo.test.tsx` was silently never collected and the
  // run stayed green while proving nothing.
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});

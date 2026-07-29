import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@oleafly/editor": path.resolve(__dirname, "./packages/editor/src"),
    },
  },
  test: {
    include: ["test/performance/**/*.perf.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});

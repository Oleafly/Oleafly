import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@openleaf/latex": path.resolve(__dirname, "./packages/latex/src"),
      "@openleaf/ai-core": path.resolve(__dirname, "./packages/ai-core/src"),
      "@openleaf/diagram": path.resolve(__dirname, "./packages/diagram/src"),
      "@openleaf/preview": path.resolve(__dirname, "./packages/preview/src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
  },
});

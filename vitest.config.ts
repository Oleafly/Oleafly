import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@oleafly/latex": path.resolve(__dirname, "./packages/latex/src"),
      "@oleafly/ai-core": path.resolve(__dirname, "./packages/ai-core/src"),
      "@oleafly/diagram": path.resolve(__dirname, "./packages/diagram/src"),
      "@oleafly/editor": path.resolve(__dirname, "./packages/editor/src"),
      "@oleafly/ai-tools": path.resolve(__dirname, "./packages/ai-tools/src"),
      "@oleafly/preflight": path.resolve(__dirname, "./packages/preflight/src"),
      "@oleafly/registry": path.resolve(__dirname, "./packages/registry/src"),
      "@oleafly/templates": path.resolve(__dirname, "./packages/templates/src"),
      "@oleafly/preview": path.resolve(__dirname, "./packages/preview/src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
  },
});

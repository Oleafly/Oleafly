import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { WEB_ALIASES } from "./vite.web.config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: WEB_ALIASES },
  test: {
    root: path.resolve(__dirname),
    environment: "jsdom",
    include: ["web/src/**/*.test.ts", "web/src/**/*.test.tsx", "web/dev/**/*.test.ts"],
    setupFiles: ["./web/vitest.setup.ts"],
  },
});

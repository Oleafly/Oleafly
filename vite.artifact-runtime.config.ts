import path from "node:path";
import { defineConfig } from "vite";

export const ARTIFACT_RUNTIME_DIR = "public/artifact-runtime";
export const ARTIFACT_RUNTIME_FILE = "react-runtime.js";

export default defineConfig({
  publicDir: false,
  logLevel: "warn",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: ARTIFACT_RUNTIME_DIR,
    emptyOutDir: true,
    copyPublicDir: false,
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 8192,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/components/notes/artifact-runtime/react-runtime.ts"),
      name: "OleaflyArtifactRuntime",
      formats: ["iife"],
      fileName: () => ARTIFACT_RUNTIME_FILE,
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTauriTest } from "@srsholmes/tauri-playwright";

// Load opt-in secrets/flags from e2e/.env (gitignored; see e2e/.env.example).
// This must run HERE, not only in playwright.config.ts: Playwright workers are
// separate processes that do not inherit process.env mutations made while the
// main process evaluated the config. Every spec imports this module, so the
// values are guaranteed visible to test.skip() gates. Shell env wins.
// Workers transpile specs as ESM, where __dirname does not exist - probe the
// likely locations instead of trusting any one module system.
const envCandidates: string[] = [];
try {
  envCandidates.push(join(__dirname, ".env"));
} catch {
  /* ESM: no __dirname */
}
envCandidates.push(join(process.cwd(), "e2e", ".env"), join(process.cwd(), ".env"));
for (const p of envCandidates) {
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch {
    continue;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  break;
}

/**
 * Shared Playwright fixtures. In `tauri` mode (the only mode we use), tests
 * drive the REAL app over the plugin's socket bridge: real webview, real Rust
 * backend, real Tectonic compiles. Start the app first:
 *
 *   OPENLEAF_DATA_DIR=$(mktemp -d) pnpm tauri dev --features e2e-testing
 */
export const { test, expect } = createTauriTest({
  devUrl: "http://localhost:1420",
  mcpSocket: process.env.TAURI_PLAYWRIGHT_SOCKET ?? "/tmp/tauri-playwright.sock",
});

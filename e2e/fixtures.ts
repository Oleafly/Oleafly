import { createTauriTest } from "@srsholmes/tauri-playwright";

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

import { defineConfig } from "@playwright/test";

/**
 * OpenLeaf e2e: user journeys against the real desktop app (no mocks).
 * The app must already be running with the e2e bridge compiled in:
 *
 *   OPENLEAF_DATA_DIR=$(mktemp -d) pnpm tauri dev --features e2e-testing
 *   pnpm test:e2e
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  // The socket bridge drives one app instance; never parallelize against it.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  projects: [
    {
      name: "tauri",
      use: { mode: "tauri" },
    },
  ],
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Load opt-in secrets/flags from e2e/.env (gitignored; see e2e/.env.example).
// Values already set in the shell take precedence.
try {
  const env = readFileSync(join(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env file: everything stays opt-out */
}

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

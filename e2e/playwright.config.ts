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

// The app must already be running with the e2e bridge compiled in:
//
//   OPENLEAF_DATA_DIR=$(mktemp -d) pnpm tauri dev --features e2e-testing
//   pnpm test:e2e
export default defineConfig({
  testDir: "./tests",
  // Compile+render tests can legitimately need a couple of minutes on a loaded
  // CI runner (real Tauri app, Tectonic compile, pdf.js render), so the per-test
  // cap has to clear that. Tests still set their own longer setTimeout as needed.
  timeout: 240_000,
  // Release E2E evidence must expose every flake instead of hiding it behind a
  // retry. Individual tests own any explicit polling needed for real sidecars.
  retries: 0,
  // The socket bridge drives one app instance; never parallelize against it.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  // Trace on failure is small and debuggable; video is off (the driver's macOS
  // screencast bloated failure artifacts to hundreds of MB and ate runner disk).
  use: { trace: "retain-on-failure", video: "off", screenshot: "only-on-failure" },
  projects: [
    {
      name: "tauri",
      use: { mode: "tauri" },
    },
  ],
});

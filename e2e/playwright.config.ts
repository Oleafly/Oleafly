import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

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

export default defineConfig({
  testDir: "./tests",
  // Compile+render tests can legitimately need a couple of minutes on a loaded
  // CI runner (real Tauri app, Tectonic compile, pdf.js render), so the per-test
  // cap has to clear that. Tests still set their own longer setTimeout as needed.
  timeout: 240_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  // Playwright enables diff capture in CI and fetches the PR base SHA for
  // every invocation. On Windows that three-second fetch can time out without
  // terminating the child process, eventually overflowing Playwright's stdout
  // buffer before any test starts. The list reporter does not consume the
  // source diff, so keep commit metadata while skipping that remote operation.
  captureGitInfo: { diff: false },
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

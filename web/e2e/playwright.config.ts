import { defineConfig, devices } from "@playwright/test";

// The browser app against the dev mock server, with the test engine built in:
//
//   pnpm web:e2e
//
// Both servers start on their own ports, so a `pnpm web:dev` already running
// on the usual ones is left alone.
const MOCK_PORT = 4884;
const WEB_PORT = 1431;

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "node --experimental-transform-types --no-warnings web/dev/mock-server.ts",
      cwd: "../..",
      env: { OLEAFLY_WEB_MOCK_PORT: String(MOCK_PORT) },
      url: `http://127.0.0.1:${MOCK_PORT}/web/sign-in`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite --config vite.web.config.ts --port ${WEB_PORT}`,
      cwd: "../..",
      env: { OLEAFLY_WEB_DEV_SERVER: `http://127.0.0.1:${MOCK_PORT}`, VITE_OLEAFLY_FAKE_ENGINE: "1" },
      url: `http://localhost:${WEB_PORT}/web/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

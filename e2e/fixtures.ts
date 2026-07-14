import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import {
  createTauriTest,
  PluginClient,
  TauriPage,
  tauriExpect,
} from "@srsholmes/tauri-playwright";

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

// In `tauri` mode (the only mode we use), tests drive the REAL app over the
// plugin's socket bridge: real webview, real Rust backend, real Tectonic
// compiles. Start the app first:
//
//   OPENLEAF_DATA_DIR=$(mktemp -d) pnpm tauri dev --features e2e-testing
const DEV_URL = "http://localhost:1420";

// Windows: the plugin serves TCP (no unix sockets), but createTauriTest's
// external-launch path only ever connects to a socket PATH, so build the
// tauriPage fixture ourselves from the exported client classes. Mirrors the
// upstream fixture: connect, ping, reload to the dev URL, wait for the
// bridge marker.
function createWindowsTcpTest() {
  const port = Number(process.env.TAURI_PLAYWRIGHT_TCP_PORT ?? 6274);
  const test = base.extend<{ tauriPage: TauriPage }>({
    tauriPage: async ({}, use) => {
      const client = new PluginClient(undefined, port);
      let lastErr: unknown = null;
      for (let i = 0; i < 30; i++) {
        try {
          await client.connect();
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
      if (lastErr) throw lastErr;
      const ping = await client.send({ type: "ping" });
      if (!ping.ok) throw new Error("plugin ping failed over tcp");
      const page = new TauriPage(client);
      await page.evaluate(`window.location.href = ${JSON.stringify(DEV_URL)}`);
      await new Promise((r) => setTimeout(r, 500));
      await page.waitForFunction('document.readyState === "complete" && !!window.__PW_ACTIVE__');
      try {
        await use(page);
      } finally {
        client.disconnect();
      }
    },
  });
  return {
    test: test as unknown as ReturnType<typeof createTauriTest>["test"],
    expect: tauriExpect as ReturnType<typeof createTauriTest>["expect"],
  };
}

export const { test, expect } =
  process.platform === "win32"
    ? createWindowsTcpTest()
    : createTauriTest({
        devUrl: DEV_URL,
        mcpSocket: process.env.TAURI_PLAYWRIGHT_SOCKET ?? "/tmp/tauri-playwright.sock",
      });

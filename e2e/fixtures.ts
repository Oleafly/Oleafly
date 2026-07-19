import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import {
  createTauriTest,
  PluginClient,
  TauriPage,
  tauriExpect,
} from "@srsholmes/tauri-playwright";
import { tourRegistry } from "../src/lib/tours/registry";

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
let nativePageOpened = false;
const DISMISSED_TOUR_STATE = JSON.stringify({
  state: {
    schemaVersion: 1,
    enabled: false,
    tours: {
      home: { status: "dismissed", version: tourRegistry.home.version },
      workspace: { status: "dismissed", version: tourRegistry.workspace.version },
      settings: { status: "dismissed", version: tourRegistry.settings.version },
      ai: { status: "dismissed", version: tourRegistry.ai.version },
      diagram: { status: "dismissed", version: tourRegistry.diagram.version },
    },
  },
  version: 1,
});

export async function reloadNativePage(page: TauriPage) {
  await page.evaluate(`window.__E2E_RELOAD_PENDING__ = true`);
  await page.evaluate(
    `import("/src/lib/tauri.ts").then(({ reloadViews }) => reloadViews())`,
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const pending = await page.evaluate(
        `window.__E2E_RELOAD_PENDING__ === true`,
      );
      if (!pending) break;
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await page.waitForFunction(
    'document.readyState === "complete" && !!window.__PW_ACTIVE__',
    20_000,
  );
}

async function ensureNativePageReady(page: TauriPage) {
  try {
    await page.waitForFunction(
      'document.readyState === "complete" && !!window.__PW_ACTIVE__',
      10_000,
    );
  } catch {
    await reloadNativePage(page);
  }
}

function createNativeTest(dismissTours: boolean) {
  const port = Number(process.env.TAURI_PLAYWRIGHT_TCP_PORT ?? 6274);
  const socket = process.env.TAURI_PLAYWRIGHT_SOCKET ?? "/tmp/tauri-playwright.sock";
  const test = base.extend<{ tauriPage: TauriPage }>({
    tauriPage: async ({}, use) => {
      const client =
        process.platform === "win32"
          ? new PluginClient(undefined, port)
          : new PluginClient(socket);
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
      if (!ping.ok) throw new Error("plugin ping failed");
      const page = new TauriPage(client);
      page.setDefaultTimeout(20_000);
      const firstPage = !nativePageOpened;
      if (nativePageOpened) {
        await reloadNativePage(page);
      }
      await ensureNativePageReady(page);
      if (firstPage) {
        await page.evaluate(`localStorage.removeItem("oleafly.shortcuts")`);
        await reloadNativePage(page);
      }
      if (dismissTours) {
        await page.evaluate(
          `localStorage.setItem("oleafly.tours", ${JSON.stringify(DISMISSED_TOUR_STATE)})`,
        );
        await reloadNativePage(page);
      }
      nativePageOpened = true;
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
  createNativeTest(true);
export const { test: tourTest, expect: tourExpect } = createNativeTest(false);

// The bridge's per-command default is 5s, which a loaded CI runner routinely
// blows on an otherwise-fine fill/click/waitForFunction, so a different test
// flakes each run. Raise it so transient load can't fail a healthy command.
test.beforeEach(async ({ tauriPage }) => {
  tauriPage.setDefaultTimeout(20_000);
});

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
//   OLEAFLY_DATA_DIR=$(mktemp -d) pnpm tauri dev --features e2e-testing
let nativePageOpened = false;
const productionE2e = process.env.OLEAFLY_E2E_PRODUCTION === "1";
const DISMISSED_TOUR_STATE = JSON.stringify({
  state: {
    schemaVersion: 1,
    enabled: false,
    tours: Object.fromEntries(
      Object.entries(tourRegistry).map(([id, definition]) => [
        id,
        { status: "dismissed", version: definition.version },
      ]),
    ),
  },
  version: 1,
});

export async function reloadNativePage(page: TauriPage) {
  if (productionE2e) {
    throw new Error(
      "packaged E2E smoke tests run one test per app launch; production reload is unsupported",
    );
  }
  const mainWindow = await page.waitForWindow((window) => window.label === "main", {
    timeout: 20_000,
  });
  await mainWindow.evaluate(`window.__E2E_RELOAD_PENDING__ = true`);
  await mainWindow.evaluate(
    `import("/src/lib/tauri.ts").then(({ reloadViews }) => { void reloadViews(); })`,
  );
  // 150s: a loaded CI runner (Windows especially) can take well over 20s to
  // tear down and re-create the webview, and macOS content-filter network
  // extensions (Proxyman Guard, Bitdefender) can stall the webview's vite
  // connections in SYN_SENT for 45-90s per flow before TCP retries land.
  // The playwright per-test budget is 240s, so this still fails fast enough.
  const deadline = Date.now() + 150_000;
  // The eval-scheduled location.reload() is occasionally lost (the webview
  // drops the setTimeout when it is mid-navigation or its content process was
  // swapped), which used to burn the whole deadline; re-nudge instead.
  let nextNudge = Date.now() + 20_000;
  let lastState = "main window never re-acquired";
  while (Date.now() < deadline) {
    try {
      const reloadedWindow = await page.waitForWindow(
        (window) => window.label === "main",
        { timeout: Math.min(1_000, deadline - Date.now()) },
      );
      const state = await reloadedWindow.evaluate(
        `JSON.stringify({ readyState: document.readyState, pwActive: !!window.__PW_ACTIVE__, reloadPending: window.__E2E_RELOAD_PENDING__ === true, rootMounted: (document.querySelector("#root")?.childElementCount ?? 0) > 0 })`,
      );
      lastState = String(state);
      const parsed = JSON.parse(lastState) as {
        readyState: string;
        pwActive: boolean;
        reloadPending: boolean;
        rootMounted: boolean;
      };
      // "interactive" counts as ready: a dev-mode subresource can keep
      // readyState from ever reaching "complete" on an otherwise fully
      // booted page, and a cleared pending flag already proves the reload
      // navigated to a fresh document.
      if (
        parsed.readyState !== "loading" &&
        parsed.pwActive &&
        !parsed.reloadPending &&
        parsed.rootMounted
      ) {
        return;
      }
      if (parsed.reloadPending && Date.now() >= nextNudge) {
        nextNudge = Date.now() + 20_000;
        await reloadedWindow.evaluate(
          `import("/src/lib/tauri.ts").then(({ reloadViews }) => { void reloadViews(); })`,
        );
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `main window did not finish reloading within 60 seconds (last state: ${lastState})`,
  );
}

async function ensureNativePageReady(page: TauriPage) {
  try {
    await page.waitForFunction(
      productionE2e
        ? 'document.readyState !== "loading" && (document.querySelector("#root")?.childElementCount ?? 0) > 0'
        : 'document.readyState !== "loading" && !!window.__PW_ACTIVE__ && (document.querySelector("#root")?.childElementCount ?? 0) > 0',
      10_000,
    );
  } catch {
    await reloadNativePage(page);
  }
}

async function focusNativeWindow(page: TauriPage) {
  if (productionE2e) {
    await page.evaluate("(() => { window.focus(); return true; })()");
    return;
  }
  await page.evaluate(`
    import("/src/lib/tauri.ts").then(({ focusCurrentWindow }) =>
      focusCurrentWindow().then(() => true)
    )
  `);
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
      if (firstPage && !productionE2e) {
        // Enable the experimental Visual editor and LaTeX tools (default off)
        // so the gated e2e specs run. Wrapped as an IIFE expression, the form
        // this bridge evaluates reliably (bare multi-statement strings time out).
        await page.evaluate(`(function(){
          localStorage.removeItem("oleafly.shortcuts");
          localStorage.setItem("oleafly.visualEditor", "1");
          localStorage.setItem("oleafly.latexTools", "1");
          return true;
        })()`);
        await reloadNativePage(page);
      }
      if (dismissTours) {
        if (productionE2e) {
          throw new Error("packaged E2E tests must use tourTest to avoid a production reload");
        }
        await page.evaluate(
          `localStorage.setItem("oleafly.tours", ${JSON.stringify(DISMISSED_TOUR_STATE)})`,
        );
        await reloadNativePage(page);
      }
      await focusNativeWindow(page);
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

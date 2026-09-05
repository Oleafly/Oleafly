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
  const mainWindow = await page.waitForWindow((window) => window.label === "main", {
    timeout: 20_000,
  });
  await mainWindow.evaluate(`window.__E2E_RELOAD_PENDING__ = true`);
  // Packaged builds have no dev server to import the reload helper from, but
  // a plain location.reload() re-navigates the custom-protocol document and
  // the plugin bridge re-injects on the fresh page.
  const scheduleReload = productionE2e
    ? `setTimeout(() => location.reload(), 0)`
    : `import("/src/lib/tauri.ts").then(({ reloadViews }) => { void reloadViews(); })`;
  await mainWindow.evaluate(scheduleReload);
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
          productionE2e
            ? `setTimeout(() => location.reload(), 0)`
            : `import("/src/lib/tauri.ts").then(({ reloadViews }) => { void reloadViews(); })`,
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
  // Real OS focus in both modes: editor features gate on the CodeMirror
  // view's hasFocus, and a JS-level window.focus() cannot focus an unfocused
  // native window. Packaged runs resolve this import through the registry.
  await page.evaluate(`
    import("/src/lib/tauri.ts").then(({ focusCurrentWindow }) =>
      focusCurrentWindow().then(() => true)
    )
  `);
}

// Specs drive the app through evaluated snippets that import modules by
// dev-server URL. Packaged builds resolve those through the registry the app
// installs at boot (src/lib/e2e-import-registry.ts), so in production mode
// every evaluated string is rewritten to go through it. Dev mode passes
// strings through untouched.
function rewritePackagedEval(script: string): string {
  // Whitespace-tolerant: specs also write `import(\n  "/src/..."\n)`.
  return script.replace(
    /import\(\s*("\/(?:src|packages)\/)/g,
    'window.__oleaflyE2EImport($1',
  );
}

function adaptForPackagedRuntime<T>(target: T): T {
  if (!productionE2e) return target;
  const patchable = target as T & {
    evaluate?: (script: string, ...rest: unknown[]) => unknown;
    waitForFunction?: (script: string, ...rest: unknown[]) => unknown;
    waitForWindow?: (...args: unknown[]) => Promise<unknown>;
  };
  if (typeof patchable.evaluate === "function") {
    const original = patchable.evaluate.bind(patchable);
    patchable.evaluate = (script: string, ...rest: unknown[]) =>
      original(typeof script === "string" ? rewritePackagedEval(script) : script, ...rest);
  }
  if (typeof patchable.waitForFunction === "function") {
    const original = patchable.waitForFunction.bind(patchable);
    patchable.waitForFunction = (script: string, ...rest: unknown[]) =>
      original(typeof script === "string" ? rewritePackagedEval(script) : script, ...rest);
  }
  if (typeof patchable.waitForWindow === "function") {
    const original = patchable.waitForWindow.bind(patchable);
    patchable.waitForWindow = async (...args: unknown[]) =>
      adaptForPackagedRuntime(await original(...args));
  }
  return target;
}

const BRIDGE_SILENCE_LIMIT_MS = 90_000;
let bridgeStoppedAnswering: string | null = null;

function failFastOnBridgeSilence(client: PluginClient): PluginClient {
  const send = client.send.bind(client);
  client.send = async (command: Record<string, unknown>) => {
    if (bridgeStoppedAnswering) throw new Error(bridgeStoppedAnswering);
    const label = typeof command.type === "string" ? command.type : "command";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let silent = false;
    try {
      return await Promise.race([
        send(command),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            silent = true;
            reject(
              new Error(
                `the app never answered '${label}' within ${BRIDGE_SILENCE_LIMIT_MS}ms; its main thread or async runtime is blocked`,
              ),
            );
          }, BRIDGE_SILENCE_LIMIT_MS);
        }),
      ]);
    } catch (error) {
      if (silent) bridgeStoppedAnswering = String((error as Error)?.message ?? error);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return client;
}

function createNativeTest(dismissTours: boolean) {
  const port = Number(process.env.TAURI_PLAYWRIGHT_TCP_PORT ?? 6274);
  const socket = process.env.TAURI_PLAYWRIGHT_SOCKET ?? "/tmp/tauri-playwright.sock";
  const test = base.extend<{ tauriPage: TauriPage }>({
    tauriPage: async ({}, use) => {
      if (bridgeStoppedAnswering) throw new Error(bridgeStoppedAnswering);
      const client = failFastOnBridgeSilence(
        process.platform === "win32"
          ? new PluginClient(undefined, port)
          : new PluginClient(socket),
      );
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
      const page = adaptForPackagedRuntime(new TauriPage(client));
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
          localStorage.setItem("oleafly.webBrowser", "1");
          localStorage.setItem("oleafly.openInTree", "0");
          localStorage.setItem("oleafly:compile:mode", "normal");
          return true;
        })()`);
        await reloadNativePage(page);
      }
      if (dismissTours) {
        if (productionE2e) {
          // Packaged runs seed localStorage before boot via
          // OLEAFLY_E2E_BOOT_LOCALSTORAGE (see e2e.sh and lib.rs), so no
          // reload is needed — verify the seed actually landed instead.
          const seeded = await page.evaluate(
            `(function(){ const raw = localStorage.getItem("oleafly.tours"); if (!raw) return false; try { return JSON.parse(raw).state?.enabled === false; } catch { return false; } })()`,
          );
          if (!seeded) {
            throw new Error(
              "packaged E2E run is missing the boot seed: launch through scripts/e2e.sh so OLEAFLY_E2E_BOOT_LOCALSTORAGE disables tours before boot",
            );
          }
        } else {
          await page.evaluate(
            `localStorage.setItem("oleafly.tours", ${JSON.stringify(DISMISSED_TOUR_STATE)})`,
          );
          await reloadNativePage(page);
        }
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

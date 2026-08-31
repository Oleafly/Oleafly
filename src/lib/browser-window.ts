import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

// The in-app browser opens as its own OS window rather than a child webview
// composited over the app. A separate window loads any site (unlike an
// iframe, which most sites refuse) and has none of the z-order/occlusion or
// rounded-corner problems of an embedded native webview. A fresh unique label
// per navigation, with the previous window closed, sidesteps the
// "webview label already exists" collision that the embedded pane hit.

const BROWSER_WINDOW_PREFIX = "oleafly-browser-window";

// Real e2e runs (not ordinary dev) skip spawning an OS window so specs can
// verify the launcher's address/search logic without opening live pages.
const SKIP_WINDOW_FOR_E2E = import.meta.env.VITE_E2E_HOOKS === "1";

let currentWindow: WebviewWindow | null = null;
let sequence = 0;

/** True in a browser/dev context where Tauri windows are unavailable. */
function isSystemBrowserContext(): boolean {
  return !isTauri();
}

/**
 * Open (or replace) the browser window at `url`. In a non-Tauri context this
 * falls back to the system browser. Returns false when nothing could be
 * opened (e.g. a popup blocker).
 */
export async function openBrowserWindow(url: string, title?: string): Promise<boolean> {
  if (isSystemBrowserContext()) {
    return Boolean(window.open(url, "_blank", "noopener,noreferrer"));
  }
  if (SKIP_WINDOW_FOR_E2E) return true;
  const previous = currentWindow;
  currentWindow = null;
  sequence += 1;
  const opened = new WebviewWindow(`${BROWSER_WINDOW_PREFIX}-${sequence}`, {
    url,
    title: title ? `Browser — ${title}` : "Oleafly Browser",
    width: 1024,
    height: 768,
    resizable: true,
    center: true,
    focus: true,
  });
  currentWindow = opened;
  let created = true;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      created = ok;
      resolve();
    };
    void opened.once("tauri://created", () => done(true));
    void opened.once("tauri://error", () => {
      if (currentWindow === opened) currentWindow = null;
      done(false);
    });
    // The events are the source of truth, but never hang the caller on them.
    setTimeout(() => done(created), 2_000);
  });
  // Close the prior window only once the replacement is up, so a failed
  // create leaves the existing window in place.
  if (created && previous) void previous.close().catch(() => {});
  return created;
}

/** Focus the current browser window if one is open. */
export async function focusBrowserWindow(): Promise<boolean> {
  if (isSystemBrowserContext() || !currentWindow) return false;
  try {
    await currentWindow.setFocus();
    return true;
  } catch {
    currentWindow = null;
    return false;
  }
}

/** Close the browser window if one is open (dock closed, project closed). */
export async function closeBrowserWindow(): Promise<void> {
  const open = currentWindow;
  currentWindow = null;
  if (open) await open.close().catch(() => {});
}

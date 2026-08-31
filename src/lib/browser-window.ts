import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { registerCuaSurface } from "@/lib/cua-sandbox";
import { useSettingsStore } from "@/store/settings";

const DEFAULT_BROWSER_HOME = "https://www.google.com";

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
let lastUrl = "";

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
  lastUrl = url;
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
  // Keep the toggle state honest when the user closes the OS window directly.
  void opened.once("tauri://destroyed", () => {
    if (currentWindow === opened) currentWindow = null;
    useSettingsStore.getState().setBrowserOpen(false);
  });
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

/** Close the browser window if one is open (toggled off, project closed). */
export async function closeBrowserWindow(): Promise<void> {
  const open = currentWindow;
  currentWindow = null;
  if (open) await open.close().catch(() => {});
}

/**
 * Open (or navigate) the browser window from a user action or the AI. Respects
 * the experimental flag, so the toolbar button and the keyboard shortcut are
 * inert when the browser is off. With no URL it opens the configured home page.
 */
export function launchBrowser(url?: string): void {
  const settings = useSettingsStore.getState();
  if (!settings.webBrowser) return;
  settings.setBrowserOpen(true);
  void openBrowserWindow(url ?? (settings.browserHomePage || DEFAULT_BROWSER_HOME));
}

/** Toggle the browser window: open it if closed, close it if open. */
export function toggleBrowser(): void {
  const settings = useSettingsStore.getState();
  if (!settings.webBrowser) return;
  if (settings.browserOpen) {
    settings.setBrowserOpen(false);
    void closeBrowserWindow();
  } else {
    launchBrowser();
  }
}

/**
 * Register the CUA surface so the AI's computer_use tool can drive the browser
 * window even though there is no in-app browser view. Remote pages are
 * cross-origin, so the surface stays navigate/observe-URL only.
 */
export function registerBrowserCuaSurface(): () => void {
  registerCuaSurface({
    get document(): Document {
      throw new Error("The browser window is a separate OS window and is not scriptable.");
    },
    url: () => lastUrl,
    navigate: (url: string) => {
      void openBrowserWindow(url);
    },
  });
  return () => registerCuaSurface(null);
}

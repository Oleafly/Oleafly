import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  BROWSER_EVENTS,
  browserNavigate,
  browserWindowClose,
  browserWindowFocus,
  browserWindowOpen,
  type BrowserHomePagePayload,
  type BrowserLabelPayload,
  type BrowserPageLoadPayload,
} from "@/lib/browser-commands";
import { registerCuaSurface } from "@/lib/cua-sandbox";
import { useSettingsStore } from "@/store/settings";

const DEFAULT_BROWSER_HOME = "https://www.google.com";

const SKIP_WINDOW_FOR_E2E = import.meta.env.VITE_E2E_HOOKS === "1";

let currentLabel: string | null = null;
let lastUrl = "";
let listenersInstalled: Promise<UnlistenFn[]> | null = null;

function isSystemBrowserContext(): boolean {
  return !isTauri();
}

function installListeners(): Promise<UnlistenFn[]> {
  if (listenersInstalled) return listenersInstalled;
  listenersInstalled = Promise.all([
    listen<BrowserLabelPayload>(BROWSER_EVENTS.windowClosed, (event) => {
      if (event.payload.label !== currentLabel) return;
      currentLabel = null;
      useSettingsStore.getState().setBrowserOpen(false);
    }),
    listen<BrowserPageLoadPayload>(BROWSER_EVENTS.pageLoad, (event) => {
      if (event.payload.active) lastUrl = event.payload.url;
    }),
    listen<{ label: string; url?: string }>(BROWSER_EVENTS.tabActivated, (event) => {
      if (typeof event.payload.url === "string") lastUrl = event.payload.url;
    }),
    listen<BrowserHomePagePayload>(BROWSER_EVENTS.homePage, (event) => {
      useSettingsStore.getState().setBrowserHomePage(event.payload.url);
    }),
  ]).catch(() => {
    listenersInstalled = null;
    return [];
  });
  return listenersInstalled;
}

export async function openBrowserWindow(url: string): Promise<boolean> {
  lastUrl = url;
  if (isSystemBrowserContext()) {
    return Boolean(window.open(url, "_blank", "noopener,noreferrer"));
  }
  if (SKIP_WINDOW_FOR_E2E) return true;
  await installListeners();
  try {
    currentLabel = await browserWindowOpen(url);
    return true;
  } catch {
    return false;
  }
}

export async function focusBrowserWindow(): Promise<boolean> {
  if (isSystemBrowserContext() || !currentLabel) return false;
  try {
    await browserWindowFocus(currentLabel);
    return true;
  } catch {
    currentLabel = null;
    return false;
  }
}

export async function closeBrowserWindow(): Promise<void> {
  const open = currentLabel;
  currentLabel = null;
  if (open) await browserWindowClose(open).catch(() => {});
}

export function launchBrowser(url?: string): void {
  const settings = useSettingsStore.getState();
  if (!settings.webBrowser) return;
  settings.setBrowserOpen(true);
  if (url === undefined && currentLabel) {
    void focusBrowserWindow();
    return;
  }
  void openBrowserWindow(url ?? (settings.browserHomePage || DEFAULT_BROWSER_HOME));
}

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

export function registerBrowserCuaSurface(): () => void {
  registerCuaSurface({
    get document(): Document {
      throw new Error("The browser window is a separate OS window and is not scriptable.");
    },
    url: () => lastUrl,
    navigate: async (url: string) => {
      if (currentLabel && !isSystemBrowserContext()) {
        lastUrl = url;
        try {
          await browserNavigate(null, url);
          return;
        } catch {
          currentLabel = null;
        }
      }
      await openBrowserWindow(url);
    },
  });
  return () => registerCuaSurface(null);
}

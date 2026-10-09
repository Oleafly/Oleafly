import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { APP_ZOOM_LEVELS, appZoomLevel, useSettingsStore } from "@/store/settings";
import { logError } from "@/lib/log";

export const APP_ZOOM_STORAGE_KEY = "oleafly.appZoom";
const DEFAULT_ZOOM = 100;

export function storedAppZoom(): number {
  try {
    return appZoomLevel(localStorage.getItem(APP_ZOOM_STORAGE_KEY) ?? DEFAULT_ZOOM);
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function steppedAppZoom(current: number, direction: 1 | -1): number {
  const index = APP_ZOOM_LEVELS.indexOf(appZoomLevel(current));
  const next = Math.min(APP_ZOOM_LEVELS.length - 1, Math.max(0, index + direction));
  return APP_ZOOM_LEVELS[next];
}

let webviewModule: Promise<typeof import("@tauri-apps/api/webview")> | null = null;

export async function applyAppZoom(level: number): Promise<void> {
  if (!isTauri()) return;
  webviewModule ??= import("@tauri-apps/api/webview");
  const { getCurrentWebview } = await webviewModule;
  await getCurrentWebview().setZoom(appZoomLevel(level) / 100);
}

function applyQuietly(level: number): void {
  applyAppZoom(level).catch((error: unknown) => void logError("apply the app zoom", error));
}

export function zoomApp(direction: 1 | -1 | 0): void {
  const settings = useSettingsStore.getState();
  settings.setAppZoom(direction === 0 ? DEFAULT_ZOOM : steppedAppZoom(settings.appZoom, direction));
}

function zoomDirection(event: KeyboardEvent): 1 | -1 | 0 | null {
  const { bindings } = useShortcutStore.getState();
  if (matchesShortcut(event, bindings.zoomIn)) return 1;
  if (matchesShortcut(event, bindings.zoomOut)) return -1;
  if (matchesShortcut(event, bindings.resetZoom)) return 0;
  const plus = event.key === "+" && (event.metaKey || event.ctrlKey) && !event.altKey;
  return plus && bindings.zoomIn.key === "=" ? 1 : null;
}

export function useAppZoom(): void {
  const level = useSettingsStore((state) => state.appZoom);

  useEffect(() => {
    applyQuietly(level);
  }, [level]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== APP_ZOOM_STORAGE_KEY) return;
      useSettingsStore.setState({ appZoom: storedAppZoom() });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const direction = zoomDirection(event);
      if (direction === null) return;
      event.preventDefault();
      zoomApp(direction);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

export function AppZoom(): null {
  useAppZoom();
  return null;
}

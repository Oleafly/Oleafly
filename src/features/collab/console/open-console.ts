import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { geometryOnScreen, readWindowGeometry } from "@/lib/preview-geometry";
import type { CollabServer } from "@/lib/tauri";

export const CONSOLE_VIEW = "admin";
export const CONSOLE_LABEL_PREFIX = "admin-console-";

const DEFAULT_SIZE = { width: 1040, height: 720 } as const;
const MIN_SIZE = { minWidth: 560, minHeight: 420 } as const;

export function consoleWindowLabel(serverId: string): string {
  return `${CONSOLE_LABEL_PREFIX}${serverId.replace(/[^A-Za-z0-9-]/g, "-")}`;
}

export function consoleGeometryKey(serverId: string): string {
  return `oleafly.console.geometry.${serverId}`;
}

export function readConsoleServerId(search: string): string | null {
  const id = new URLSearchParams(search).get("server");
  return id ? id : null;
}

export async function openAdminConsole(server: Pick<CollabServer, "server_id" | "name">): Promise<void> {
  if (!isTauri()) return;
  const label = consoleWindowLabel(server.server_id);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const geometry = readWindowGeometry(consoleGeometryKey(server.server_id));
  const monitors = geometry ? await availableMonitors().catch(() => []) : [];
  const onScreen = geometry !== null && geometryOnScreen(geometry, monitors);
  const query = new URLSearchParams({ view: CONSOLE_VIEW, server: server.server_id });
  const window = new WebviewWindow(label, {
    url: `index.html?${query.toString()}`,
    title: i18n.t(($) => $.collab.console.windowTitle),
    width: geometry?.width ?? DEFAULT_SIZE.width,
    height: geometry?.height ?? DEFAULT_SIZE.height,
    ...MIN_SIZE,
    ...(onScreen && geometry ? { x: geometry.x, y: geometry.y } : {}),
    resizable: true,
    center: !onScreen,
    focus: true,
  });
  void window.once("tauri://error", (event) => {
    void logError("admin-console-window", event.payload);
  });
}

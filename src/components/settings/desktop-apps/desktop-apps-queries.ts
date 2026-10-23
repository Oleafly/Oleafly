// 0.4.8 I: the Desktop apps settings read Rust's status and the installed
// apps through react-query, so reopening Settings doesn't rescan.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  cuaDriverInstalledApps,
  cuaDriverStatus,
  cuaDriverToolSpec,
  type DesktopAppsSettings,
  type DesktopAppsStatus,
  type InstalledApp,
} from "@/lib/desktop-apps";

export const DESKTOP_APPS_STATUS_KEY = ["desktop-apps", "status"] as const;
export const DESKTOP_APPS_INSTALLED_KEY = ["desktop-apps", "installed"] as const;
export const DESKTOP_APPS_READY_KEY = ["desktop-apps", "ready"] as const;

/** The picker never shows more rows than this. */
export const MAX_PICKER_ROWS = 200;

export function useDesktopAppsStatus() {
  return useQuery({
    queryKey: DESKTOP_APPS_STATUS_KEY,
    queryFn: cuaDriverStatus,
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
}

/**
 * Whether agents can use desktop apps now (on, with something allowed), from
 * the tool spec: unlike the full status it runs no program.
 */
export function useDesktopAppsToolReady(enabled: boolean) {
  return useQuery({
    queryKey: DESKTOP_APPS_READY_KEY,
    queryFn: async () => (await cuaDriverToolSpec()) !== null,
    enabled,
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
}

export function useInstalledApps(enabled: boolean) {
  return useQuery({
    queryKey: DESKTOP_APPS_INSTALLED_KEY,
    queryFn: cuaDriverInstalledApps,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { silent: true },
  });
}

/** Puts settings Rust saved into the cached status. */
export function storeSavedSettings(client: QueryClient, settings: DesktopAppsSettings): void {
  client.setQueryData<DesktopAppsStatus>(DESKTOP_APPS_STATUS_KEY, (status) =>
    status ? { ...status, settings } : status,
  );
  void client.invalidateQueries({ queryKey: DESKTOP_APPS_READY_KEY });
}

/** Every app whose name, bundle id or path contains `query`. */
export function matchApps(apps: readonly InstalledApp[], query: string): InstalledApp[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle
    ? apps.filter((app) =>
        [app.name, app.bundleId, app.executable].some((value) =>
          value?.toLocaleLowerCase().includes(needle),
        ),
      )
    : [...apps];
}

/** Apps whose name, bundle id or path contains `query`, at most 200. */
export function filterApps(apps: readonly InstalledApp[], query: string): InstalledApp[] {
  return matchApps(apps, query).slice(0, MAX_PICKER_ROWS);
}

/** One picker row: several entries can share a program (LibreOffice's Writer and Calc). */
export function appRowKey(app: InstalledApp): string {
  return `${app.name}\u0000${app.bundleId ?? app.executable ?? ""}`;
}

/** Whether `app` is already allowed (same bundle id or program path). */
export function sameApp(left: { bundleId?: string; executable?: string }, right: { bundleId?: string; executable?: string }): boolean {
  if (left.bundleId || right.bundleId) {
    return Boolean(left.bundleId && right.bundleId && left.bundleId.toLowerCase() === right.bundleId.toLowerCase());
  }
  return Boolean(
    left.executable && right.executable && left.executable.toLowerCase() === right.executable.toLowerCase(),
  );
}

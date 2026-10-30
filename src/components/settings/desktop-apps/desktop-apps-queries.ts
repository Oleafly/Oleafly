// 0.4.8 I: the Desktop apps settings read Rust's status and the installed
// apps through react-query, so reopening Settings doesn't rescan.
import { useMemo } from "react";
import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import {
  cuaDriverAppIcons,
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
export const DESKTOP_APPS_ICONS_KEY = ["desktop-apps", "icons"] as const;

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

/** Rows per icon request: small batches load side by side, top rows first. */
const ICON_BATCH = 20;

/**
 * Icons for the picker rows in view, by row key. Rust reads each one once, so
 * a search that brings a row back costs next to nothing.
 */
export function useAppIcons(keys: readonly string[], enabled: boolean): Record<string, string> {
  const batches = useMemo(() => {
    const parts: string[][] = [];
    for (let start = 0; start < keys.length; start += ICON_BATCH) parts.push(keys.slice(start, start + ICON_BATCH));
    return parts;
  }, [keys]);
  return useQueries({
    queries: batches.map((batch) => ({
      queryKey: [...DESKTOP_APPS_ICONS_KEY, batch],
      queryFn: () => cuaDriverAppIcons(batch),
      enabled,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
      meta: { silent: true },
    })),
    combine: (results) => Object.assign({}, ...results.map((result) => result.data ?? {})) as Record<string, string>,
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

/** Whether two texts match ignoring case; an empty or missing text matches nothing. */
function sameText(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left) && left?.toLowerCase() === right?.toLowerCase();
}

/** Whether `app` is already allowed (same bundle id or program path). */
export function sameApp(left: { bundleId?: string; executable?: string }, right: { bundleId?: string; executable?: string }): boolean {
  if (left.bundleId || right.bundleId) return sameText(left.bundleId, right.bundleId);
  return sameText(left.executable, right.executable);
}

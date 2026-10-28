import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { appIconSet } from "@/lib/tauri";
import { logError } from "@/lib/log";
import { useSettingsStore, type AppIconId } from "@/store/settings";

export async function applyAppIcon(icon: AppIconId): Promise<void> {
  if (!isTauri()) return;
  await appIconSet(icon);
}

export function useAppIcon(): void {
  const icon = useSettingsStore((state) => state.appIcon);

  useEffect(() => {
    applyAppIcon(icon).catch((error: unknown) => void logError("apply the app icon", error));
  }, [icon]);
}

export function AppIcon(): null {
  useAppIcon();
  return null;
}

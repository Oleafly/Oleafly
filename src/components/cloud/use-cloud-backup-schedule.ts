import { useEffect } from "react";
import { useCloudStore } from "@/store/cloud";
import { useCloudBackupStore } from "@/store/cloud-backups";
import { useSettingsStore } from "@/store/settings";

export const FIRST_BACKUP_CHECK_MS = 3 * 60_000;
export const BACKUP_CHECK_EVERY_MS = 15 * 60_000;

export function useCloudBackupsOn(): boolean {
  const connected = useCloudStore((s) => s.status === "connected");
  const notesOn = useSettingsStore((s) => s.notes);
  return connected && notesOn;
}

export function useCloudBackupSchedule(): void {
  const active = useCloudBackupsOn();
  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const check = () => {
      void useCloudBackupStore.getState().runNow(true);
      timer = window.setTimeout(check, BACKUP_CHECK_EVERY_MS);
    };
    timer = window.setTimeout(check, FIRST_BACKUP_CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
}

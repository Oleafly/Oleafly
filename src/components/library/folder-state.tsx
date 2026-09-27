import { useTranslation } from "react-i18next";
import { FolderLock, FolderSync, FolderX, HardDrive, type LucideIcon } from "lucide-react";
import { folderUnavailable, splitFolderPath } from "@/lib/library-projects";
import type { ProjectAvailability } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type UnavailableFolder = Exclude<ProjectAvailability, "ok" | "unknown">;

export const FOLDER_STATE_ICON: Record<UnavailableFolder, LucideIcon> = {
  missing: FolderX,
  offline: HardDrive,
  replaced: FolderSync,
  permission_denied: FolderLock,
};

export function asUnavailable(availability: ProjectAvailability): UnavailableFolder | null {
  return folderUnavailable(availability) ? (availability as UnavailableFolder) : null;
}

export function useFolderStateLabel(): (state: UnavailableFolder) => string {
  const { t } = useTranslation(["library"]);
  return (state) => {
    switch (state) {
      case "missing":
        return t(($) => $.library.folder.state.missing);
      case "offline":
        return t(($) => $.library.folder.state.offline);
      case "replaced":
        return t(($) => $.library.folder.state.replaced);
      case "permission_denied":
        return t(($) => $.library.folder.state.permissionDenied);
    }
  };
}

export function FolderStateLine({
  state,
  className,
}: Readonly<{ state: UnavailableFolder; className?: string }>) {
  const label = useFolderStateLabel();
  const Icon = FOLDER_STATE_ICON[state];
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label(state)}</span>
    </span>
  );
}

export function FolderPath({
  path,
  className,
}: Readonly<{ path: string; className?: string }>) {
  const { head, tail } = splitFolderPath(path);
  return (
    <span className={cn("flex min-w-0", className)} title={path}>
      {head ? <span className="min-w-0 truncate">{head}</span> : null}
      <span className="min-w-0 max-w-full shrink-0 truncate">{tail}</span>
    </span>
  );
}

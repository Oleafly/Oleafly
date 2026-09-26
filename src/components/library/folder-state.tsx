import { useTranslation } from "react-i18next";
import {
  FileText,
  FolderLock,
  FolderOpen,
  FolderSync,
  FolderX,
  HardDrive,
  type LucideIcon,
} from "lucide-react";
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

export function FolderCoverBadge() {
  const { t } = useTranslation(["library"]);
  return (
    <span className="pointer-events-none absolute left-4 top-2 z-[14] inline-flex items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-white backdrop-blur-sm">
      <FolderOpen aria-hidden className="size-3" />
      {t(($) => $.library.folder.badge)}
    </span>
  );
}

export function FolderInlineBadge({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation(["library"]);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground",
        className,
      )}
    >
      <FolderOpen aria-hidden className="size-3" />
      {t(($) => $.library.folder.badge)}
    </span>
  );
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

export function FolderBookDetails({
  path,
  mainDoc,
  availability,
}: Readonly<{ path: string; mainDoc: string; availability: ProjectAvailability }>) {
  const { t } = useTranslation(["library"]);
  const state = asUnavailable(availability);
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <FolderOpen aria-hidden className="size-3 shrink-0" />
        <FolderPath path={path} />
      </span>
      {state ? (
        <FolderStateLine state={state} />
      ) : (
        <span className="flex min-w-0 items-center gap-1.5" title={mainDoc || undefined}>
          <FileText aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{mainDoc || t(($) => $.library.folder.noMain)}</span>
        </span>
      )}
    </div>
  );
}

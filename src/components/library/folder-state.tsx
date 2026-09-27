import { useTranslation } from "react-i18next";
import { folderUnavailable } from "@/lib/library-projects";
import type { ProjectAvailability } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type UnavailableFolder = Exclude<ProjectAvailability, "ok" | "unknown">;

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
  return (
    <span
      className={cn(
        "flex min-w-0 items-center font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <span className="truncate">{label(state)}</span>
    </span>
  );
}

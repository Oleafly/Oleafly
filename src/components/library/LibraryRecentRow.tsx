import { useId } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { FolderPath, FolderStateLine, asUnavailable } from "@/components/library/folder-state";
import { folderDisplayPath, isFolderProject } from "@/lib/library-projects";
import type { ProjectAvailability, ProjectInfo } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function LibraryRecentRow({
  projects,
  colorOf,
  availabilityOf,
  onOpen,
}: Readonly<{
  projects: readonly ProjectInfo[];
  colorOf: (project: ProjectInfo) => string;
  availabilityOf: (project: ProjectInfo) => ProjectAvailability;
  onOpen: (project: ProjectInfo) => void;
}>) {
  const { t } = useTranslation(["library"]);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid="library-recent" className="mb-10">
      <h2
        id={headingId}
        className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {t(($) => $.library.home.recent.title)}
      </h2>
      <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {projects.map((project) => {
          const folder = isFolderProject(project);
          const state = asUnavailable(availabilityOf(project));
          const path = folderDisplayPath(project);
          return (
            <li key={project.id} className="w-60 shrink-0">
              <button
                type="button"
                onClick={() => onOpen(project)}
                className="flex h-16 w-full items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-3 text-left backdrop-blur-md transition-colors hover:bg-accent/50 focus-visible:border-primary/60 focus-visible:bg-accent/60"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative flex h-11 w-8 shrink-0 items-end justify-center overflow-hidden rounded-[4px] border border-black/10 pb-1 shadow-sm",
                    state && "opacity-60 grayscale",
                  )}
                  style={{ backgroundColor: colorOf(project) }}
                >
                  {folder ? (
                    <span className="rounded bg-black/35 p-0.5 text-white">
                      <FolderOpen className="size-3" />
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {project.name}
                  </span>
                  {state ? (
                    <FolderStateLine state={state} className="text-xs" />
                  ) : (
                    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                      {folder ? (
                        <span className="sr-only">{t(($) => $.library.folder.badge)}</span>
                      ) : null}
                      {path === null ? (
                        <span className="truncate">{t(($) => $.library.home.scope.library)}</span>
                      ) : (
                        <FolderPath path={path} />
                      )}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

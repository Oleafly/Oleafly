import { projectLocation } from "@/lib/project-location";
import type { ProjectAvailability, ProjectInfo } from "@/lib/tauri";

export type LibraryScope = "all" | "library" | "folders";

export const LIBRARY_SCOPES: readonly LibraryScope[] = ["all", "library", "folders"];

export const RECENT_LIMIT = 6;

type Located = Pick<ProjectInfo, "location">;

export function isFolderProject(project: Located): boolean {
  return projectLocation(project).kind === "linked";
}

export function folderDisplayPath(project: Located): string | null {
  const location = projectLocation(project);
  return location.kind === "linked" ? location.display_path : null;
}

export function splitFolderPath(path: string): { head: string; tail: string } {
  const separatorBefore = (end: number) =>
    end < 0 ? -1 : Math.max(path.lastIndexOf("/", end), path.lastIndexOf("\\", end));
  const last = separatorBefore(path.length - 1);
  const previous = last > 0 ? separatorBefore(last - 1) : -1;
  if (previous <= 0) return { head: "", tail: path };
  return { head: path.slice(0, previous), tail: path.slice(previous) };
}

export function projectInScope(project: Located, scope: LibraryScope): boolean {
  if (scope === "all") return true;
  return isFolderProject(project) === (scope === "folders");
}

export function scopeCounts(projects: readonly Located[]): Record<LibraryScope, number> {
  const folders = projects.filter(isFolderProject).length;
  return { all: projects.length, library: projects.length - folders, folders };
}

export function recentProjects(
  projects: readonly ProjectInfo[],
  limit: number = RECENT_LIMIT,
): ProjectInfo[] {
  return projects
    .filter((project) => !project.recovery_pending && (project.last_opened_at ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0) || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function folderAvailability(
  project: Pick<ProjectInfo, "id" | "location">,
  checked: Readonly<Record<string, ProjectAvailability>>,
): ProjectAvailability {
  const location = projectLocation(project);
  if (location.kind !== "linked") return "ok";
  return checked[project.id] ?? location.availability;
}

export function folderUnavailable(availability: ProjectAvailability): boolean {
  return availability !== "ok" && availability !== "unknown";
}

export function projectUpdatedAt(
  project: Pick<ProjectInfo, "id" | "location" | "updated_at">,
  modified: Readonly<Record<string, number>>,
): number {
  if (!isFolderProject(project)) return project.updated_at;
  return Math.max(project.updated_at, modified[project.id] ?? 0);
}

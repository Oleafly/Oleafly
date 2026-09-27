import { projectLocation } from "@/lib/project-location";
import type { ProjectAvailability, ProjectInfo } from "@/lib/tauri";

export type LibraryScope = "all" | "library" | "external";

type Located = Pick<ProjectInfo, "location">;

export function isFolderProject(project: Located): boolean {
  return projectLocation(project).kind === "linked";
}

export function folderDisplayPath(project: Located): string | null {
  const location = projectLocation(project);
  return location.kind === "linked" ? location.display_path : null;
}

export function projectInScope(project: Located, scope: LibraryScope): boolean {
  if (scope === "all") return true;
  return isFolderProject(project) === (scope === "external");
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

type Active = Pick<ProjectInfo, "id" | "location" | "updated_at" | "last_opened_at">;

export function projectActivityAt(
  project: Active,
  modified: Readonly<Record<string, number>>,
): number {
  return Math.max(project.last_opened_at ?? 0, projectUpdatedAt(project, modified));
}

export function sortByActivity<T extends Active>(
  projects: readonly T[],
  modified: Readonly<Record<string, number>>,
): T[] {
  return projects
    .map((project) => ({ project, at: projectActivityAt(project, modified) }))
    .sort((a, b) => b.at - a.at || a.project.id.localeCompare(b.project.id))
    .map(({ project }) => project);
}

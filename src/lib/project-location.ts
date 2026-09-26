import type { ProjectInfo, ProjectLocationInfo } from "@/lib/tauri";

const LIBRARY: ProjectLocationInfo = { kind: "library" };

export function projectLocation(project: Pick<ProjectInfo, "location">): ProjectLocationInfo {
  return project.location ?? LIBRARY;
}

export function isLibraryProject(project: Pick<ProjectInfo, "location">): boolean {
  return projectLocation(project).kind === "library";
}

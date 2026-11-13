import { useCallback, type CSSProperties } from "react";
import { useFilesStore } from "@/store/files";
import { useProjectColorOf } from "@/store/project-colors";

export type ProjectColorOf = (projectId: string | null | undefined) => string | null;

export function useProjectColor(): ProjectColorOf {
  const colorOf = useProjectColorOf();
  const projects = useFilesStore((state) => state.projects);
  return useCallback(
    (projectId) => (projectId ? colorOf(projects.find((project) => project.id === projectId) ?? { id: projectId }) : null),
    [colorOf, projects],
  );
}

export function projectStyle(color: string | null): CSSProperties | undefined {
  return color ? ({ "--note-project": color } as CSSProperties) : undefined;
}

import { useCallback, type CSSProperties } from "react";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useProjectColorsStore } from "@/store/project-colors";

export type ProjectColorOf = (projectId: string | null | undefined) => string | null;

export function projectColor(
  projectId: string | null | undefined,
  overrides: Readonly<Record<string, string>>,
  projects: readonly { id: string; color?: string }[],
): string | null {
  if (!projectId) return null;
  return overrides[projectId] ?? (projects.find((project) => project.id === projectId)?.color || DEFAULT_BOOK_COLOR);
}

export function useProjectColor(): ProjectColorOf {
  const overrides = useProjectColorsStore((state) => state.colors);
  const projects = useFilesStore((state) => state.projects);
  return useCallback((projectId) => projectColor(projectId, overrides, projects), [overrides, projects]);
}

export function projectStyle(color: string | null): CSSProperties | undefined {
  return color ? ({ "--note-project": color } as CSSProperties) : undefined;
}

export function ProjectDot({ color, className }: Readonly<{ color: string | null; className?: string }>) {
  return (
    <span
      aria-hidden
      data-project-color={color ?? "none"}
      style={projectStyle(color)}
      className={cn("note-project-dot size-2 shrink-0 rounded-full", !color && "note-project-dot-none", className)}
    />
  );
}

import { openProjectLocation } from "@/lib/open-location";
import type { SourceRange } from "@/lib/project-intelligence/types";

export interface ProjectNavigationTarget {
  path: string;
  range: Pick<SourceRange, "from" | "to">;
  source?: "outline" | "references" | "diagnostic" | "completion" | "editor";
}

export async function navigateToProjectRange(
  target: ProjectNavigationTarget,
): Promise<void> {
  await openProjectLocation(
    { path: target.path, range: { from: target.range.from, to: target.range.to } },
    { pdfView: "editor" },
  );
}

import { openProjectLocation } from "@/lib/open-location";
import type { SourceRange } from "@/lib/project-intelligence/types";

export interface ProjectNavigationTarget {
  path: string;
  range: Pick<SourceRange, "from" | "to">;
  source?: "outline" | "references" | "diagnostic" | "completion" | "editor";
}

/**
 * Opens a source location and selects its range once CodeMirror has the
 * document. A newer navigation cancels an older one. From the PDF-only view
 * it shows the editor in place of the PDF.
 */
export async function navigateToProjectRange(
  target: ProjectNavigationTarget,
): Promise<void> {
  await openProjectLocation(
    { path: target.path, range: { from: target.range.from, to: target.range.to } },
    { pdfView: "editor" },
  );
}

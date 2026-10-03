import { mermaidLanguage } from "./mermaid";
import { tikzLanguage } from "./tikz";
import type { DiagramLanguage, DiagramLanguageId } from "./types";
import { typstLanguage } from "./typst";

export * from "./types";
export { modelMarkLine, readModelMark, withoutModelMark } from "./model-mark";
export { typstPageLine, typstPreviewDocument, TYPST_PREVIEW_PREFIX_LINES } from "./typst";

export const DIAGRAM_LANGUAGES: Record<DiagramLanguageId, DiagramLanguage> = {
  tikz: tikzLanguage,
  typst: typstLanguage,
  mermaid: mermaidLanguage,
};

export function diagramLanguage(id: DiagramLanguageId): DiagramLanguage {
  return DIAGRAM_LANGUAGES[id];
}

export function isDiagramLanguageId(value: unknown): value is DiagramLanguageId {
  return value === "tikz" || value === "typst" || value === "mermaid";
}

export function languageForPath(path: string | null | undefined): DiagramLanguageId | null {
  const lower = (path ?? "").toLowerCase();
  if (/\.(?:tex|latex|ltx|tikz)$/.test(lower)) return "tikz";
  if (lower.endsWith(".typ")) return "typst";
  if (/\.(?:md|markdown|mmd)$/.test(lower)) return "mermaid";
  return null;
}

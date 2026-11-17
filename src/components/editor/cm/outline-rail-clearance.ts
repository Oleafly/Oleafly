import { EditorView } from "@codemirror/view";

const OUTLINE_DOCUMENT = /\.(?:tex|latex|ltx|typ|md|markdown|qmd|rmd)$/iu;

export function isOutlineDocument(path: string | null | undefined): boolean {
  return !!path && OUTLINE_DOCUMENT.test(path);
}

export const outlineRailClearance = EditorView.contentAttributes.of({ style: "padding-right: 2.5rem" });

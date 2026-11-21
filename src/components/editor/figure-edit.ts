import { FIGURE_GRID_MARKER } from "@oleafly/latex";
import type { FigureGridSource } from "@oleafly/latex/figure-grid";
import { getEditorView, insertAtCursor, replaceRange } from "@/components/editor/cm/controller";
import { logError } from "@/lib/log";
import { useFigureDialogStore, type FigureEditTarget } from "@/store/figure-dialog";

const INCLUDE_GRAPHICS =
  /\\includegraphics\s*(?:\[(?<options>[^\]]*)\]\s*)?\{(?<path>[^}]*)\}/u;
const WIDTH_OPTION = /(?:^|,)\s*width\s*=\s*(?<width>[^,]+)/u;

export interface IncludeGraphics {
  path: string;
  width: string | null;
}

export function parseIncludeGraphics(source: string): IncludeGraphics | null {
  const match = INCLUDE_GRAPHICS.exec(source);
  if (!match?.groups) return null;
  const options = match.groups.options ?? "";
  const width = WIDTH_OPTION.exec(options)?.groups?.width?.trim() ?? "";
  return { path: match.groups.path.trim(), width: width === "" ? null : width };
}

export function formatIncludeGraphics(figure: IncludeGraphics): string {
  const options = figure.width ? `[width=${figure.width}]` : "";
  return String.raw`\includegraphics${options}{${figure.path}}`;
}

export async function openFigureEditorAt(range: { from: number; to: number }): Promise<void> {
  const view = getEditorView();
  if (!view) return;
  const from = Math.max(0, Math.min(range.from, view.state.doc.length));
  const to = Math.max(from, Math.min(range.to, view.state.doc.length));
  const doc = view.state.doc.toString();
  if (doc.includes(FIGURE_GRID_MARKER)) {
    const { figureGridAt } = await import("@oleafly/latex/figure-grid");
    const grid = figureGridAt(doc, from);
    if (grid) {
      const path = grid.spec.images[0]?.[0]?.path ?? "";
      useFigureDialogStore.getState().openForEdit({ from: grid.from, to: grid.to, path, width: null, grid: grid.spec });
      return;
    }
  }
  const parsed = parseIncludeGraphics(view.state.sliceDoc(from, to));
  if (!parsed) return;
  useFigureDialogStore.getState().openForEdit({ from, to, ...parsed });
}

export function applyFigureEdit(target: FigureEditTarget, figure: IncludeGraphics): void {
  replaceRange(target.from, target.to, formatIncludeGraphics(figure));
}

export async function writeFigureGrid(grid: FigureGridSource, target: { from: number; to: number } | null): Promise<void> {
  if (target) replaceRange(target.from, target.to, grid.source);
  else insertAtCursor(`${grid.source}\n`);
  try {
    const { documentPackages, insertUsepackages, latexMainDocument } = await import("@/components/packages/latex-document");
    const mainDoc = latexMainDocument();
    if (!mainDoc) return;
    const loaded = await documentPackages(mainDoc);
    const missing = grid.packages.filter((name) => !loaded.has(name));
    await insertUsepackages(mainDoc, missing.map((name) => ({ name, options: "" })));
  } catch (error) {
    void logError("add figure grid packages", error);
  }
}

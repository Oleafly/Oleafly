import { getEditorView, replaceRange } from "@/components/editor/cm/controller";
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

export function openFigureEditorAt(range: { from: number; to: number }): void {
  const view = getEditorView();
  if (!view) return;
  const from = Math.max(0, Math.min(range.from, view.state.doc.length));
  const to = Math.max(from, Math.min(range.to, view.state.doc.length));
  const parsed = parseIncludeGraphics(view.state.sliceDoc(from, to));
  if (!parsed) return;
  useFigureDialogStore.getState().openForEdit({ from, to, ...parsed });
}

export function applyFigureEdit(target: FigureEditTarget, figure: IncludeGraphics): void {
  replaceRange(target.from, target.to, formatIncludeGraphics(figure));
}

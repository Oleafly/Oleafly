import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { figureSnippet } from "@/components/editor/latex-commands";
import {
  importableImageFiles,
  importImageFiles,
  PASTED_FIGURE_WIDTH,
  suggestedFigureLabel,
} from "@/components/editor/figure-import";

interface TransferData {
  types: readonly string[];
  files: ArrayLike<File>;
}

export function imageTransferFiles(data: TransferData | null | undefined): File[] {
  if (!data || Array.from(data.types).includes("text/plain")) return [];
  return importableImageFiles(data.files);
}

async function insertImportedFigures(view: EditorView, files: File[], at: number | null): Promise<void> {
  let position = at;
  await importImageFiles(files, (imported) => {
    const snippet = figureSnippet({
      path: imported.latexPath,
      width: PASTED_FIGURE_WIDTH,
      caption: "",
      label: suggestedFigureLabel(imported.path),
    });
    const selection = view.state.selection.main;
    const from = Math.min(position ?? selection.from, view.state.doc.length);
    const to = position === null ? selection.to : from;
    view.dispatch({
      changes: { from, to, insert: snippet.template },
      selection: { anchor: from + snippet.selStart, head: from + snippet.selEnd },
    });
    position = from + snippet.template.length;
  });
  view.focus();
}

export function imagePasteExtension(): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const files = imageTransferFiles(event.clipboardData);
      if (files.length === 0 || view.state.readOnly) return false;
      event.preventDefault();
      void insertImportedFigures(view, files, null);
      return true;
    },
    drop: (event, view) => {
      const files = imageTransferFiles(event.dataTransfer);
      if (files.length === 0 || view.state.readOnly) return false;
      event.preventDefault();
      void insertImportedFigures(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }));
      return true;
    },
  });
}

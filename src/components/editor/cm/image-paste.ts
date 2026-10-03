import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { figureSnippet } from "@/components/editor/latex-commands";
import {
  importableImageFiles,
  importImageFiles,
  PASTED_FIGURE_WIDTH,
  suggestedFigureLabel,
  type ImportedImage,
} from "@/components/editor/figure-import";
import { useFilesStore } from "@/store/files";

export type ImagePasteLanguage = "latex" | "typst";

type FigureSnippetFor = (imported: ImportedImage) => { template: string; selStart: number; selEnd: number };

interface TransferData {
  types: readonly string[];
  files: ArrayLike<File>;
}

export function imageTransferFiles(data: TransferData | null | undefined): File[] {
  if (!data || Array.from(data.types).includes("text/plain")) return [];
  return importableImageFiles(data.files);
}

function latexFigureSnippet(imported: ImportedImage) {
  return figureSnippet({
    path: imported.latexPath,
    width: PASTED_FIGURE_WIDTH,
    caption: "",
    label: suggestedFigureLabel(imported.path),
  });
}

async function typstFigureSnippetFor(): Promise<FigureSnippetFor> {
  const { typstFigureSource, typstImageReference, TYPST_PASTED_FIGURE_WIDTH } = await import(
    "@/components/editor/typst-figure"
  );
  const filePath = useFilesStore.getState().activePath;
  const version = useFilesStore.getState().engine.typst_resolved?.version ?? null;
  return (imported) => {
    const snippet = typstFigureSource(
      {
        path: typstImageReference(imported.path, filePath),
        width: TYPST_PASTED_FIGURE_WIDTH,
        caption: "",
        label: suggestedFigureLabel(imported.path),
        alt: null,
        placement: "none",
      },
      version,
    );
    return { ...snippet, template: `${snippet.template}\n` };
  };
}

async function insertImportedFigures(
  view: EditorView,
  files: File[],
  at: number | null,
  language: ImagePasteLanguage,
): Promise<void> {
  let position = at;
  const snippetFor = language === "typst" ? await typstFigureSnippetFor() : latexFigureSnippet;
  await importImageFiles(files, (imported) => {
    const snippet = snippetFor(imported);
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

export function imagePasteExtension(language: ImagePasteLanguage = "latex"): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const files = imageTransferFiles(event.clipboardData);
      if (files.length === 0 || view.state.readOnly) return false;
      event.preventDefault();
      void insertImportedFigures(view, files, null, language);
      return true;
    },
    drop: (event, view) => {
      const files = imageTransferFiles(event.dataTransfer);
      if (files.length === 0 || view.state.readOnly) return false;
      event.preventDefault();
      void insertImportedFigures(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }), language);
      return true;
    },
  });
}

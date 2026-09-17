import type { EditorView } from "@tiptap/pm/view";
import { scanMathExpressions } from "@oleafly/editor/math-source";
import { htmlToLatex, WYSIWYG_NODE_NAMES } from "@oleafly/wysiwyg";
import { i18n } from "@/i18n";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import {
  importableImageFiles,
  importImageFile,
  PASTED_FIGURE_WIDTH,
  suggestedFigureLabel,
} from "@/components/editor/figure-import";
import { insertParsedLatex, insertVisualFigure, positionAfterEnclosing } from "./insert";

export interface PasteData {
  types: readonly string[];
  getData(type: string): string;
  files: ArrayLike<File>;
}

export type PasteIntent =
  | { kind: "files"; files: File[] }
  | { kind: "latex"; latex: string }
  | { kind: "default" };

export interface VisualPasteContext {
  theoremEnvironments: () => readonly string[];
}

export interface VisualPasteHandlers {
  handlePaste: (view: EditorView, event: ClipboardEvent) => boolean;
  handleDrop: (view: EditorView, event: DragEvent, slice: unknown, moved: boolean) => boolean;
}

const LATEX_COMMAND = /\\[A-Za-z]+/u;

export function looksLikeLatex(text: string): boolean {
  if (LATEX_COMMAND.test(text)) return true;
  return scanMathExpressions(text, { format: "latex" }).some((expression) => expression.status === "complete");
}

export function classifyPaste(data: PasteData): PasteIntent {
  const files = importableImageFiles(data.files);
  const types = Array.from(data.types);
  const hasPlain = types.includes("text/plain");
  if (files.length > 0 && !hasPlain) return { kind: "files", files };
  const plain = hasPlain ? data.getData("text/plain") : "";
  const html = types.includes("text/html") ? data.getData("text/html") : "";
  if (html !== "") {
    const latex = htmlToLatex(html, { hasFiles: files.length > 0 });
    if (latex !== null && latex.trim() !== plain.trim()) return { kind: "latex", latex };
  }
  if (plain.trim() !== "" && looksLikeLatex(plain)) return { kind: "latex", latex: plain };
  return { kind: "default" };
}

function mutationLocked(): boolean {
  return isEditorMutationLocked(useFilesStore.getState().projectId);
}

async function importFigures(view: EditorView, files: File[], at: number | null): Promise<void> {
  let position = at;
  for (const file of files) {
    const imported = await importImageFile(file);
    if (!imported) continue;
    insertVisualFigure(
      view,
      {
        path: imported.latexPath,
        width: PASTED_FIGURE_WIDTH,
        centering: true,
        caption: "",
        label: suggestedFigureLabel(imported.path),
      },
      position,
    );
    position = positionAfterEnclosing(view.state, WYSIWYG_NODE_NAMES.figure);
    toast.success(i18n.t(($) => $.editor.paste.imageSaved, { path: imported.path }));
  }
}

export function createVisualPasteHandlers(context: VisualPasteContext): VisualPasteHandlers {
  const handlePaste = (view: EditorView, event: ClipboardEvent): boolean => {
    const data = event.clipboardData;
    if (!data || mutationLocked()) return false;
    const intent = classifyPaste(data);
    if (intent.kind === "default") return false;
    if (intent.kind === "latex") return insertParsedLatex(view, intent.latex, context.theoremEnvironments());
    void importFigures(view, intent.files, null);
    return true;
  };

  const handleDrop = (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean): boolean => {
    const data = event.dataTransfer;
    if (moved || !data || mutationLocked()) return false;
    const files = importableImageFiles(data.files);
    if (files.length === 0) return false;
    const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
    void importFigures(view, files, target?.pos ?? view.state.selection.from);
    return true;
  };

  return { handlePaste, handleDrop };
}

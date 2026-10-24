import type { EditorView } from "@tiptap/pm/view";
import { WYSIWYG_NODE_NAMES } from "@oleafly/wysiwyg";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { isNativeFileDrop } from "@/lib/native-drop";
import { appUrlProjectPath, fileLinkDestination, fileLinkText, isLinkImage, linkBase } from "@/lib/file-links";
import { localizedVisualHref } from "@/features/file-links";
import { treeDragPath } from "@/lib/tree-drag";
import { linkHrefForPath } from "@oleafly/wysiwyg/link-destination";
import { useFilesStore } from "@/store/files";
import {
  importableImageFiles,
  importImageFiles,
  nativeDroppedImages,
  PASTED_FIGURE_WIDTH,
  suggestedFigureLabel,
} from "@/components/editor/figure-import";
import { insertVisualFigure, positionAfterEnclosing } from "./insert";

export interface PasteData {
  types: readonly string[];
  getData(type: string): string;
  files: ArrayLike<File>;
}

export type PasteIntent =
  | { kind: "files"; files: File[] }
  | { kind: "default" };

export interface VisualPasteHandlers {
  handlePaste: (view: EditorView, event: ClipboardEvent) => boolean;
  handleDrop: (view: EditorView, event: DragEvent, slice: unknown, moved: boolean) => boolean;
}

export function classifyPaste(data: PasteData): PasteIntent {
  const files = importableImageFiles(data.files);
  const hasPlain = new Set(data.types).has("text/plain");
  if (files.length > 0 && !hasPlain) return { kind: "files", files };
  return { kind: "default" };
}

function mutationLocked(): boolean {
  return isEditorMutationLocked(useFilesStore.getState().projectId);
}

async function importFigures(view: EditorView, files: File[], at: number | null): Promise<void> {
  let position = at;
  await importImageFiles(files, (imported) => {
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
  });
}

function insertFileLink(view: EditorView, at: number, target: string) {
  const { activePath, mainDoc } = useFilesStore.getState();
  const fromFile = activePath ? linkBase(activePath, mainDoc) : "";
  const href = linkHrefForPath(fileLinkDestination("markdown", target, { fromFile, mainDoc: fromFile }));
  const { schema } = view.state;
  const image = isLinkImage("markdown", target) ? schema.nodes.image : undefined;
  const tr = image
    ? view.state.tr.replaceRangeWith(at, at, image.create({ src: href, alt: fileLinkText(target) }))
    : view.state.tr.insert(at, schema.text(fileLinkText(target), [schema.marks.link.create({ href })]));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/**
 * A link copied with the webview's "Copy Link" is the app's own address as
 * plain text. On macOS and Linux Tiptap pastes it as plain text (it does not
 * link a `tauri:` URL), and on Windows it links it with the address as the
 * text. Paste a link to the project file, named after the file, instead.
 */
function pasteAppLink(view: EditorView, data: PasteData): boolean {
  const text = data.getData("text/plain").trim();
  if (!text || /\s/u.test(text)) return false;
  const href = localizedVisualHref(text);
  const target = href === null ? null : appUrlProjectPath(text);
  if (href === null || !target || !view.editable) return false;
  const { schema, selection } = view.state;
  const link = schema.marks.link.create({ href });
  const tr = selection.empty
    ? view.state.tr.replaceSelectionWith(schema.text(fileLinkText(target.path), [link]), false)
    : view.state.tr.addMark(selection.from, selection.to, link);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function createVisualPasteHandlers(): VisualPasteHandlers {
  const handlePaste = (view: EditorView, event: ClipboardEvent): boolean => {
    const data = event.clipboardData;
    if (!data || mutationLocked()) return false;
    if (pasteAppLink(view, data)) {
      event.preventDefault();
      return true;
    }
    const intent = classifyPaste(data);
    if (intent.kind === "default") return false;
    void importFigures(view, intent.files, null);
    return true;
  };

  const handleDrop = (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean): boolean => {
    const data = event.dataTransfer;
    if (moved || !data || mutationLocked()) return false;
    const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
    const at = target?.pos ?? view.state.selection.from;
    const treePath = treeDragPath(data);
    if (treePath) {
      if (!view.editable) return false;
      event.preventDefault();
      insertFileLink(view, at, treePath);
      return true;
    }
    const files = importableImageFiles(data.files);
    if (files.length > 0) {
      void importFigures(view, files, at);
      return true;
    }
    if (!isNativeFileDrop(data)) return false;
    void nativeDroppedImages().then((images) =>
      images.length > 0 ? importFigures(view, images, at) : undefined,
    );
    return true;
  };

  return { handlePaste, handleDrop };
}

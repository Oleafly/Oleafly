import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { typstContextAt } from "@oleafly/editor";
import { markdownLinkDestination } from "@oleafly/wysiwyg/link-destination";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import {
  appUrlProjectPath,
  escapeTypstString,
  fileLinkDestination,
  fileLinkSource,
  isLinkImage,
  linkLanguageFor,
  type FileLinkPlace,
  type LinkLanguage,
} from "@/lib/file-links";
import { treeDragPath } from "@/lib/tree-drag";
import { useFilesStore } from "@/store/files";
import { figureSnippetBuilder, insertFigureSnippet } from "./image-paste";
import { recognizeFileTarget, recognizeImportPath } from "./latex-contexts";

const CONTEXT_LIMIT = 1_000;
const MARKDOWN_ANGLE_DESTINATION = /\]\(\s*<[^<>\n]*$/u;
const MARKDOWN_DESTINATION = /\]\(\s*[^()\s]*$/u;

export type FileLinkInsertion =
  | { kind: "text"; text: string }
  | { kind: "figure" };

function textBefore(state: EditorState, pos: number): string {
  return state.sliceDoc(Math.max(0, pos - CONTEXT_LIMIT), pos);
}

function markdownDestinationAt(state: EditorState, pos: number, destination: string): string | null {
  const before = textBefore(state, pos);
  if (MARKDOWN_ANGLE_DESTINATION.test(before)) return destination.replaceAll(/[\\<>]/gu, (character) => `\\${character}`);
  return MARKDOWN_DESTINATION.test(before) ? markdownLinkDestination(destination) : null;
}

export interface FileLinkInsertionOptions {
  readonly embedImages: boolean;
  readonly text?: string;
  /** `#heading` and the like, kept after the path. */
  readonly fragment?: string;
}

export function fileLinkInsertion(
  state: EditorState,
  pos: number,
  language: LinkLanguage,
  target: string,
  place: FileLinkPlace,
  options: FileLinkInsertionOptions,
): FileLinkInsertion {
  const fragment = options.fragment ?? "";
  const destination = fileLinkDestination(language, target, place) + fragment;
  const image = options.embedImages && isLinkImage(language, target);
  if (language === "markdown") {
    const inside = markdownDestinationAt(state, pos, destination);
    if (inside !== null) return { kind: "text", text: inside };
    const text = fileLinkSource(language, target, place, { text: options.text, fragment });
    return { kind: "text", text: image ? `!${text}` : text };
  }
  if (language === "typst") {
    const context = typstContextAt(state, pos);
    if (context === "string") return { kind: "text", text: escapeTypstString(destination) };
    if (image) return { kind: "figure" };
    return {
      kind: "text",
      text: fileLinkSource(language, target, place, { text: options.text, typstHash: context !== "code", fragment }),
    };
  }
  const before = textBefore(state, pos);
  if (recognizeFileTarget(before) || recognizeImportPath(before)) return { kind: "text", text: destination };
  if (image) return { kind: "figure" };
  return { kind: "text", text: fileLinkSource(language, target, place, { text: options.text, fragment }) };
}

export function currentPlace(): { language: LinkLanguage; place: FileLinkPlace } | null {
  const files = useFilesStore.getState();
  const language = linkLanguageFor(files.activePath);
  if (!language || !files.activePath) return null;
  return { language, place: { fromFile: files.activePath, mainDoc: files.mainDoc } };
}

export function editable(view: EditorView): boolean {
  return !view.state.readOnly && !isEditorMutationLocked(useFilesStore.getState().projectId);
}

export async function insertFigure(view: EditorView, language: LinkLanguage, target: string, place: FileLinkPlace, at: number) {
  const snippetFor = await figureSnippetBuilder(language === "typst" ? "typst" : "latex");
  if (!editable(view)) return;
  insertFigureSnippet(view, snippetFor({ path: target, latexPath: fileLinkDestination("latex", target, place) }), at);
  view.focus();
}

function dropFileLink(event: DragEvent, view: EditorView): boolean {
  const target = treeDragPath(event.dataTransfer);
  const current = currentPlace();
  if (!target || !current || !editable(view)) return false;
  event.preventDefault();
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
  const insertion = fileLinkInsertion(view.state, at, current.language, target, current.place, { embedImages: true });
  if (insertion.kind === "figure") {
    void insertFigure(view, current.language, target, current.place, at);
    return true;
  }
  view.dispatch({
    changes: { from: at, insert: insertion.text },
    selection: { anchor: at + insertion.text.length },
    userEvent: "input.drop",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/**
 * What to insert for a link that carries the app's own address, as one copied
 * or dragged out of the preview does: the relative path inside a link
 * destination or a file command, and a link to the file in the document's own
 * syntax anywhere else. Null for any other text.
 */
export function appLinkInsertion(state: EditorState, pos: number, text: string): string | null {
  const current = currentPlace();
  if (!current || /\s/u.test(text)) return null;
  const target = appUrlProjectPath(text);
  if (!target) return null;
  const insertion = fileLinkInsertion(state, pos, current.language, target.path, current.place, {
    embedImages: false,
    fragment: target.fragment,
  });
  return insertion.kind === "text" ? insertion.text : null;
}

function pasteAppLink(event: ClipboardEvent, view: EditorView): boolean {
  const text = event.clipboardData?.getData("text/plain").trim();
  if (!text || !editable(view)) return false;
  const local = appLinkInsertion(view.state, view.state.selection.main.from, text);
  if (local === null) return false;
  event.preventDefault();
  view.dispatch(view.state.replaceSelection(local), { userEvent: "input.paste", scrollIntoView: true });
  return true;
}

/** The single URL a drag carries, if it carries one (a link dragged out of the preview). */
function draggedUrl(data: DataTransfer | null): string | null {
  const uris = (data?.getData("text/uri-list") ?? "").split(/\r?\n/u).filter((line) => line && !line.startsWith("#"));
  const text = uris.length === 1 ? uris[0] : (data?.getData("text/plain") ?? "");
  return text.trim() || null;
}

function dropAppLink(event: DragEvent, view: EditorView): boolean {
  const url = draggedUrl(event.dataTransfer);
  if (!url || !editable(view)) return false;
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
  const local = appLinkInsertion(view.state, at, url);
  if (local === null) return false;
  event.preventDefault();
  view.dispatch({
    changes: { from: at, insert: local },
    selection: { anchor: at + local.length },
    userEvent: "input.drop",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function projectFileLinksExtension(): Extension {
  return EditorView.domEventHandlers({
    drop: (event, view) => dropFileLink(event, view) || dropAppLink(event, view),
    paste: pasteAppLink,
  });
}

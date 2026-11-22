import { startCompletion } from "@codemirror/autocomplete";
import { typstContextAt } from "@oleafly/editor";
import { getEditorView } from "@/components/editor/cm/controller";
import { currentPlace, editable, fileLinkInsertion } from "@/components/editor/cm/file-links";
import { getWysiwygEditor, isWysiwygActive } from "@/components/editor/wysiwyg/controller";
import { linkHrefForPath } from "@oleafly/wysiwyg/link-destination";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import {
  fileLinkDestination,
  fileLinkSource,
  fileLinkText,
  linkBase,
  linkLanguageFor,
  localizeAppLink,
  projectFileForHref,
  type FileLinkPlace,
  type LinkLanguage,
} from "@/lib/file-links";
import { i18n } from "@/i18n";
import { writeClipboardText } from "@/lib/clipboard";
import { logError } from "@/lib/log";
import { openProjectLocation } from "@/lib/open-location";
import { projectFilePath } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { isWindows } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

export function canInsertFileLink(activePath: string | null): boolean {
  return linkLanguageFor(activePath) !== null;
}

function selectedLinkText(text: string): string | undefined {
  return text.trim() && !text.includes("\n") ? text : undefined;
}

function insertVisualFileLink(target: string, place: FileLinkPlace): boolean {
  const editor = getWysiwygEditor();
  if (!editor?.isEditable) return false;
  const href = linkHrefForPath(fileLinkDestination("markdown", target, place));
  const chain = editor.chain().focus();
  if (editor.state.selection.empty) {
    chain.insertContent({ type: "text", text: fileLinkText(target), marks: [{ type: "link", attrs: { href } }] }).run();
  } else {
    chain.extendMarkRange("link").setLink({ href }).run();
  }
  return true;
}

export function insertFileLink(target: string): boolean {
  const current = currentPlace();
  if (!current || isEditorMutationLocked(useFilesStore.getState().projectId)) return false;
  if (current.language === "markdown" && isWysiwygActive()) return insertVisualFileLink(target, current.place);
  const view = getEditorView();
  if (!view || !editable(view)) return false;
  const { from, to } = view.state.selection.main;
  const insertion = fileLinkInsertion(view.state, from, current.language, target, current.place, {
    embedImages: false,
    text: selectedLinkText(view.state.sliceDoc(from, to)),
  });
  if (insertion.kind !== "text") return false;
  view.dispatch({
    changes: { from, to, insert: insertion.text },
    selection: { anchor: from + insertion.text.length },
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export type FileReference = "link" | "path" | "relativePath";

function fileReferenceText(target: string, reference: FileReference): Promise<string> {
  const files = useFilesStore.getState();
  if (reference === "relativePath") return Promise.resolve(isWindows ? target.replaceAll("/", "\\") : target);
  if (reference === "path") {
    if (!files.projectId) return Promise.reject(new Error("no project is open"));
    return projectFilePath(files.projectId, target);
  }
  const language = linkLanguageFor(files.activePath);
  return Promise.resolve(
    fileLinkSource(language ?? "markdown", target, {
      fromFile: language ? (files.activePath ?? "") : "",
      mainDoc: files.mainDoc,
    }),
  );
}

export async function copyFileReference(target: string, reference: FileReference): Promise<boolean> {
  const link = reference === "link";
  try {
    await writeClipboardText(await fileReferenceText(target, reference));
    toast.success(
      link ? i18n.t(($) => $.workspace.files.linkCopied) : i18n.t(($) => $.workspace.files.pathCopied),
    );
    return true;
  } catch (error) {
    void logError(`copy file ${reference}`, error);
    toast.error(
      link ? i18n.t(($) => $.workspace.files.copyLinkFailed) : i18n.t(($) => $.workspace.files.copyPathFailed),
    );
    return false;
  }
}

function linkTemplate(language: LinkLanguage, text: string, typstHash: boolean): [string, string] {
  if (language === "markdown") return [`[${text}](`, ")"];
  if (language === "typst") return [`${typstHash ? "#" : ""}link("`, `")[${text}]`];
  return [String.raw`\href{`, `}{${text}}`];
}

export function canStartFileLinkInsertion(activePath: string | null): boolean {
  return canInsertFileLink(activePath) && !(linkLanguageFor(activePath) === "markdown" && isWysiwygActive());
}

export function startFileLinkInsertion(): boolean {
  const current = currentPlace();
  const view = getEditorView();
  if (!current || !view || !editable(view) || !canStartFileLinkInsertion(current.place.fromFile)) return false;
  const { from, to } = view.state.selection.main;
  const [head, tail] = linkTemplate(
    current.language,
    selectedLinkText(view.state.sliceDoc(from, to)) ?? "",
    typstContextAt(view.state, from) !== "code",
  );
  view.dispatch({
    changes: { from, to, insert: `${head}${tail}` },
    selection: { anchor: from + head.length },
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  startCompletion(view);
  return true;
}

export function openLinkedProjectFile(path: string): boolean {
  if (!useFilesStore.getState().tree.some((entry) => entry.path === path && !entry.is_dir)) return false;
  void openProjectLocation({ path });
  return true;
}

function visualLinkBase(): string | null {
  const { activePath, mainDoc } = useFilesStore.getState();
  return activePath ? linkBase(activePath, mainDoc) : null;
}

export function localizedVisualHref(href: string): string | null {
  const base = visualLinkBase();
  const target = base ? localizeAppLink(href, base) : null;
  return target ? linkHrefForPath(target.path, target.fragment) : null;
}

export function openVisualLinkHref(href: string): boolean {
  const base = visualLinkBase();
  const target = base ? projectFileForHref(base, href) : null;
  return target ? openLinkedProjectFile(target.path) : false;
}

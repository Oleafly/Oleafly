import { type Editor, Extension, type JSONContent } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { clearThumbnailCache } from "@/components/editor/cm/hover-asset";
import { preferredImageName } from "@/components/editor/figure-import";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { notifyProjectFilesChanged } from "@/lib/cross-window";
import { diskHash } from "@/lib/disk-hash";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { carriesFiles } from "@/lib/external-drop-guard";
import { logError } from "@/lib/log";
import { isNativeFileDrop, takeNativeDrop } from "@/lib/native-drop";
import { noteRelativePath } from "@/lib/project-notes";
import { uint8ToBase64, writeProjectBytes } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { caretAfterDrawnBlock } from "./block-views";
import { NOTEBOOK_INFO } from "./notebook-block";
import { NOTE_FILE_MAX_BYTES, NOTE_MEDIA_EXTENSIONS, noteMediaExtension, noteMediaKind } from "./note-path";
import { linkChoicePlugin, pasteLink } from "./note-link-choice";
import type { AttachFilter, NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const NOTE_FILE_FOLDER = "assets";
const TOAST_KEY = "note-file-import";
const HASH_CHARS = 8;

const ATTACHMENTS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"],
  table: ["csv", "tsv", "xlsx", "xls"],
  molecule: ["pdb", "sdf", "cif", "mol", "mol2", "xyz"],
  notebook: ["ipynb"],
  media: [...NOTE_MEDIA_EXTENSIONS.audio, ...NOTE_MEDIA_EXTENSIONS.video, ...NOTE_MEDIA_EXTENSIONS.pdf],
} as const;

type Attachment = keyof typeof ATTACHMENTS;
export type AttachKind = "image" | "file";
type AttachFile = NonNullable<NotesData["attachFile"]>;

export interface NoteImageTarget {
  projectId: string;
  notePath: string | null;
}

export interface NoteImageDropOptions {
  target: () => NoteImageTarget | null;
  attach: () => AttachFile | undefined;
}

function attachFilter(kind: AttachKind): AttachFilter {
  if (kind === "image") {
    return { title: i18n.t(($) => $.editor.toolbar.insertImage), name: i18n.t(($) => $.editor.toolbar.imageFile), extensions: ATTACHMENTS.image };
  }
  return { title: i18n.t(($) => $.notes.toolbar.attach), name: i18n.t(($) => $.notes.toolbar.attachFilter), extensions: Object.values(ATTACHMENTS).flat() };
}

export function attachmentOf(name: string): Attachment | null {
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  const found = Object.entries(ATTACHMENTS).find(([, list]) => (list as readonly string[]).includes(extension));
  return found ? (found[0] as Attachment) : null;
}

function fileAttachment(file: File): Attachment | null {
  const named = attachmentOf(file.name);
  if (named) return named;
  if (file.type.startsWith("image/")) return "image";
  return noteMediaExtension(file.type) === null ? null : "media";
}

function attachmentName(file: File, kind: Exclude<Attachment, "image">, now: Date): string {
  const dot = file.name.lastIndexOf(".");
  const named = attachmentOf(file.name) !== null;
  const extension = named ? file.name.slice(dot + 1) : (noteMediaExtension(file.type) ?? "");
  const preferred = preferredImageName(new File([], `${named ? file.name.slice(0, dot) : file.name}.${extension}`), now);
  if (preferred.endsWith(`.${extension}`)) return preferred;
  const base = kind === "media" ? noteMediaKind(`file.${extension}`) : kind;
  return `${base}.${extension}`;
}

function attachmentNode(kind: Attachment, path: string): JSONContent {
  if (kind === "image" || kind === "media") return { type: "image", attrs: { src: path, alt: "" } };
  const [info, text] = kind === "notebook" ? [NOTEBOOK_INFO, path] : [kind === "table" ? "csv" : "molecule", `path: ${path}`];
  return { type: "codeBlock", attrs: { language: info }, content: [{ type: "text", text }] };
}

export function noteImageTarget(note: Pick<NoteItem, "id" | "home">): NoteImageTarget {
  return note.home ? { projectId: note.home.projectId, notePath: note.home.path } : { projectId: note.id, notePath: null };
}

export function noteImageName(file: File, data: string, now: Date): string {
  const kind = fileAttachment(file);
  const name = kind === null || kind === "image" ? preferredImageName(file, now) : attachmentName(file, kind, now);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  return `${NOTE_FILE_FOLDER}/${stem}-${diskHash(data).slice(0, HASH_CHARS)}${extension}`;
}

async function saveNoteFile(target: NoteImageTarget, file: File): Promise<string> {
  const data = uint8ToBase64(new Uint8Array(await file.arrayBuffer()));
  const relative = noteImageName(file, data, new Date());
  const projectPath = target.notePath === null ? relative : noteRelativePath(target.notePath, relative);
  if (projectPath === null) throw new Error("The note has no folder for files.");
  await writeProjectBytes(target.projectId, projectPath, data);
  clearThumbnailCache();
  if (target.notePath !== null) {
    notifyProjectFilesChanged(target.projectId, [projectPath]);
    const files = useFilesStore.getState();
    if (files.projectId === target.projectId) {
      await files.refreshTree().catch((error: unknown) => logError("refresh files after a note file", error));
    }
  }
  return relative;
}

const noteImageDropKey = new PluginKey<ReadonlyMap<number, number>>("noteImageDrop");
let marks = 0;

interface MarkMeta {
  add?: readonly [number, number];
  remove?: number;
}

function markPosition(view: EditorView, at: number | null): number | null {
  if (at === null || view.isDestroyed) return null;
  const id = ++marks;
  view.dispatch(view.state.tr.setMeta(noteImageDropKey, { add: [id, at] } satisfies MarkMeta));
  return id;
}

function takePosition(view: EditorView, id: number | null): number | null {
  if (id === null || view.isDestroyed) return null;
  const at = noteImageDropKey.getState(view.state)?.get(id) ?? null;
  view.dispatch(view.state.tr.setMeta(noteImageDropKey, { remove: id } satisfies MarkMeta));
  return at;
}

function place(editor: Editor, kind: Attachment, path: string, at: number | null): void {
  if (editor.isDestroyed) return;
  const chain = editor.chain().focus();
  if (at !== null) chain.setTextSelection(Math.min(at, editor.state.doc.content.size));
  chain.insertContent(attachmentNode(kind, path)).command(caretAfterDrawnBlock).scrollIntoView().run();
}

function sayFailed(error: unknown): void {
  void logError("add a file to a note", error);
  toast.errorUnique(TOAST_KEY, i18n.t(($) => $.notes.document.fileFailed, { error: describeError(error) }));
}

async function importNoteFile(editor: Editor, target: NoteImageTarget, file: File, mark: number | null): Promise<number | null> {
  const kind = fileAttachment(file);
  if (!kind) return mark;
  if (file.size > NOTE_FILE_MAX_BYTES) {
    toast.errorUnique(TOAST_KEY, i18n.t(($) => $.notes.document.fileTooLarge, { name: file.name }));
    return mark;
  }
  try {
    const path = await saveNoteFile(target, file);
    place(editor, kind, path, takePosition(editor.view, mark));
    return null;
  } catch (error) {
    sayFailed(error);
    return mark;
  }
}

async function importFilesFrom(editor: Editor, target: NoteImageTarget, files: readonly File[], index: number, mark: number | null): Promise<number | null> {
  if (index >= files.length) return mark;
  const left = await importNoteFile(editor, target, files[index], mark);
  return importFilesFrom(editor, target, files, index + 1, left);
}

async function importNoteFiles(editor: Editor, target: NoteImageTarget, files: readonly File[], marked: number | null): Promise<void> {
  let mark = marked;
  try {
    if (isEditorMutationLocked(target.projectId)) return;
    mark = await importFilesFrom(editor, target, files, 0, mark);
  } finally {
    takePosition(editor.view, mark);
  }
}

function optionsOf(editor: Editor): NoteImageDropOptions | null {
  const extension = editor.extensionManager.extensions.find((candidate) => candidate.name === "noteImageDrop");
  return (extension?.options as NoteImageDropOptions | undefined) ?? null;
}

export function canAttach(editor: Editor): boolean {
  const options = optionsOf(editor);
  return Boolean(options?.target() && options.attach());
}

export async function attachFile(editor: Editor, kind: AttachKind): Promise<void> {
  const options = optionsOf(editor);
  const target = options?.target();
  const attach = options?.attach();
  if (!target || !attach || isEditorMutationLocked(target.projectId)) return;
  const mark = markPosition(editor.view, editor.state.selection.from);
  try {
    const path = await attach(target.projectId, attachFilter(kind));
    const found = path ? attachmentOf(path) : null;
    if (path && found) place(editor, found, path, takePosition(editor.view, mark));
  } catch (error) {
    sayFailed(error);
  } finally {
    takePosition(editor.view, mark);
  }
}

function sayUnsupported(): void {
  toast.infoUnique(TOAST_KEY, i18n.t(($) => $.notes.document.unsupportedFile));
}

function carriesAnyFile(transfer: DataTransfer | null): boolean {
  return carriesFiles(transfer) || isNativeFileDrop(transfer);
}

function acceptFileDrag(view: EditorView, event: DragEvent): void {
  if (!view.editable || !carriesAnyFile(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

async function nativeDroppedFiles(): Promise<File[]> {
  const dropped = (await takeNativeDrop()).filter(({ name }) => attachmentOf(name) !== null);
  return Promise.all(dropped.map((file) => file.read()));
}

export const NoteImageDrop = Extension.create<NoteImageDropOptions>({
  name: "noteImageDrop",

  addOptions() {
    return { target: () => null, attach: () => undefined };
  },

  addProseMirrorPlugins() {
    const { target } = this.options;
    const { editor } = this;
    return [
      linkChoicePlugin(),
      new Plugin<ReadonlyMap<number, number>>({
        key: noteImageDropKey,
        state: {
          init: () => new Map(),
          apply: (tr, positions) => {
            const meta = tr.getMeta(noteImageDropKey) as MarkMeta | undefined;
            if (!meta && !tr.docChanged) return positions;
            const next = new Map<number, number>();
            for (const [id, at] of positions) if (id !== meta?.remove) next.set(id, tr.mapping.map(at));
            if (meta?.add) next.set(meta.add[0], meta.add[1]);
            return next;
          },
        },
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (data?.files.length === 0 && pasteLink(view, data.getData("text/plain"))) {
              event.preventDefault();
              return true;
            }
            const where = target();
            if (!data || !where) return false;
            const files = Array.from(data.files).filter((file) => fileAttachment(file) !== null);
            if (files.length === 0 || Array.from(data.types).includes("text/plain")) return false;
            event.preventDefault();
            void importNoteFiles(editor, where, files, null);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            const data = event.dataTransfer;
            if (moved || !carriesAnyFile(data)) return false;
            event.preventDefault();
            const where = target();
            if (!where) return true;
            const files = Array.from(data?.files ?? []).filter((file) => fileAttachment(file) !== null);
            if (files.length === 0 && !isNativeFileDrop(data)) {
              sayUnsupported();
              return true;
            }
            const mark = markPosition(view, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null);
            const dropped = files.length > 0 ? Promise.resolve(files) : nativeDroppedFiles();
            void dropped.then(
              (found) => {
                if (found.length === 0) sayUnsupported();
                return importNoteFiles(editor, where, found, mark);
              },
              (error: unknown) => {
                takePosition(view, mark);
                sayFailed(error);
              },
            );
            return true;
          },
          handleDOMEvents: {
            dragenter: acceptFileDrag,
            dragover: acceptFileDrag,
          },
        },
      }),
    ];
  },
});

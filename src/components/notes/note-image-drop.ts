import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { clearThumbnailCache } from "@/components/editor/cm/hover-asset";
import { importableImageFiles, nativeDroppedImages, preferredImageName } from "@/components/editor/figure-import";
import { i18n } from "@/i18n";
import { notifyProjectFilesChanged } from "@/lib/cross-window";
import { diskHash } from "@/lib/disk-hash";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { carriesFiles } from "@/lib/external-drop-guard";
import { logError } from "@/lib/log";
import { isNativeFileDrop } from "@/lib/native-drop";
import { noteRelativePath } from "@/lib/project-notes";
import { uint8ToBase64, writeProjectBytes } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import type { NoteItem } from "./types";

export const NOTE_IMAGE_FOLDER = "assets";
export const NOTE_IMAGE_TOAST_KEY = "note-image-import";
const HASH_CHARS = 8;

export interface NoteImageTarget {
  projectId: string;
  notePath: string | null;
}

export function noteImageTarget(note: Pick<NoteItem, "id" | "home">): NoteImageTarget {
  return note.home ? { projectId: note.home.projectId, notePath: note.home.path } : { projectId: note.id, notePath: null };
}

export function noteImageName(file: File, data: string, now: Date): string {
  const name = preferredImageName(file, now);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  return `${NOTE_IMAGE_FOLDER}/${stem}-${diskHash(data).slice(0, HASH_CHARS)}${extension}`;
}

export async function saveNoteImage(target: NoteImageTarget, file: File): Promise<string> {
  const data = uint8ToBase64(new Uint8Array(await file.arrayBuffer()));
  const relative = noteImageName(file, data, new Date());
  const projectPath = target.notePath === null ? relative : noteRelativePath(target.notePath, relative);
  if (projectPath === null) throw new Error("The note has no folder for images.");
  await writeProjectBytes(target.projectId, projectPath, data);
  clearThumbnailCache();
  if (target.notePath !== null) {
    notifyProjectFilesChanged(target.projectId, [projectPath]);
    const files = useFilesStore.getState();
    if (files.projectId === target.projectId) {
      await files.refreshTree().catch((error: unknown) => logError("refresh files after a note image", error));
    }
  }
  return relative;
}

export interface NoteImageDropOptions {
  target: () => NoteImageTarget | null;
}

function placeImage(view: EditorView, src: string, at: number | null): void {
  const image = view.state.schema.nodes.image;
  if (!image || view.isDestroyed) return;
  const tr = view.state.tr;
  if (at !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))));
  tr.replaceSelectionWith(image.create({ src, alt: "" }));
  view.dispatch(tr.scrollIntoView());
}

export async function importNoteImages(view: EditorView, target: NoteImageTarget, files: readonly File[], at: number | null): Promise<void> {
  if (isEditorMutationLocked(target.projectId)) return;
  let position = at;
  let failed = false;
  for (const file of files) {
    try {
      placeImage(view, await saveNoteImage(target, file), position);
      position = null;
    } catch (error) {
      failed = true;
      void logError("save an image into a note", error);
    }
  }
  if (failed) toast.errorUnique(NOTE_IMAGE_TOAST_KEY, i18n.t(($) => $.notes.document.imageFailed));
  if (!view.isDestroyed) view.focus();
}

function carriesAnyFile(transfer: DataTransfer | null): boolean {
  return carriesFiles(transfer) || isNativeFileDrop(transfer);
}

function acceptFileDrag(view: EditorView, event: DragEvent): boolean {
  if (!view.editable || !carriesAnyFile(event.dataTransfer)) return false;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  return false;
}

const noteImageDropKey = new PluginKey("noteImageDrop");

export const NoteImageDrop = Extension.create<NoteImageDropOptions>({
  name: "noteImageDrop",

  addOptions() {
    return { target: () => null };
  },

  addProseMirrorPlugins() {
    const { target } = this.options;
    return [
      new Plugin({
        key: noteImageDropKey,
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            const where = target();
            if (!data || !where) return false;
            const files = importableImageFiles(data.files);
            if (files.length === 0 || Array.from(data.types).includes("text/plain")) return false;
            event.preventDefault();
            void importNoteImages(view, where, files, null);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            const data = event.dataTransfer;
            if (moved || !carriesAnyFile(data)) return false;
            event.preventDefault();
            const where = target();
            if (!where) return true;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
            const files = importableImageFiles(data?.files);
            if (files.length > 0) {
              void importNoteImages(view, where, files, at);
              return true;
            }
            if (isNativeFileDrop(data)) {
              void nativeDroppedImages().then((images) => (images.length > 0 ? importNoteImages(view, where, images, at) : undefined));
            }
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

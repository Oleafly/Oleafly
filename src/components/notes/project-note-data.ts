import { mirrorFileText } from "@/lib/live-file-mirror";
import { noteRelativePath } from "@/lib/project-notes";
import { readFileContent, revealProject } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { assetFragment } from "./note-path";
import type { NotesData } from "./notes-data";
import { lfLineEndings, noteAssetUrl, noteVersion, recordNoteWrite, usesCrlf } from "./notes-service";
import { NoteConflictError, type NoteSource } from "./types";

export interface ProjectNoteTarget {
  projectId: string;
  path: string;
}

type FileParts = "loadNote" | "saveNote" | "watchNote" | "resolveAsset" | "openAsset" | "revealAsset" | "noteTextChanged";

export type ProjectNoteFiles = Required<Pick<NotesData, FileParts>>;

export interface ProjectNoteFilesOptions {
  key: string;
  others: () => Pick<NotesData, FileParts>;
  refused: () => string;
}

export class ProjectNoteWriteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectNoteWriteRefused";
  }
}

function source(text: string): NoteSource {
  return { text, version: noteVersion(text) };
}

const noWatch = () => {};

export function createProjectNoteFiles(target: ProjectNoteTarget, options: ProjectNoteFilesOptions): ProjectNoteFiles {
  const { projectId, path } = target;
  const { key, others } = options;
  let own: string | null = null;
  const openHere = () => useFilesStore.getState().projectId === projectId;
  const held = () => (openHere() ? useFilesStore.getState().files[path] : undefined);
  const readRaw = () => readFileContent(projectId, path);
  const readDisk = async () => lfLineEndings(await readRaw());

  const writeFile = async (text: string, version: string, base: string | undefined, closedProject: boolean) => {
    const disk = base === undefined ? await readRaw() : await readRaw().catch(() => null);
    if (base === undefined && disk !== null && noteVersion(disk) !== version) throw new NoteConflictError(source(lfLineEndings(disk)));
    await useFilesStore.getState().writeProjectFile(projectId, path, text, {
      ...(disk === null ? {} : { crlf: usesCrlf(disk) }),
      ...(closedProject ? { closedProject: true } : {}),
      ...(base === undefined ? {} : { base: lfLineEndings(base) }),
    });
    return source(text);
  };

  const save = async (text: string, version: string, base: string | undefined): Promise<NoteSource> => {
    const written = lfLineEndings(text);
    if (!openHere()) return writeFile(written, version, base, true);
    const file = held();
    if (!file) return writeFile(written, version, base, false);
    const unsavedOwnWrite = file.dirty && file.content === own;
    if (base === undefined && !unsavedOwnWrite && noteVersion(file.content) !== version) {
      throw new NoteConflictError(source(file.content));
    }
    own = written;
    const files = useFilesStore.getState();
    const accepted = base === undefined ? files.setContent(path, written) : files.setContent(path, written, { base: lfLineEndings(base) });
    if (!accepted) throw new ProjectNoteWriteRefused(options.refused());
    await useFilesStore.getState().saveFile(path);
    return source(written);
  };

  const watch = (onChange: () => void) =>
    useFilesStore.subscribe((state, previous) => {
      if (state.projectId !== projectId) return;
      const next = state.files[path]?.content;
      if (next === undefined || next === previous.files[path]?.content || next === own) return;
      onChange();
    });

  const mirror = (text: string) => {
    const shared = lfLineEndings(text);
    if (held()?.content === shared) return;
    own = shared;
    mirrorFileText(projectId, path, shared);
  };

  const resolve = (relative: string): Promise<string | null> => {
    const full = noteRelativePath(path, relative);
    if (full === null) return Promise.resolve(null);
    return noteAssetUrl(projectId, full);
  };

  const reveal = async (relative: string) => {
    const full = noteRelativePath(path, assetFragment(relative).file);
    if (full !== null) await revealProject(projectId, full);
  };

  const open = async (relative: string) => {
    const full = noteRelativePath(path, assetFragment(relative).file);
    if (full === null || !openHere()) return reveal(relative);
    await useFilesStore.getState().openFile(full);
  };

  return {
    loadNote: async (id) => {
      if (id !== key) return others().loadNote(id);
      const file = held();
      return source(file ? file.content : await readDisk());
    },
    saveNote: (id, text, version, base) =>
      id === key ? recordNoteWrite(key, text, () => save(text, version, base)) : others().saveNote(id, text, version, base),
    watchNote: (id, onChange) => (id === key ? watch(onChange) : (others().watchNote?.(id, onChange) ?? noWatch)),
    noteTextChanged: (id, text) => {
      if (id === key) mirror(text);
      else others().noteTextChanged?.(id, text);
    },
    resolveAsset: (id, relative) =>
      id === key ? resolve(relative) : (others().resolveAsset?.(id, relative) ?? Promise.resolve(null)),
    openAsset: async (id, relative) => {
      if (id === key) await open(relative);
      else await others().openAsset?.(id, relative);
    },
    revealAsset: async (id, relative) => {
      if (id === key) await reveal(relative);
      else await others().revealAsset?.(id, relative);
    },
  };
}

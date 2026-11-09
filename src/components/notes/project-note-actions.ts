import type { FileEntry } from "@oleafly/backend-port";
import { setFrontMatterScalar } from "@/features/markdown-document-settings";
import { i18n, loadNamespace } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { flushOpenNotes, openNoteText } from "@/lib/open-note-editors";
import { numberedPath } from "@/lib/path-utils";
import {
  foldPath,
  isProjectNoteAssetPath,
  NOTE_FILE,
  noteFileFacts,
  noteFileStem,
  projectNoteFilePath,
  projectNoteKey,
  projectNotesFolder,
  renamedNotePath,
} from "@/lib/project-notes";
import {
  createNoteProject,
  listFiles,
  readFileBase64,
  readFileContent,
  recycleProject,
  writeProjectBytes,
} from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { askInApp } from "@/store/confirm-dialog";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore, type NoteTabLook } from "@/store/note-tabs";
import { describeSaveFailure, type SaveFailure } from "@/store/save-flush-error";
import { newNoteSource, readNoteFacts } from "./note-file";

const NOTE_ASSETS = "assets";

function untitled(): string {
  return i18n.t(($) => $.notes.document.untitled);
}

function lookOf(text: string): NoteTabLook {
  const facts = readNoteFacts(text);
  return { icon: facts.icon, color: facts.color };
}

class UnsavedNotesError extends Error {
  constructor(failures: readonly SaveFailure[]) {
    super(failures.map(describeSaveFailure).join(" "));
    this.name = "UnsavedNotesError";
  }
}

async function flushedNotes(): Promise<void> {
  const failures = await flushOpenNotes();
  if (failures.length > 0) throw new UnsavedNotesError(failures);
}

function reportFailure(scope: string, error: unknown, fallback: string, unsaved: string): void {
  notifyError(scope, error, error instanceof UnsavedNotesError ? `${unsaved} ${describeError(error)}` : fallback);
}

const running = new Set<string>();

async function once<T>(key: string, run: () => Promise<T | null>): Promise<T | null> {
  if (running.has(key)) return null;
  running.add(key);
  try {
    return await run();
  } finally {
    running.delete(key);
  }
}

export function openPersonalNoteTab(projectId: string, noteId: string, look?: NoteTabLook): void {
  useNoteTabsStore.getState().open(projectId, noteId, look);
}

export async function createProjectNoteFile(projectId: string, title: string): Promise<string | null> {
  await loadNamespace("notes");
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return null;
  const name = title.trim() || untitled();
  const path = projectNoteFilePath(name, files.tree.map((entry) => entry.path), untitled());
  try {
    await files.writeProjectFile(projectId, path, newNoteSource(name));
    await useFilesStore.getState().openFile(path);
    return path;
  } catch (error) {
    notifyError("create a project note", error, i18n.t(($) => $.notes.projectNotes.createFailed));
    return null;
  }
}

function assetFiles(entries: readonly FileEntry[], folder: string): string[] {
  return entries.filter((entry) => !entry.is_dir && entry.path.startsWith(`${folder}/`)).map((entry) => entry.path);
}

async function copyFiles(
  from: { projectId: string; paths: readonly string[]; prefix: string },
  to: { projectId: string; prefix: string; existing: ReadonlySet<string> },
): Promise<number> {
  let copied = 0;
  for (const path of from.paths) {
    const target = `${to.prefix}${path.slice(from.prefix.length)}`;
    if (to.existing.has(target)) continue;
    await writeProjectBytes(to.projectId, target, await readFileBase64(from.projectId, path));
    copied += 1;
  }
  return copied;
}

function originOf(asset: string, assetsDir: string): string {
  return `${assetsDir}/origins/${asset.slice(asset.lastIndexOf("/") + 1)}.json`;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function relinkAssets(text: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0) return text;
  const names = [...renames.keys()].sort((left, right) => right.length - left.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![\\w./-])(\\./)?(${names.join("|")})(?![\\w.-])`, "gu");
  return text.replace(pattern, (found, dot: string | undefined, name: string) => {
    const renamed = renames.get(name);
    return renamed === undefined ? found : `${dot ?? ""}${renamed}`;
  });
}

function usesAsset(text: string, relative: string): boolean {
  return text.includes(`${NOTE_ASSETS}/${relative}`);
}

async function moveAssets(
  noteId: string,
  text: string,
  target: { projectId: string; existing: ReadonlySet<string>; folder: string },
): Promise<Map<string, string>> {
  const { projectId, existing, folder } = target;
  const listed = assetFiles(await listFiles(noteId), NOTE_ASSETS).filter(
    (path) =>
      !path.startsWith(`${NOTE_ASSETS}/origins/`) && usesAsset(text, path.slice(NOTE_ASSETS.length + 1)),
  );
  const actual = new Map([...existing].map((path) => [foldPath(path), path]));
  const taken = new Set(actual.keys());
  const renames = new Map<string, string>();
  for (const asset of listed) {
    const bytes = await readFileBase64(noteId, asset);
    const wanted = `${folder}/${asset}`;
    const present = actual.get(foldPath(wanted));
    if (present !== undefined && (await readFileBase64(projectId, present)) === bytes) continue;
    const target = numberedPath(wanted, (path) => taken.has(foldPath(path)));
    taken.add(foldPath(target));
    await writeProjectBytes(projectId, target, bytes);
    if (target !== wanted) renames.set(asset, target.slice(folder.length + 1));
  }
  return renames;
}

export async function moveNoteIntoProject(noteId: string, projectId: string): Promise<string | null> {
  await loadNamespace("notes");
  const files = useFilesStore.getState();
  const note = files.projects.find((project) => project.id === noteId);
  if (!note || files.projectId !== projectId) return null;
  const confirmed = await askInApp({
    title: i18n.t(($) => $.notes.projectNotes.moveTitle),
    message: i18n.t(($) => $.notes.projectNotes.moveMessage, { project: files.projectName }),
    confirmLabel: i18n.t(($) => $.notes.projectNotes.moveConfirm),
  });
  if (!confirmed) return null;
  const mainDoc = note.main_doc || NOTE_FILE;
  try {
    await flushedNotes();
    const text = await readFileContent(noteId, mainDoc);
    const title = readNoteFacts(text).title ?? note.name;
    const current = useFilesStore.getState();
    if (current.projectId !== projectId) return null;
    const existing = new Set(current.tree.map((entry) => entry.path));
    const path = projectNoteFilePath(title, existing, untitled());
    const renames = await moveAssets(noteId, text, { projectId, existing, folder: projectNotesFolder(existing) });
    await current.writeProjectFile(projectId, path, relinkAssets(text, renames));
    useNoteTabsStore.getState().close(noteId);
    await flushedNotes();
    const latest = await readFileContent(noteId, mainDoc);
    if (latest !== text) await useFilesStore.getState().writeProjectFile(projectId, path, relinkAssets(latest, renames));
    await recycleProject(noteId);
    await useFilesStore.getState().refreshProjects();
    await useFilesStore.getState().openFile(path);
    toast.success(i18n.t(($) => $.notes.projectNotes.moved, { title }));
    return path;
  } catch (error) {
    reportFailure(
      "move a note into the project",
      error,
      i18n.t(($) => $.notes.projectNotes.moveFailed),
      i18n.t(($) => $.notes.projectNotes.moveUnsaved),
    );
    return null;
  }
}

async function currentNoteText(projectId: string, path: string): Promise<string> {
  const open = openNoteText(projectNoteKey(projectId, path));
  if (open !== null) return open;
  return useFilesStore.getState().files[path]?.content ?? (await readFileContent(projectId, path));
}

function referencedAssets(text: string, tree: readonly FileEntry[], assetsDir: string): string[] {
  return tree
    .filter((entry) => !entry.is_dir && isProjectNoteAssetPath(entry.path) && entry.path.startsWith(`${assetsDir}/`))
    .map((entry) => entry.path)
    .filter((path) => {
      const relative = path.slice(assetsDir.length + 1);
      return !relative.startsWith("origins/") && usesAsset(text, relative);
    });
}

export function copyProjectNoteToMine(projectId: string, path: string): Promise<string | null> {
  return once(`copy\u0000${projectId}\u0000${path}`, () => copyNote(projectId, path));
}

async function copyNote(projectId: string, path: string): Promise<string | null> {
  await loadNamespace("notes");
  if (useFilesStore.getState().projectId !== projectId) return null;
  try {
    await flushedNotes();
    const files = useFilesStore.getState();
    if (files.projectId !== projectId) return null;
    const text = await currentNoteText(projectId, path);
    if (useFilesStore.getState().projectId !== projectId) return null;
    const title = noteFileFacts(text)?.title ?? noteFileStem(path);
    const source = setFrontMatterScalar(text, "id", crypto.randomUUID());
    const id = await createNoteProject(title, source, projectId);
    const folder = projectNotesFolder([path]);
    const assetsDir = `${folder}/${NOTE_ASSETS}`;
    const assets = referencedAssets(text, files.tree, assetsDir);
    const known = new Set(files.tree.map((entry) => entry.path));
    const origins = assets.map((asset) => originOf(asset, assetsDir)).filter((origin) => known.has(origin));
    await copyFiles(
      { projectId, paths: [...assets, ...origins], prefix: `${folder}/` },
      { projectId: id, prefix: "", existing: new Set() },
    );
    await useFilesStore.getState().refreshProjects();
    openPersonalNoteTab(projectId, id, lookOf(source));
    toast.success(i18n.t(($) => $.notes.projectNotes.copied, { title }));
    return id;
  } catch (error) {
    reportFailure(
      "copy a project note to my notes",
      error,
      i18n.t(($) => $.notes.projectNotes.copyFailed),
      i18n.t(($) => $.notes.projectNotes.copyUnsaved),
    );
    return null;
  }
}

export async function renameProjectNote(projectId: string, path: string, title: string): Promise<string | null> {
  await loadNamespace("notes");
  const name = title.trim();
  if (!name || useFilesStore.getState().projectId !== projectId) return null;
  try {
    await flushedNotes();
    const current = useFilesStore.getState();
    if (current.projectId !== projectId) return null;
    const text = await currentNoteText(projectId, path);
    if (useFilesStore.getState().projectId !== projectId) return null;
    if (noteFileFacts(text)?.title !== name) {
      await useFilesStore.getState().writeProjectFile(projectId, path, setFrontMatterScalar(text, "title", name), { base: text });
    }
    const others = useFilesStore
      .getState()
      .tree.map((entry) => entry.path)
      .filter((known) => known !== path);
    const target = renamedNotePath(path, name, others, untitled());
    return target === path ? path : await useFilesStore.getState().renameEntry(path, target);
  } catch (error) {
    reportFailure(
      "rename a project note",
      error,
      i18n.t(($) => $.notes.library.menu.renameFailed, { name }),
      i18n.t(($) => $.notes.projectNotes.renameUnsaved),
    );
    return null;
  }
}

import type { FileEntry } from "@oleafly/backend-port";
import { editBackgroundDocument, getEditorDocumentPath, getEditorView } from "@oleafly/editor";
import {
  applyTextEdits,
  type FileReferenceFileEdits,
  type FileReferencePlan,
  planReferenceUpdates,
  type ProjectFiles,
  referenceLanguageForPath,
} from "@oleafly/editor/file-references";
import { isVendoredTypstPackagePath } from "@oleafly/editor/typst-syntax";
import { logError } from "@/lib/log";
import { isReadOnlyProjectPath } from "@/lib/project-paths";
import { readFileContent } from "@/lib/tauri";
import { remapPlan, useFileReferencesStore } from "@/store/file-references";
import { type EntryRenamedEvent, onEntryRenamed, useFilesStore } from "@/store/files";
import { projectFolderIsReadOnly } from "@/store/folder-access";
import { readProjectSources, useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";

type FileOutcome = "buffer" | "disk" | "failed";

interface LoggedRename {
  readonly sequence: number;
  readonly projectId: string;
  readonly from: string;
  readonly to: string;
}

const RENAME_LOG_LIMIT = 50;
const renameLog: LoggedRename[] = [];
let renameSequence = 0;
let scans: Promise<void> = Promise.resolve();

export function projectFilesOf(tree: readonly FileEntry[], mainDoc: string): ProjectFiles {
  return {
    files: tree.filter((entry) => !entry.is_dir).map((entry) => entry.path),
    directories: tree.filter((entry) => entry.is_dir).map((entry) => entry.path),
    mainDoc,
  };
}

export function referenceSourcePaths(tree: readonly FileEntry[]): string[] {
  const { manifestHome } = useFilesStore.getState();
  return tree
    .filter((entry) => !entry.is_dir && !entry.unreadable && !entry.placeholder)
    .map((entry) => entry.path)
    .filter(
      (path) =>
        referenceLanguageForPath(path) !== null &&
        !isVendoredTypstPackagePath(path) &&
        !isReadOnlyProjectPath(path, manifestHome, tree),
    );
}

async function planForRename(event: EntryRenamedEvent): Promise<FileReferencePlan | null> {
  if (useFilesStore.getState().projectId !== event.projectId) return null;
  if (projectFolderIsReadOnly(event.projectId)) return null;
  const paths = referenceSourcePaths(event.tree);
  if (paths.length === 0) return null;
  const { texts } = await readProjectSources(event.projectId, paths);
  if (useFilesStore.getState().projectId !== event.projectId) return null;
  const plan = planReferenceUpdates({
    move: { from: event.from, to: event.to },
    before: projectFilesOf(event.previousTree, event.previousMainDoc),
    after: projectFilesOf(event.tree, event.mainDoc),
    sources: paths.flatMap((path) => (texts[path] === undefined ? [] : [{ path, text: texts[path] }])),
  });
  return plan.references > 0 ? plan : null;
}

function followLaterRenames(plan: FileReferencePlan, projectId: string, sequence: number): FileReferencePlan {
  return renameLog
    .filter((entry) => entry.sequence > sequence && entry.projectId === projectId)
    .reduce((current, entry) => remapPlan(current, entry.from, entry.to), plan);
}

function logRename(event: EntryRenamedEvent): number {
  renameSequence += 1;
  renameLog.push({ sequence: renameSequence, projectId: event.projectId, from: event.from, to: event.to });
  if (renameLog.length > RENAME_LOG_LIMIT) renameLog.shift();
  return renameSequence;
}

async function scanRename(event: EntryRenamedEvent, sequence: number): Promise<void> {
  const plan = await planForRename(event);
  if (!plan || useFilesStore.getState().projectId !== event.projectId) return;
  const mode = useSettingsStore.getState().fileMoveReferences;
  if (mode === "never") return;
  const current = followLaterRenames(plan, event.projectId, sequence);
  if (mode === "always") {
    const failed = await applyReferencePlan(event.projectId, current);
    if (failed.length > 0) void logError("update file references", `not updated: ${failed.join(", ")}`);
    return;
  }
  useFileReferencesStore.getState().enqueue({
    projectId: event.projectId,
    from: event.from,
    to: event.to,
    plan: current,
  });
}

export function followRename(event: EntryRenamedEvent): Promise<void> {
  const sequence = logRename(event);
  useFileReferencesStore.getState().remap(event.projectId, event.from, event.to);
  if (useSettingsStore.getState().fileMoveReferences === "never") return Promise.resolve();
  const run = scans
    .then(() => scanRename(event, sequence))
    .catch((error: unknown) => {
      void logError("update file references", error);
    });
  scans = run;
  return run;
}

export function startFileReferenceUpdates(): () => void {
  const stopRenames = onEntryRenamed((event) => {
    void followRename(event);
  });
  const stopProjects = useFilesStore.subscribe((state, previous) => {
    if (state.projectId !== previous.projectId) useFileReferencesStore.getState().clear();
  });
  return () => {
    stopRenames();
    stopProjects();
  };
}

function ascendingChanges(file: FileReferenceFileEdits) {
  return [...file.edits]
    .sort((left, right) => left.from - right.from)
    .map((edit) => ({ from: edit.from, to: edit.to, insert: edit.insert }));
}

function editOpenBuffer(file: FileReferenceFileEdits, next: string): boolean {
  const files = useFilesStore.getState();
  const changes = ascendingChanges(file);
  const active = file.path === files.activePath;
  const view = getEditorView();
  if (active && view && getEditorDocumentPath() === file.path && view.state.doc.toString() === file.text) {
    view.dispatch({ changes });
    return true;
  }
  if (!files.setContent(file.path, next, { bumpVersion: active })) return false;
  if (!active) editBackgroundDocument(file.path, file.text, changes);
  return true;
}

async function applyFileEdits(projectId: string, file: FileReferenceFileEdits): Promise<FileOutcome> {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return "failed";
  if (isReadOnlyProjectPath(file.path, files.manifestHome, files.tree)) return "failed";
  const next = applyTextEdits(file.text, file.edits);
  const open = files.files[file.path];
  if (open !== undefined) {
    if (open.content !== file.text) return "failed";
    return editOpenBuffer(file, next) ? "buffer" : "failed";
  }
  try {
    const raw = await readFileContent(projectId, file.path);
    if (raw.replace(/\r\n?/g, "\n") !== file.text) return "failed";
    const latest = useFilesStore.getState();
    if (latest.projectId !== projectId || latest.files[file.path] !== undefined) return "failed";
    await latest.writeProjectFile(projectId, file.path, next, { crlf: raw.includes("\r\n") });
    return "disk";
  } catch (error) {
    void logError("update file references", error);
    return "failed";
  }
}

async function applyEachFileEdits(
  projectId: string,
  files: readonly FileReferenceFileEdits[],
  outcomes: FileOutcome[] = [],
): Promise<FileOutcome[]> {
  const file = files[outcomes.length];
  if (file === undefined) return outcomes;
  outcomes.push(await applyFileEdits(projectId, file));
  return applyEachFileEdits(projectId, files, outcomes);
}

export async function applyReferencePlan(projectId: string, plan: FileReferencePlan): Promise<string[]> {
  const outcomes = await applyEachFileEdits(projectId, plan.files);
  const failed = plan.files.filter((_file, index) => outcomes[index] === "failed").map((file) => file.path);
  const wroteDisk = outcomes.includes("disk");
  if (wroteDisk && useFilesStore.getState().projectId === projectId) {
    void useIndexStore.getState().rebuildFromDisk();
  }
  return failed;
}

export async function answerReferenceUpdate(update: boolean, remember: boolean): Promise<void> {
  const store = useFileReferencesStore.getState();
  const pending = store.queue[0];
  if (!pending || store.phase !== "ask") return;
  if (remember) useSettingsStore.getState().setFileMoveReferences(update ? "always" : "never");
  if (!update) {
    store.finish();
    return;
  }
  store.startApplying();
  const failed = await applyReferencePlan(pending.projectId, pending.plan);
  if (failed.length > 0) useFileReferencesStore.getState().fail(failed);
  else useFileReferencesStore.getState().finish();
}

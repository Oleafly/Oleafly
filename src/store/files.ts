import { create, type StoreApi } from "zustand";
import {
  createFile as apiCreateFile,
  copyFile as apiCopyFile,
  createProject as apiCreateProject,
  createTypstProject as apiCreateTypstProject,
  createMarkdownProject as apiCreateMarkdownProject,
  createProjectFromTemplate as apiCreateFromTemplate,
  deleteFile as apiDeleteFile,
  gitLog,
  gitDiscard,
  gitPull,
  gitRestore,
  getProject,
  getProjectEngine,
  importOverleafProjectCmd,
  importPathsIntoProject as apiImportPathsIntoProject,
  listFiles,
  listProjects,
  readFileContent,
  renameFile as apiRenameFile,
  projectMutationGeneration,
  projectTexStatus,
  recordProjectTexSpec,
  renameProjectCmd,
  setMainDocCmd,
  setProjectEngineCmd,
  setProjectShellEscapeCmd,
  tlmgrInstall,
  writeFileContent,
  type FileConflictStrategy,
  type FileEntry,
  type ProjectInfo,
  type ProjectMeta,
  type ProjectStateChanged,
  type DocumentEngineDescriptor,
  type TexFlavor,
  mcpSetActiveProject,
} from "@/lib/tauri";
import { UNKNOWN_ENGINE } from "@/lib/document-engine";
import { flushAutoCommit, scheduleAutoCommit } from "@/lib/auto-commit";
import { logError } from "@/lib/log";
import { notifyError, toast } from "@/lib/toast";
import { scanImportCompatibility } from "@oleafly/latex";
import { cancelProofreading } from "@/lib/proofreading/client";
import { useDiffStore } from "@/store/diff";
import {
  dismissEngineHint,
  engineHintDismissed,
  useEnginePickerStore,
} from "@/store/engine-picker";
import { useSettingsStore } from "@/store/settings";
import { nextTabSeq } from "@/store/tab-order";
import { recordProjectStateRevision } from "@/lib/project-state-revision";

// Pin the user's global default engine onto a freshly created project. Only
// LaTeX projects can take the latexmk pin; anything else (Typst templates,
// Markdown) rejects it in validation and simply keeps its own engine.
async function applyDefaultLatexEngine(projectId: string): Promise<void> {
  if (useSettingsStore.getState().defaultLatexEngine !== "latexmk") return;
  try {
    await setProjectEngineCmd(projectId, "latexmk");
    void recordProjectTexSpec(projectId).catch(() => {});
  } catch {
    /* non-LaTeX project or validation refusal — keep the project's engine */
  }
}

// Compare this machine against a latexmk project's TeX pin. Missing pinned
// packages get an actionable toast; a differing distribution gets a one-time
// heads-up. Both remember what was shown so reopening a project stays quiet.
async function checkTexPinStatus(
  projectId: string,
  stillCurrent: () => boolean,
): Promise<void> {
  const status = await projectTexStatus(projectId).catch(() => null);
  if (!status || !stillCurrent()) return;
  const remember = (key: string, value: string): boolean => {
    try {
      if (localStorage.getItem(key) === value) return false;
      localStorage.setItem(key, value);
      return true;
    } catch {
      return true;
    }
  };
  const missing = status.missing_packages;
  // A handful of missing packages gets a one-click install. A huge gap means
  // the project was pinned on a much larger distribution (for example a full
  // TeX Live against TinyTeX), where installing thousands of packages one by
  // one is the wrong tool. Point at the distribution mismatch instead.
  const MAX_ONE_CLICK_INSTALL = 25;
  if (
    missing.length > MAX_ONE_CLICK_INSTALL &&
    status.pinned_label &&
    status.local_label
  ) {
    const fresh = remember(
      `oleafly.texGap.${projectId}`,
      `bulk|${status.pinned_label}|${status.local_label}|${missing.length}`,
    );
    if (!fresh) return;
    toast.info(
      `This project was pinned with ${status.pinned_label}. The active ${status.local_label} is missing ${missing.length} of its packages, so compiles may fail until that distribution is used again.`,
    );
    return;
  }
  if (missing.length > 0 && status.can_install_missing) {
    const fresh = remember(`oleafly.texGap.${projectId}`, [...missing].sort().join(","));
    if (!fresh) return;
    toast.info(
      `This project pins ${missing.length} LaTeX package${missing.length === 1 ? "" : "s"} that ${missing.length === 1 ? "is" : "are"} not installed here.`,
      {
        label: missing.length === 1 ? "Install it" : `Install all ${missing.length}`,
        onClick: () => {
          void (async () => {
            toast.info(`Installing ${missing.length} pinned package${missing.length === 1 ? "" : "s"}…`);
            try {
              await tlmgrInstall(missing);
              toast.success("Pinned LaTeX packages installed.");
            } catch (error) {
              notifyError(
                "install pinned packages",
                error,
                "Some pinned packages could not be installed. See Settings → LaTeX Engine.",
              );
            }
          })();
        },
      },
      true,
    );
  } else if (status.distribution_differs && status.local_label) {
    const fresh = remember(
      `oleafly.texSkew.${projectId}`,
      `${status.pinned_label}|${status.local_label}`,
    );
    if (!fresh) return;
    toast.info(
      `This project was pinned with ${status.pinned_label} and this machine compiles with ${status.local_label}. Output may differ slightly.`,
    );
  }
}

interface FileState {
  content: string;
  dirty: boolean;
}

interface FilesStore {
  projectId: string | null;
  projectName: string;
  // Project kind: "" for a normal document project, "image" for a single-figure
  // project (hides doc-only tools like Insert diagram).
  projectKind: string;
  mainDoc: string;
  engine: DocumentEngineDescriptor;
  engineLoaded: boolean;
  engineError: string | null;
  tree: FileEntry[];
  files: Record<string, FileState>;
  openTabs: string[];
  // Open-order stamp per file tab, shared with diff tabs so the editor renders
  // files and diffs interleaved by the order they were opened.
  tabOrder: Record<string, number>;
  activePath: string | null;
  projects: ProjectInfo[];
  projectsLoaded: boolean;
  loading: boolean;
  docVersion: number;

  refreshProjects: () => Promise<void>;
  openProject: (id: string, shouldContinue?: () => boolean) => Promise<void>;
  closeProject: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  importProject: (path: string) => Promise<string>;
  createTypstProject: (name: string) => Promise<void>;
  createMarkdownProject: (name: string) => Promise<void>;
  renameProject: (name: string) => Promise<void>;
  createFromTemplate: (name: string, templateId: string, color?: string) => Promise<string>;
  restoreFromGit: (oid: string) => Promise<void>;
  pullFromGit: () => Promise<string>;
  discardFromGit: (path: string) => Promise<void>;

  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  setActive: (path: string) => void;
  closeTab: (path: string) => void;
  setContent: (path: string, content: string, opts?: { bumpVersion?: boolean }) => void;
  bumpDocVersion: () => void;
  saveActive: () => Promise<void>;
  saveFile: (path: string) => Promise<void>;
  createFile: (path: string, isDir: boolean) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  renameEntry: (from: string, to: string, conflictStrategy?: FileConflictStrategy) => Promise<string>;
  copyEntry: (path: string, isDir?: boolean) => Promise<void>;
  importPaths: (destDir: string, sourcePaths: string[]) => Promise<void>;
  prepareExternalMutation: (projectId: string) => Promise<number>;
  recordMutationGeneration: (projectId: string, generation: number) => void;
  applyExternalWrite: (projectId: string, path: string, content: string) => boolean;
  applyExternalDelete: (projectId: string, path: string) => boolean;
  applyExternalRename: (projectId: string, from: string, to: string) => boolean;
  applyProjectStateChanged: (event: ProjectStateChanged) => Promise<boolean>;
  setMainDoc: (path: string) => Promise<void>;
  setEngine: (engine: string, flavor?: TexFlavor | null) => Promise<void>;
  setShellEscape: (allow: boolean) => Promise<void>;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
// Every path edited since the last flush. The single debounce timer saves the
// whole set, so editing file A then switching to B before the timer fires no
// longer drops A's changes.
const pendingSaves = new Set<string>();
// Writes to the same project path must land in edit order. Without this queue,
// a slow autosave can finish after a newer transition flush and put stale
// content back on disk.
const pendingWrites = new Map<string, Promise<number>>();
let knownMutationProjectId: string | null = null;
let knownMutationGeneration: number | null = null;
let lastProjectStateRevision = 0;
let fileReloadRevision = 0;
// Project opens and closes are state transactions. Serializing them keeps a
// double click or a close during an open from interleaving two project states.
let projectTransition: Promise<void> = Promise.resolve();
// Bumped on every openProject so an in-flight load from a previous project can
// detect it is stale and stop writing into the newly opened project's state.
let openSeq = 0;
let mainDocSeq = 0;
let projectsInFlight: Promise<ProjectInfo[]> | null = null;
let fileOpenSeq = 0;
let fileOpenEpoch = 0;
const pendingFileOpens = new Map<string, number>();

function fileOpenKey(projectId: string, path: string) {
  return `${projectId}\0${path}`;
}

function invalidatePendingFileOpen(projectId: string | null, path: string) {
  if (!projectId) return;
  pendingFileOpens.delete(fileOpenKey(projectId, path));
}

function invalidateAllPendingFileOpens() {
  fileOpenEpoch++;
  pendingFileOpens.clear();
}

function stopAutosaveTimer() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

function cancelPendingAutosave() {
  stopAutosaveTimer();
  pendingSaves.clear();
}

function writeKey(projectId: string, path: string) {
  return `${projectId}\0${path}`;
}

function resetMutationGeneration(projectId: string | null = null) {
  knownMutationProjectId = projectId;
  knownMutationGeneration = null;
}

function rememberMutationGeneration(projectId: string, generation: number): number {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("The backend returned an invalid project mutation generation.");
  }
  if (knownMutationProjectId !== projectId) {
    knownMutationProjectId = projectId;
    knownMutationGeneration = generation;
  } else {
    knownMutationGeneration = Math.max(knownMutationGeneration ?? 0, generation);
  }
  return knownMutationGeneration;
}

async function refreshMutationGeneration(projectId: string): Promise<number> {
  const generation = await projectMutationGeneration(projectId);
  return rememberMutationGeneration(projectId, generation);
}

function enqueueWrite(projectId: string, path: string, content: string): Promise<void> {
  const key = writeKey(projectId, path);
  const baseline =
    knownMutationProjectId === projectId && knownMutationGeneration !== null
      ? Promise.resolve(knownMutationGeneration)
      : refreshMutationGeneration(projectId);
  const previous = pendingWrites.get(key);
  const expected = previous ?? baseline;
  let tracked: Promise<number>;
  tracked = expected
    .then(async (expectedGeneration) => {
      const result = await writeFileContent(projectId, path, content, expectedGeneration);
      return rememberMutationGeneration(
        projectId,
        Number.isSafeInteger(result?.generation) ? result.generation : expectedGeneration,
      );
    })
    .catch(async (error) => {
      await refreshMutationGeneration(projectId).catch(() => {});
      throw error;
    })
    .finally(() => {
      if (pendingWrites.get(key) === tracked) pendingWrites.delete(key);
    });
  pendingWrites.set(key, tracked);
  return tracked.then(() => {});
}

async function drainProjectWrites(projectId: string): Promise<void> {
  // Take repeated snapshots because completing one queued write can expose the
  // next write for the same path. A restore must begin only after none of the
  // old revision's writes can still land on top of it.
  for (;;) {
    const prefix = `${projectId}\0`;
    const writes = [...pendingWrites.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, write]) => write);
    if (writes.length === 0) return;
    await Promise.allSettled(writes);
  }
}

function scheduleAutosave(get: () => FilesStore) {
  stopAutosaveTimer();
  if (pendingSaves.size === 0) return;
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    const paths = [...pendingSaves];
    for (const path of paths) pendingSaves.delete(path);
    for (const path of paths) {
      get()
        .saveFile(path)
        .catch((error) => notifyError("autosave", error));
    }
  }, 1500);
}

async function flushDirtyBuffers(projectId: string, get: () => FilesStore): Promise<void> {
  stopAutosaveTimer();

  // A save can finish while the user is still editing. Loop until the current
  // project has no dirty snapshots left, then the caller may safely reset it.
  for (;;) {
    const state = get();
    if (state.projectId !== projectId) {
      throw new Error("Project changed while its files were being saved.");
    }
    const paths = Object.entries(state.files)
      .filter(([, file]) => file.dirty)
      .map(([path]) => path);
    if (paths.length === 0) {
      for (const path of [...pendingSaves]) {
        if (!state.files[path]?.dirty) pendingSaves.delete(path);
      }
      return;
    }

    for (const path of paths) pendingSaves.delete(path);
    const results = await Promise.allSettled(paths.map((path) => get().saveFile(path)));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      const current = get();
      if (current.projectId === projectId) {
        for (const [path, file] of Object.entries(current.files)) {
          if (file.dirty) pendingSaves.add(path);
        }
      }
      throw failure.reason;
    }
  }
}

function assertNoUnsavedBuffers(
  get: () => FilesStore,
  isDeletedPath: (candidate: string) => boolean,
): void {
  const unsaved = Object.entries(get().files)
    .filter(([candidate, file]) => isDeletedPath(candidate) && file.dirty)
    .map(([candidate]) => candidate);
  if (unsaved.length > 0) {
    throw new Error(
      `Save or close the unsaved file${unsaved.length === 1 ? "" : "s"} before deleting: ${unsaved.join(", ")}`,
    );
  }
}

// A queued autosave must not recreate a file after the backend removes it.
// Let already-running writes settle, discard queued snapshots for the
// deleted subtree, and then perform the delete.
function discardQueuedSavesUnder(
  projectId: string,
  isDeletedPath: (candidate: string) => boolean,
): { discardedPending: Set<string>; writes: Promise<number>[] } {
  stopAutosaveTimer();
  const discardedPending = new Set<string>();
  for (const pendingPath of [...pendingSaves]) {
    if (isDeletedPath(pendingPath)) {
      pendingSaves.delete(pendingPath);
      discardedPending.add(pendingPath);
    }
  }
  const writes = [...pendingWrites.entries()]
    .filter(([key]) => isDeletedPath(key.slice(projectId.length + 1)))
    .map(([, write]) => write);
  return { discardedPending, writes };
}

function pruneDeletedPaths(s: FilesStore, isDeletedPath: (candidate: string) => boolean) {
  const files = Object.fromEntries(
    Object.entries(s.files).filter(([candidate]) => !isDeletedPath(candidate)),
  );
  const tabOrder = Object.fromEntries(
    Object.entries(s.tabOrder).filter(([candidate]) => !isDeletedPath(candidate)),
  );
  const openTabs = s.openTabs.filter((candidate) => !isDeletedPath(candidate));
  const deletedActive = !!s.activePath && isDeletedPath(s.activePath);
  return {
    files,
    tabOrder,
    openTabs,
    activePath: deletedActive ? (openTabs.at(-1) ?? null) : s.activePath,
  };
}

function restoreDiscardedSaves(
  get: () => FilesStore,
  projectId: string,
  discardedPending: Set<string>,
): void {
  const current = get();
  if (current.projectId !== projectId) return;
  for (const pendingPath of discardedPending) {
    if (current.files[pendingPath]?.dirty) pendingSaves.add(pendingPath);
  }
}

async function reopenMainDocAfterDelete(
  get: () => FilesStore,
  projectId: string,
  isDeletedPath: (candidate: string) => boolean,
): Promise<void> {
  const current = get();
  if (
    current.projectId === projectId &&
    !current.activePath &&
    !isDeletedPath(current.mainDoc)
  ) {
    await current.openFile(current.mainDoc);
  }
}

// Only split off an extension for files; a folder name is copied whole (so
// "v1.0" doesn't become "v1 copy.0").
function copyDestinationFor(path: string, isDir: boolean): string {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = isDir ? -1 : file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  return dir ? `${dir}/${base} copy${ext}` : `${base} copy${ext}`;
}

function enqueueProjectTransition<T>(operation: () => Promise<T>): Promise<T> {
  const queued = projectTransition.catch(() => {}).then(operation);
  projectTransition = queued.then(
    () => {},
    () => {},
  );
  return queued;
}

async function scanOpenProjectCompatibility(
  id: string,
  meta: ProjectMeta,
  tree: FileEntry[],
  seq: number,
  get: () => FilesStore,
): Promise<void> {
  try {
    if (get().engine.id === "latexmk") {
      await checkTexPinStatus(id, () => seq === openSeq && get().projectId === id);
      return;
    }
    const { texFiles, latexmkrc } = await loadCompatibilityInputs(id, meta, tree, seq, get);
    if (seq !== openSeq) return;
    const findings = scanImportCompatibility({ texFiles, latexmkrc });
    showCompatibilityFindings(id, findings, get);
  } catch (error) {
    void logError("scan project compatibility", error);
  }
}

async function loadCompatibilityInputs(
  id: string,
  meta: ProjectMeta,
  tree: FileEntry[],
  seq: number,
  get: () => FilesStore,
) {
  const mainPath = meta.main_doc || "main.tex";
  const depth = (path: string) => path.split("/").length;
  const texPaths = tree
    .filter((entry) => !entry.is_dir && isTexSourcePath(entry.path))
    .map((entry) => entry.path)
    .sort((left, right) =>
      left === mainPath ? -1 : right === mainPath ? 1 : depth(left) - depth(right),
    )
    .slice(0, 40);
  const texFiles: Array<{ path: string; content: string }> = [];
  for (const path of texPaths) {
    const content =
      get().files[path]?.content ?? (await readCompatibilityInput(id, path)) ?? "";
    if (seq !== openSeq) break;
    if (content) texFiles.push({ path, content });
  }
  const rcName = ["latexmkrc", ".latexmkrc"].find((name) =>
    tree.some((entry) => !entry.is_dir && entry.path === name),
  );
  const latexmkrc = rcName ? await readCompatibilityInput(id, rcName) : null;
  return { texFiles, latexmkrc };
}

async function readCompatibilityInput(id: string, path: string): Promise<string | null> {
  try {
    return await readFileContent(id, path);
  } catch (error) {
    void logError("scan project compatibility", error);
    return null;
  }
}

function isTexSourcePath(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return extension === "tex" || extension === "ltx" || extension === "latex";
}

function showCompatibilityFindings(
  id: string,
  findings: ReturnType<typeof scanImportCompatibility>,
  get: () => FilesStore,
): void {
  if (findings.length === 0 || get().engine.id === "latexmk" || engineHintDismissed(id, findings)) {
    return;
  }
  const blockers = findings.filter((finding) => finding.level === "blocker");
  if (blockers.length > 0) {
    const extra = blockers.length > 1 ? ` (+${blockers.length - 1} more)` : "";
    toast.info(
      `${blockers[0].title}${extra}`,
      {
        label: "Choose engine…",
        onClick: () => useEnginePickerStore.getState().openPicker("project-open", findings),
      },
      true,
    );
    return;
  }
  showCompatibilityWarnings(id, findings.filter((finding) => finding.level === "warning"));
}

function showCompatibilityWarnings(
  id: string,
  warnings: ReturnType<typeof scanImportCompatibility>,
): void {
  if (warnings.length === 0) return;
  if (warnings.length === 1 && warnings[0].id === "biblatex-biber") {
    toast.info("This project uses biblatex/Biber for the bibliography.");
  } else {
    const plural = warnings.length === 1 ? "" : "s";
    const extra = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : "";
    toast.info(`${warnings.length} import note${plural}: ${warnings[0].title}${extra}`);
  }
  dismissEngineHint(id, warnings);
}

type FilesSet = StoreApi<FilesStore>["setState"];
type FilesGet = StoreApi<FilesStore>["getState"];

async function prepareProjectSwitch(
  shouldContinue: () => boolean,
  set: FilesSet,
  get: FilesGet,
): Promise<{ previousProjectId: string | null } | null> {
  if (!shouldContinue()) return null;
  const previousProjectId = get().projectId;
  if (previousProjectId) {
    set({ loading: true });
    try {
      await flushDirtyBuffers(previousProjectId, get);
    } catch (error) {
      set({ loading: false });
      notifyError(
        "save before switching projects",
        error,
        "The project stayed open because one or more files could not be saved.",
      );
      return null;
    }
    flushAutoCommit();
  }
  if (!shouldContinue()) {
    set({ loading: false });
    return null;
  }
  await mcpSetActiveProject(null).catch(() => {});
  if (shouldContinue()) return { previousProjectId };
  await mcpSetActiveProject(previousProjectId).catch(() => {});
  set({ loading: false });
  return null;
}

function beginProjectOpen(id: string, shouldContinue: () => boolean, set: FilesSet, get: FilesGet) {
  const seq = ++openSeq;
  invalidateAllPendingFileOpens();
  mainDocSeq++;
  cancelPendingAutosave();
  cancelProofreading("source");
  cancelProofreading("visual");
  resetMutationGeneration(id);
  set({ ...EMPTY_PROJECT_STATE, loading: true, projectId: id });
  const revision = lastProjectStateRevision;
  let reopenQueued = false;
  const superseded = () => {
    if (seq !== openSeq) return true;
    if (lastProjectStateRevision === revision) return false;
    if (!reopenQueued) {
      reopenQueued = true;
      void get().openProject(id, shouldContinue);
    }
    return true;
  };
  return { seq, superseded };
}

async function loadOpenedProject(
  id: string,
  seq: number,
  superseded: () => boolean,
  set: FilesSet,
  get: FilesGet,
): Promise<void> {
  const [meta, generation] = await Promise.all([getProject(id), projectMutationGeneration(id)]);
  if (superseded()) return;
  rememberMutationGeneration(id, generation);
  await mcpSetActiveProject(id).catch(() => {});
  if (superseded()) return;
  const tree = await listFiles(id);
  if (superseded()) return;
  set({ projectName: meta.name, projectKind: meta.kind ?? "", mainDoc: meta.main_doc, tree });
  await loadOpenedProjectEngine(id, superseded, set);
  if (superseded()) return;
  await preloadBibliographies(id, tree, superseded, set);
  await get().openFile(meta.main_doc || "main.tex");
  if (superseded()) return;
  if (seq === openSeq) void scanOpenProjectCompatibility(id, meta, tree, seq, get);
}

async function loadOpenedProjectEngine(
  id: string,
  superseded: () => boolean,
  set: FilesSet,
): Promise<void> {
  try {
    const engine = await getProjectEngine(id);
    if (!superseded()) set({ engine, engineLoaded: true, engineError: null });
  } catch (error) {
    if (superseded()) return;
    const message = "Document engine details could not be loaded. Engine-specific actions are disabled.";
    set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: message });
    notifyError("load document engine", error, message);
  }
}

async function preloadBibliographies(
  id: string,
  tree: FileEntry[],
  superseded: () => boolean,
  set: FilesSet,
): Promise<void> {
  const bibliographies = tree.filter((entry) => !entry.is_dir && entry.path.endsWith(".bib"));
  for (const bibliography of bibliographies) {
    try {
      const content = await readFileContent(id, bibliography.path);
      if (superseded()) return;
      set((state) => ({
        files: { ...state.files, [bibliography.path]: { content, dirty: false } },
      }));
    } catch (error) {
      void logError("preload bibliography", error);
    }
  }
}

async function openProjectTransition(
  id: string,
  shouldContinue: () => boolean,
  set: FilesSet,
  get: FilesGet,
): Promise<void> {
  const prepared = await prepareProjectSwitch(shouldContinue, set, get);
  if (!prepared) return;
  const { seq, superseded } = beginProjectOpen(id, shouldContinue, set, get);
  try {
    await loadOpenedProject(id, seq, superseded, set, get);
  } catch (error) {
    if (seq === openSeq) {
      await mcpSetActiveProject(null).catch(() => {});
      resetMutationGeneration();
      set(EMPTY_PROJECT_STATE);
      notifyError("open project", error, "Could not open the project. See the app log for details.");
    }
  } finally {
    if (seq === openSeq) set({ loading: false });
  }
}

type ProjectMetadataState = Pick<
  FilesStore,
  "projectName" | "projectKind" | "mainDoc" | "engine" | "engineLoaded" | "engineError"
>;

interface ReloadedProjectFiles {
  loaded: Map<string, string>;
  attempted: Set<string>;
}

const BINARY_RELOAD_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "eps",
  "zip",
  "gz",
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

function projectMetadataState(event: ProjectStateChanged): ProjectMetadataState {
  return {
    projectName: event.project.name,
    projectKind: event.project.kind ?? "",
    mainDoc: event.project.main_doc,
    engine: event.engine,
    engineLoaded: true,
    engineError: null,
  };
}

function projectStateEventIsValid(event: ProjectStateChanged, get: FilesGet): boolean {
  if (get().projectId !== event.projectId) return false;
  if (!Number.isSafeInteger(event.revision) || event.revision <= lastProjectStateRevision) {
    return false;
  }
  return (
    event.mutationGeneration === null ||
    (Number.isSafeInteger(event.mutationGeneration) && event.mutationGeneration >= 0)
  );
}

function admitProjectStateEvent(event: ProjectStateChanged): number {
  const revision = event.revision;
  lastProjectStateRevision = revision;
  recordProjectStateRevision(revision);
  mainDocSeq++;
  invalidateAllPendingFileOpens();
  if (event.mutationGeneration !== null) {
    rememberMutationGeneration(event.projectId, event.mutationGeneration);
  }
  void import("@/store/compile").then(({ useCompileStore }) => {
    if (lastProjectStateRevision === revision) useCompileStore.getState().reset();
  });
  return revision;
}

function projectRevisionIsCurrent(projectId: string, revision: number, get: FilesGet): boolean {
  return get().projectId === projectId && lastProjectStateRevision === revision;
}

function isBinaryReloadPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && BINARY_RELOAD_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

async function loadChangedProjectFiles(
  projectId: string,
  captured: Record<string, FileState>,
  filePaths: Set<string>,
): Promise<ReloadedProjectFiles> {
  const loaded = new Map<string, string>();
  const attempted = new Set<string>();
  await Promise.all(
    Object.entries(captured).map(async ([path, file]) => {
      if (file.dirty || !filePaths.has(path) || isBinaryReloadPath(path)) return;
      attempted.add(path);
      const content = await readFileContent(projectId, path).catch(() => null);
      if (content !== null) loaded.set(path, content);
    }),
  );
  return { loaded, attempted };
}

function reconcileProjectFile(
  path: string,
  current: FileState,
  captured: Record<string, FileState>,
  filePaths: Set<string>,
  reloaded: ReloadedProjectFiles,
  removedDirty: string[],
): FileState | undefined {
  if (!filePaths.has(path)) {
    if (current.dirty) removedDirty.push(path);
    return current.dirty ? current : undefined;
  }
  const previous = captured[path];
  if (!previous || current.dirty || current.content !== previous.content) return current;
  const content = reloaded.loaded.get(path);
  if (content !== undefined) return { content, dirty: false };
  return reloaded.attempted.has(path) ? undefined : current;
}

function reconciledProjectState(
  state: FilesStore,
  metadata: ProjectMetadataState,
  tree: FileEntry[],
  captured: Record<string, FileState>,
  reloaded: ReloadedProjectFiles,
  removedDirty: string[],
): Partial<FilesStore> {
  const filePaths = new Set(tree.filter((entry) => !entry.is_dir).map((entry) => entry.path));
  const files: Record<string, FileState> = {};
  for (const [path, current] of Object.entries(state.files)) {
    const file = reconcileProjectFile(
      path,
      current,
      captured,
      filePaths,
      reloaded,
      removedDirty,
    );
    if (file) files[path] = file;
  }
  const retained = (path: string) => filePaths.has(path) || files[path]?.dirty;
  const openTabs = state.openTabs.filter(retained);
  return {
    ...metadata,
    tree,
    files,
    openTabs,
    tabOrder: Object.fromEntries(Object.entries(state.tabOrder).filter(([path]) => retained(path))),
    activePath:
      state.activePath && retained(state.activePath) ? state.activePath : (openTabs.at(-1) ?? null),
    docVersion: state.docVersion + 1,
  };
}

function restoreRemovedDirtyFiles(paths: string[], get: FilesGet): void {
  if (paths.length === 0) return;
  toast.info(
    "A project update removed files with unsaved edits. Oleafly kept your edits and is restoring those files.",
  );
  for (const path of paths) {
    pendingSaves.add(path);
    void get()
      .saveFile(path)
      .then(() => get().refreshTree())
      .catch(() => scheduleAutosave(get));
  }
}

const EMPTY_PROJECT_STATE = {
  projectId: null,
  projectName: "",
  projectKind: "",
  mainDoc: "main.tex",
  engine: UNKNOWN_ENGINE,
  engineLoaded: false,
  engineError: null,
  tree: [],
  files: {},
  openTabs: [],
  tabOrder: {},
  activePath: null,
  loading: false,
} satisfies Partial<FilesStore>;

export const useFilesStore = create<FilesStore>((set, get) => ({
  projectId: null,
  projectName: "",
  projectKind: "",
  mainDoc: "main.tex",
  engine: UNKNOWN_ENGINE,
  engineLoaded: false,
  engineError: null,
  tree: [],
  files: {},
  openTabs: [],
  tabOrder: {},
  activePath: null,
  projects: [],
  projectsLoaded: false,
  loading: false,
  docVersion: 0,

  refreshProjects: async () => {
    // Single-flight: the app shell and the library both ask for the list on
    // boot. Share one in-flight IPC instead of dropping a caller, so
    // returning to the library still refetches (external edits, new dates).
    projectsInFlight ??= listProjects().finally(() => {
      projectsInFlight = null;
    });
    const projects = [...(await projectsInFlight)];
    projects.sort((a, b) => b.updated_at - a.updated_at);
    set({ projects, projectsLoaded: true });
  },

  openProject: (id, shouldContinue = () => true) =>
    enqueueProjectTransition(() => openProjectTransition(id, shouldContinue, set, get)),

  closeProject: () => enqueueProjectTransition(async () => {
    const projectId = get().projectId;
    if (projectId) {
      set({ loading: true });
      try {
        await flushDirtyBuffers(projectId, get);
      } catch (error) {
        set({ loading: false });
        notifyError(
          "save before closing project",
          error,
          "The project stayed open because one or more files could not be saved.",
        );
        return;
      }
      flushAutoCommit();
    }

    openSeq++;
    invalidateAllPendingFileOpens();
    mainDocSeq++;
    cancelPendingAutosave();
    cancelProofreading("source");
    cancelProofreading("visual");
    await mcpSetActiveProject(null).catch(() => {});
    resetMutationGeneration();
    set(EMPTY_PROJECT_STATE);
  }),

  createProject: async (name) => {
    const id = await apiCreateProject(name);
    await applyDefaultLatexEngine(id);
    await get().refreshProjects();
    await get().openProject(id);
  },

  createTypstProject: async (name) => {
    const id = await apiCreateTypstProject(name);
    await get().refreshProjects();
    await get().openProject(id);
  },

  createMarkdownProject: async (name) => {
    const id = await apiCreateMarkdownProject(name);
    await get().refreshProjects();
    await get().openProject(id);
  },

  renameProject: async (name) => {
    const { projectId } = get();
    if (!projectId) return;
    const meta = await renameProjectCmd(projectId, name);
    set({ projectName: meta.name });
    await get().refreshProjects();
  },

  importProject: async (path) => {
    const id = await importOverleafProjectCmd(path);
    toast.success("Project imported.");
    await get().refreshProjects();
    await get().openProject(id);
    return id;
  },

  createFromTemplate: async (name, templateId, color) => {
    const id = await apiCreateFromTemplate(name, templateId, color);
    await get().refreshProjects();
    await get().openProject(id);
    return id;
  },

  refreshTree: async () => {
    const { projectId } = get();
    if (!projectId) return;
    const tree = await listFiles(projectId);
    if (get().projectId === projectId) set({ tree });
  },

  openFile: async (path) => {
    const { projectId, files } = get();
    if (!projectId) return;
    if (path.endsWith("/")) return;
    const epoch = fileOpenEpoch;
    const key = fileOpenKey(projectId, path);
    const requestSeq = ++fileOpenSeq;
    pendingFileOpens.set(key, requestSeq);
    // Binary files (PDFs/images) aren't readable as text - skip the text load
    // and just open the tab; the editor renders them via a binary viewer.
    const isBinary = /\.(pdf|png|jpe?g|gif|webp|svg|eps|zip|gz|ttf|otf|woff2?)$/i.test(path);
    if (!files[path] && !isBinary) {
      try {
        const content = await readFileContent(projectId, path);
        if (
          get().projectId !== projectId ||
          fileOpenEpoch !== epoch ||
          pendingFileOpens.get(key) !== requestSeq
        ) {
          if (pendingFileOpens.get(key) === requestSeq) pendingFileOpens.delete(key);
          return;
        }
        set((s) => ({
          files: { ...s.files, [path]: { content, dirty: false } },
        }));
      } catch {
        if (pendingFileOpens.get(key) === requestSeq) pendingFileOpens.delete(key);
        return;
      }
    }
    if (
      get().projectId !== projectId ||
      fileOpenEpoch !== epoch ||
      pendingFileOpens.get(key) !== requestSeq
    ) {
      if (pendingFileOpens.get(key) === requestSeq) pendingFileOpens.delete(key);
      return;
    }
    // Opening a file makes it the active view, so unfocus any git diff (otherwise
    // the diff keeps the editor and the newly opened file never becomes active).
    useDiffStore.getState().clearActiveDiff();
    set((s) => {
      const isNew = !s.openTabs.includes(path);
      return {
        openTabs: isNew ? [...s.openTabs, path] : s.openTabs,
        tabOrder: isNew ? { ...s.tabOrder, [path]: nextTabSeq() } : s.tabOrder,
        activePath: path,
      };
    });
    if (pendingFileOpens.get(key) === requestSeq) pendingFileOpens.delete(key);
  },

  setActive: (path) => {
    useDiffStore.getState().clearActiveDiff();
    set({ activePath: path });
  },

  closeTab: (path) => {
    const { projectId, openTabs, activePath, tabOrder } = get();
    invalidatePendingFileOpen(projectId, path);
    const next = openTabs.filter((p) => p !== path);
    const nextOrder = { ...tabOrder };
    delete nextOrder[path];
    set({
      openTabs: next,
      tabOrder: nextOrder,
      activePath: activePath === path ? (next[next.length - 1] ?? null) : activePath,
    });
  },

  setContent: (path, content, opts) => {
    set((s) => ({
      files: { ...s.files, [path]: { content, dirty: true } },
      docVersion: opts?.bumpVersion ? s.docVersion + 1 : s.docVersion,
    }));
    // Debounce a save of THIS file. Track every edited path so the single timer
    // flushes them all, instead of only whichever tab happens to be active when
    // it fires (which silently lost edits to background tabs).
    pendingSaves.add(path);
    scheduleAutosave(get);
  },

  bumpDocVersion: () => set((s) => ({ docVersion: s.docVersion + 1 })),

  saveActive: async () => {
    const { projectId, activePath } = get();
    if (!projectId || !activePath) return;
    await get().saveFile(activePath);
  },

  saveFile: async (path) => {
    const { projectId, files } = get();
    const state = files[path];
    if (!projectId || !state) return;
    const written = state.content;
    const reloadRevision = fileReloadRevision;
    try {
      await enqueueWrite(projectId, path, written);
    } catch (error) {
      if (get().projectId === projectId && get().files[path]?.dirty) {
        pendingSaves.add(path);
        if (String(error).includes("mutation conflict at generation")) {
          scheduleAutosave(get);
        }
      }
      throw error;
    }
    set((s) => {
      if (s.projectId !== projectId) return {};
      const cur = s.files[path];
      // The file was deleted while the write was in flight: do not resurrect it
      // as an entry with undefined content.
      if (!cur) return {};
      if (fileReloadRevision !== reloadRevision) return {};
      // Newer keystrokes landed during the write, so what is on disk is already
      // stale. Leave it dirty; a later autosave will persist the newer content.
      if (cur.content !== written) return {};
      return { files: { ...s.files, [path]: { ...cur, dirty: false } } };
    });
    const current = get();
    if (current.projectId === projectId && current.files[path]?.dirty) {
      pendingSaves.add(path);
      scheduleAutosave(get);
    } else {
      pendingSaves.delete(path);
    }
    scheduleAutoCommit(projectId);
  },

  createFile: async (path, isDir) => {
    const { projectId } = get();
    if (!projectId) return;
    const result = await apiCreateFile(projectId, path, isDir);
    if (Number.isSafeInteger(result?.generation)) {
      rememberMutationGeneration(projectId, result.generation);
    }
    await get().refreshTree();
    if (!isDir) await get().openFile(path);
  },

  deleteEntry: (path) => enqueueProjectTransition(async () => {
    const { projectId } = get();
    if (!projectId) return;

    const isDeletedPath = (candidate: string) =>
      candidate === path || candidate.startsWith(`${path}/`);
    assertNoUnsavedBuffers(get, isDeletedPath);
    const { discardedPending, writes } = discardQueuedSavesUnder(projectId, isDeletedPath);
    // Deleting one subtree must not suspend autosave for unrelated buffers.
    scheduleAutosave(get);
    let deleted = false;
    try {
      if (writes.length > 0) await Promise.allSettled(writes);
      if (get().projectId !== projectId) return;

      const expectedGeneration = await refreshMutationGeneration(projectId);
      const result = await apiDeleteFile(projectId, path, expectedGeneration);
      if (Number.isSafeInteger(result?.generation)) {
        rememberMutationGeneration(projectId, result.generation);
      }
      deleted = true;
      if (get().projectId !== projectId) return;

      set((s) => (s.projectId === projectId ? pruneDeletedPaths(s, isDeletedPath) : {}));
      await get().refreshTree();
      await reopenMainDocAfterDelete(get, projectId, isDeletedPath);
    } finally {
      if (!deleted) restoreDiscardedSaves(get, projectId, discardedPending);
      scheduleAutosave(get);
    }
  }),

  renameEntry: (from, to, conflictStrategy = "error") => enqueueProjectTransition(async () => {
    const { projectId } = get();
    if (!projectId) return to;
    const previousMainDoc = get().mainDoc;
    // A pending write to the old path could otherwise recreate it after the
    // filesystem move. Drain all dirty buffers through the per-path queue first.
    await flushDirtyBuffers(projectId, get);
    await drainProjectWrites(projectId);
    const expectedGeneration = await refreshMutationGeneration(projectId);
    const destination = await apiRenameFile(
      projectId,
      from,
      to,
      conflictStrategy,
      expectedGeneration,
    );
    await refreshMutationGeneration(projectId);
    // Follow the moved/renamed path in memory so an open tab, its buffer, the
    // active file, and the main-doc pointer don't go stale (also handles folder
    // moves, which carry every descendant path with them).
    const remap = (p: string) =>
      p === from
        ? destination
        : p.startsWith(`${from}/`)
          ? `${destination}${p.slice(from.length)}`
          : p;
    const isWithin = (p: string, root: string) => p === root || p.startsWith(`${root}/`);
    set((s) => {
      const files: Record<string, FileState> = {};
      for (const [k, v] of Object.entries(s.files)) {
        if (conflictStrategy === "replace" && isWithin(k, to) && !isWithin(k, from)) continue;
        files[remap(k)] = v;
      }
      const tabOrder: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.tabOrder)) {
        if (conflictStrategy === "replace" && isWithin(k, to) && !isWithin(k, from)) continue;
        tabOrder[remap(k)] = v;
      }
      const openTabs = [
        ...new Set(
          s.openTabs
            .filter(
              (path) =>
                conflictStrategy !== "replace" || !isWithin(path, to) || isWithin(path, from),
            )
            .map(remap),
        ),
      ];
      return {
        files,
        openTabs,
        tabOrder,
        activePath: s.activePath ? remap(s.activePath) : null,
        mainDoc: remap(s.mainDoc),
      };
    });
    const renamedMainDoc = remap(previousMainDoc);
    if (renamedMainDoc !== previousMainDoc) {
      const seq = ++mainDocSeq;
      set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: null });
      const compileStore = import("@/store/compile");
      try {
        const [engine, compile] = await Promise.all([
          getProjectEngine(projectId),
          compileStore,
        ]);
        if (seq === mainDocSeq && get().projectId === projectId) {
          compile.useCompileStore.getState().reset();
          set({ engine, engineLoaded: true, engineError: null });
        }
      } catch (error) {
        if (seq === mainDocSeq && get().projectId === projectId) {
          const message =
            "Document engine details could not be loaded after renaming the main document.";
          set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: message });
          notifyError("rename main document", error, message);
        }
      }
    }
    await get().refreshTree();
    return destination;
  }),

  copyEntry: (path, isDir = false) => enqueueProjectTransition(async () => {
    const { projectId } = get();
    if (!projectId) return;
    const to = copyDestinationFor(path, isDir);
    try {
      await drainProjectWrites(projectId);
      const expectedGeneration = await refreshMutationGeneration(projectId);
      const result = await apiCopyFile(projectId, path, to, expectedGeneration);
      if (Number.isSafeInteger(result?.generation)) {
        rememberMutationGeneration(projectId, result.generation);
      }
      if (get().projectId === projectId) await get().refreshTree();
    } catch (e) {
      notifyError("copy file", e, `Could not copy "${path}".`);
    }
  }),

  importPaths: (destDir, sourcePaths) => enqueueProjectTransition(async () => {
    const { projectId } = get();
    if (!projectId || sourcePaths.length === 0) return;
    try {
      await drainProjectWrites(projectId);
      const expectedGeneration = await refreshMutationGeneration(projectId);
      const result = await apiImportPathsIntoProject(
        projectId,
        destDir,
        sourcePaths,
        expectedGeneration,
      );
      if (Number.isSafeInteger(result?.generation)) {
        rememberMutationGeneration(projectId, result.generation);
      }
      if (get().projectId === projectId) await get().refreshTree();
    } catch (e) {
      notifyError("import files", e, "Could not import. See the app log for details.");
    }
  }),

  prepareExternalMutation: async (projectId) => {
    if (get().projectId !== projectId) {
      throw new Error("Project changed before the external mutation could run.");
    }
    await flushDirtyBuffers(projectId, get);
    await drainProjectWrites(projectId);
    if (get().projectId !== projectId) {
      throw new Error("Project changed before the external mutation could run.");
    }
    const generation = await refreshMutationGeneration(projectId);
    if (get().projectId !== projectId) {
      throw new Error("Project changed before the external mutation could run.");
    }
    return generation;
  },

  recordMutationGeneration: (projectId, generation) => {
    if (get().projectId === projectId) {
      rememberMutationGeneration(projectId, generation);
    }
  },

  // Called after an external actor (e.g. the AI assistant) mutates a file on
  // disk, so the in-memory editor buffer stays in sync and the next save does
  // not clobber the edit. Cross-window broadcast is done by the AI host so
  // listeners can re-apply without echoing forever.
  applyExternalWrite: (projectId, path, content) => {
    if (get().projectId !== projectId) return false;
    void refreshMutationGeneration(projectId).catch(() => {});
    const currentFile = get().files[path];
    if (currentFile?.dirty) {
      const localContent = currentFile.content;
      pendingSaves.delete(path);
      void enqueueWrite(projectId, path, localContent)
        .then(() => {
          if (
            get().projectId === projectId &&
            get().files[path]?.content === localContent
          ) {
            set((s) => ({
              files: {
                ...s.files,
                [path]: { content: localContent, dirty: false },
              },
            }));
            pendingSaves.delete(path);
          }
          scheduleAutosave(get);
        })
        .catch((error) => {
          if (get().projectId === projectId) {
            const latest = get().files[path];
            if (latest) {
              set((s) => ({
                files: {
                  ...s.files,
                  [path]: { ...latest, dirty: true },
                },
              }));
              pendingSaves.add(path);
              scheduleAutosave(get);
            }
          }
          notifyError(
            "preserve local file change",
            error,
            `Could not preserve your local update to "${path}".`,
          );
        });
      toast.info(
        `An external edit to "${path}" arrived while you had unsaved changes. Your local edit was kept.`,
      );
      return false;
    }
    const mustFollowPendingWrite = pendingWrites.has(writeKey(projectId, path));
    pendingSaves.delete(path);
    set((s) => {
      const activatesPath = !s.activePath || s.activePath === path;
      return {
        files: { ...s.files, [path]: { content, dirty: false } },
        openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
        activePath: s.activePath || path,
        docVersion: activatesPath ? s.docVersion + 1 : s.docVersion,
      };
    });
    if (mustFollowPendingWrite) {
      void enqueueWrite(projectId, path, content).catch((error) => {
        if (
          get().projectId === projectId &&
          get().files[path]?.content === content
        ) {
          set((s) => ({
            files: {
              ...s.files,
              [path]: { content, dirty: true },
            },
          }));
          pendingSaves.add(path);
          scheduleAutosave(get);
        }
        notifyError(
          "preserve external file change",
          error,
          `Could not persist the latest external update to "${path}".`,
        );
      });
    }
    void get().refreshTree();
    return true;
  },

  applyExternalDelete: (projectId, path) => {
    if (get().projectId !== projectId) return false;
    void refreshMutationGeneration(projectId).catch(() => {});
    invalidateAllPendingFileOpens();
    const isDeletedPath = (candidate: string) =>
      candidate === path || candidate.startsWith(`${path}/`);
    const preserved = Object.entries(get().files).filter(
      ([candidate, file]) => isDeletedPath(candidate) && file.dirty,
    );
    for (const pending of [...pendingSaves]) {
      if (isDeletedPath(pending)) pendingSaves.delete(pending);
    }
    set((s) => {
      const files = { ...s.files };
      for (const candidate of Object.keys(files)) {
        if (isDeletedPath(candidate) && !files[candidate].dirty) delete files[candidate];
      }
      const tabOrder = { ...s.tabOrder };
      for (const candidate of Object.keys(tabOrder)) {
        if (isDeletedPath(candidate) && !files[candidate]) delete tabOrder[candidate];
      }
      const openTabs = s.openTabs.filter((candidate) => !!files[candidate]);
      return {
        files,
        tabOrder,
        openTabs,
        activePath: s.activePath && files[s.activePath] ? s.activePath : openTabs.at(-1) ?? null,
      };
    });
    for (const [preservedPath, file] of preserved) {
      void enqueueWrite(projectId, preservedPath, file.content)
        .then(() => {
          if (
            get().projectId === projectId &&
            get().files[preservedPath]?.content === file.content
          ) {
            set((s) => ({
              files: {
                ...s.files,
                [preservedPath]: { content: file.content, dirty: false },
              },
            }));
            pendingSaves.delete(preservedPath);
          }
          void get().refreshTree();
          scheduleAutosave(get);
        })
        .catch((error) => {
          if (get().projectId === projectId && get().files[preservedPath]) {
            pendingSaves.add(preservedPath);
            scheduleAutosave(get);
          }
          notifyError(
            "restore local file after external delete",
            error,
            `Could not restore your unsaved update to "${preservedPath}".`,
          );
        });
    }
    if (preserved.length > 0) {
      toast.info("An external deletion raced unsaved edits. Your local edits were restored.");
    }
    void get().refreshTree();
    return preserved.length === 0;
  },

  applyExternalRename: (projectId, from, to) => {
    if (get().projectId !== projectId) return false;
    void refreshMutationGeneration(projectId).catch(() => {});
    invalidateAllPendingFileOpens();
    const remap = (path: string) =>
      path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
    const renamedPending = [...pendingSaves].map(remap);
    pendingSaves.clear();
    for (const path of renamedPending) pendingSaves.add(path);
    let mainDocChanged = false;
    set((s) => {
      const files: Record<string, FileState> = {};
      for (const [path, file] of Object.entries(s.files)) {
        files[remap(path)] = file;
      }
      const tabOrder: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.tabOrder)) tabOrder[remap(k)] = v;
      const mainDoc = remap(s.mainDoc);
      mainDocChanged = mainDoc !== s.mainDoc;
      return {
        files,
        tabOrder,
        openTabs: s.openTabs.map(remap),
        activePath:
          s.activePath === from
            ? to
            : s.activePath?.startsWith(`${from}/`)
            ? to + s.activePath?.slice(from.length)
            : s.activePath,
        mainDoc,
        docVersion: s.activePath === from || s.activePath?.startsWith(`${from}/`) ? s.docVersion + 1 : s.docVersion,
      };
    });
    if (mainDocChanged) {
      const seq = ++mainDocSeq;
      set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: null });
      void Promise.all([getProjectEngine(projectId), import("@/store/compile")])
        .then(([engine, { useCompileStore }]) => {
          if (seq !== mainDocSeq || get().projectId !== projectId) return;
          useCompileStore.getState().reset();
          set({ engine, engineLoaded: true, engineError: null });
        })
        .catch((error) => {
          if (seq !== mainDocSeq || get().projectId !== projectId) return;
          const message =
            "Document engine details could not be loaded after renaming the main document.";
          set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: message });
          notifyError("reconcile renamed main document", error, message);
        });
    }
    for (const [path, file] of Object.entries(get().files)) {
      if (file.dirty) pendingSaves.add(path);
    }
    scheduleAutosave(get);
    void get().refreshTree();
    return true;
  },

  applyProjectStateChanged: async (event) => {
    const projectId = event.projectId;
    if (!projectStateEventIsValid(event, get)) return false;
    const revision = admitProjectStateEvent(event);
    const metadata = projectMetadataState(event);
    if (!event.filesChanged) {
      if (projectRevisionIsCurrent(projectId, revision, get)) set(metadata);
      return true;
    }
    fileReloadRevision++;
    const captured = get().files;
    try {
      const tree = await listFiles(projectId);
      if (!projectRevisionIsCurrent(projectId, revision, get)) return false;
      const filePaths = new Set(
        tree.filter((entry) => !entry.is_dir).map((entry) => entry.path),
      );
      const reloaded = await loadChangedProjectFiles(projectId, captured, filePaths);
      if (!projectRevisionIsCurrent(projectId, revision, get)) return false;
      const removedDirty: string[] = [];
      set((state) => {
        if (!projectRevisionIsCurrent(projectId, revision, () => state)) return {};
        return reconciledProjectState(state, metadata, tree, captured, reloaded, removedDirty);
      });
      restoreRemovedDirtyFiles(removedDirty, get);
      scheduleAutosave(get);
      return true;
    } catch (error) {
      if (!projectRevisionIsCurrent(projectId, revision, get)) return false;
      set(metadata);
      void get().refreshTree();
      notifyError(
        "reload project after external change",
        error,
        "Project settings were updated, but some changed files could not be reloaded.",
      );
      return true;
    }
  },

  setMainDoc: async (path) => {
    const { projectId } = get();
    if (!projectId) return;
    const seq = ++mainDocSeq;
    const compileStore = import("@/store/compile");
    set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: null });
    try {
      const meta = await setMainDocCmd(projectId, path);
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      const compile = await compileStore;
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      // The backend serializes this metadata change after any active compile.
      // Invalidate the matching frontend attempt/output before exposing the new
      // main document so its late IPC response cannot paint the old PDF.
      compile.useCompileStore.getState().reset();
      // Metadata is already committed under the backend compile lock. Publish
      // its source identity immediately while capabilities remain fail-closed;
      // otherwise an old compile could still match `mainDoc` during the engine
      // descriptor request and repopulate the cleared preview.
      set({ mainDoc: meta.main_doc });
      const engine = await getProjectEngine(projectId);
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      set({ mainDoc: meta.main_doc, engine, engineLoaded: true, engineError: null });
    } catch (error) {
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      const message = "Document engine details could not be loaded. Engine-specific actions are disabled.";
      set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: message });
      notifyError("set main document", error, message);
      throw error;
    }
  },

  setEngine: async (engineName, flavor = null) => {
    const { projectId } = get();
    if (!projectId) return;
    // Same race protections as setMainDoc: an engine switch invalidates the
    // current compile output and must not let a late descriptor request from a
    // previous selection win.
    const seq = ++mainDocSeq;
    const compileStore = import("@/store/compile");
    set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: null });
    try {
      const meta = await setProjectEngineCmd(projectId, engineName, flavor);
      // Capture the reproducibility pin (distro + tlmgr packages) for the new
      // latexmk project in the background; slow tlmgr calls stay off this path.
      if (engineName === "latexmk") void recordProjectTexSpec(projectId).catch(() => {});
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      const compile = await compileStore;
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      compile.useCompileStore.getState().reset();
      set({ mainDoc: meta.main_doc });
      const engine = await getProjectEngine(projectId);
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      set({ engine, engineLoaded: true, engineError: null });
    } catch (error) {
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      const message = "Document engine details could not be loaded. Engine-specific actions are disabled.";
      set({ engine: UNKNOWN_ENGINE, engineLoaded: false, engineError: message });
      notifyError("set compile engine", error, message);
      throw error;
    }
  },

  setShellEscape: async (allow) => {
    const { projectId } = get();
    if (!projectId) return;
    const seq = ++mainDocSeq;
    const compileStore = import("@/store/compile");
    try {
      const compile = await compileStore;
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      const meta = await setProjectShellEscapeCmd(projectId, allow);
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      compile.useCompileStore.getState().reset();
      set((state) => ({
        engine: { ...state.engine, allow_shell_escape: meta.allow_shell_escape },
        engineLoaded: true,
        engineError: null,
      }));
    } catch (error) {
      if (seq !== mainDocSeq || get().projectId !== projectId) return;
      notifyError(
        allow ? "allow external TeX commands" : "block external TeX commands",
        error,
      );
      throw error;
    }
  },

  restoreFromGit: (oid) => enqueueProjectTransition(async () => {
    const { projectId } = get();
    if (!projectId) return;

    set({ loading: true });
    try {
      const expectedGeneration = await get().prepareExternalMutation(projectId);
      if (get().projectId !== projectId) return;

      const event = await gitRestore(projectId, oid, expectedGeneration);
      if (get().projectId !== projectId) return;
      await get().applyProjectStateChanged(event);
    } finally {
      if (get().projectId === projectId && get().loading) {
        set({ loading: false });
      }
    }
  }),

  pullFromGit: () => enqueueProjectTransition(async () => {
    const { projectId } = get();
    if (!projectId) return "";
    const expectedGeneration = await get().prepareExternalMutation(projectId);
    const result = await gitPull(projectId, expectedGeneration);
    await get().applyProjectStateChanged(result.state);
    return result.message;
  }),

  discardFromGit: (path) => enqueueProjectTransition(async () => {
    const { projectId } = get();
    if (!projectId) return;
    const expectedGeneration = await get().prepareExternalMutation(projectId);
    const event = await gitDiscard(projectId, path, expectedGeneration);
    await get().applyProjectStateChanged(event);
  }),
}));

export function useActiveContent(): string {
  return useFilesStore((s) =>
    s.activePath ? s.files[s.activePath]?.content ?? "" : ""
  );
}

// Flush the debounced autosave immediately when the page is going away, so an
// edit made within the debounce window of a reload or quit is not lost.
function flushPendingSaves() {
  stopAutosaveTimer();
  const state = useFilesStore.getState();
  const paths = Object.entries(state.files)
    .filter(([, file]) => file.dirty)
    .map(([path]) => path);
  for (const p of paths) {
    pendingSaves.delete(p);
    useFilesStore
      .getState()
      .saveFile(p)
      .catch((e) => notifyError("autosave", e));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingSaves);
  window.addEventListener("beforeunload", flushPendingSaves);

  if (import.meta.env.DEV) {
    // E2E / devtools hook: read-only commit count, so a test can wait for a
    // fire-and-forget auto-commit to land without opening the History modal.
    (window as unknown as { __gitCommitCount?: () => Promise<number> }).__gitCommitCount =
      async () => {
        const id = useFilesStore.getState().projectId;
        if (!id) return 0;
        try {
          return (await gitLog(id)).length;
        } catch {
          return 0;
        }
      };
  }
}

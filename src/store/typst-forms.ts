import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog } from "@oleafly/editor/typst-forms";
import { create } from "zustand";
import { logError } from "@/lib/log";
import { loadTypstFormCatalog } from "@/lib/typst-forms";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export const WANT_DEBOUNCE_MS = 150;
// A watched file's clean buffer changes when the assistant writes the file or live
// collaboration mirrors a collaborator's typing into it. Collaboration writes that typing to
// disk 120 ms later, and a file open in an editor at most once a second, so the reload waits
// until the disk has it.
export const CHANGE_DEBOUNCE_MS = 1_500;
// A first load can fail on a lock a restore holds or on a passing read error, and nothing is
// watched until one works, so it gets one more try.
export const RETRY_DELAY_MS = 2_000;

export interface TypstFormsStore {
  readonly projectId: string | null;
  readonly catalog: TypstFormCatalog;
  readonly wanted: readonly string[];
  // The packages the catalog was read with, or null until a read has finished for the project.
  readonly loadedWith: readonly string[] | null;
  // Adds package specs the open documents import; reloads once the burst settles.
  want(packages: readonly string[]): void;
  // One read at a time: a call while one runs returns at once and makes it read again after.
  refresh(): Promise<void>;
}

type FilesState = ReturnType<typeof useFilesStore.getState>;
type OpenFiles = FilesState["files"];

let generation = 0;
let wantTimer: ReturnType<typeof setTimeout> | null = null;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retried = false;
// The read running for the current project, and whether a call asked for another one.
let reading: { generation: number; again: boolean } | null = null;
// `<engine>\n<main document>` of the project, as last seen once its engine was known.
let engineSeen: string | null = null;

function cancelWant(): void {
  if (wantTimer) clearTimeout(wantTimer);
  wantTimer = null;
}

function cancelTimers(): void {
  cancelWant();
  if (changeTimer) clearTimeout(changeTimer);
  if (retryTimer) clearTimeout(retryTimer);
  changeTimer = null;
  retryTimer = null;
}

// Nothing has loaded for the project yet, so `watch` is empty and can't say what matters.
function unread(catalog: TypstFormCatalog): boolean {
  return catalog === EMPTY_TYPST_FORM_CATALOG;
}

function retryFirstLoad(): void {
  if (retried || !unread(useTypstFormsStore.getState().catalog)) return;
  retried = true;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void useTypstFormsStore.getState().refresh();
  }, RETRY_DELAY_MS);
}

async function read(request: number): Promise<void> {
  const { projectId, wanted, catalog: shown } = useTypstFormsStore.getState();
  if (!projectId) return;
  const { engine, engineLoaded } = useFilesStore.getState();
  // Only Typst projects have forms; the backend answers any other with an empty catalog.
  if (engineLoaded && engine.id !== "typst") {
    if (!unread(shown)) useTypstFormsStore.setState({ catalog: EMPTY_TYPST_FORM_CATALOG, loadedWith: null });
    return;
  }
  let catalog: TypstFormCatalog;
  try {
    catalog = await loadTypstFormCatalog(projectId, wanted);
  } catch (error) {
    void logError("load Typst forms", error);
    if (request === generation) retryFirstLoad();
    return;
  }
  const current = useTypstFormsStore.getState();
  if (request !== generation || current.projectId !== projectId) return;
  // The same version keeps the same object, so editors skip a rebuild.
  useTypstFormsStore.setState(
    catalog.version === current.catalog.version ? { loadedWith: wanted } : { catalog, loadedWith: wanted },
  );
}

// Reads again while calls keep asking for it. The last check and the end of the flight happen
// in one step, so a call that lands just after a read is never dropped.
async function readUntilSettled(flight: { readonly generation: number; again: boolean }): Promise<void> {
  flight.again = false;
  try {
    await read(flight.generation);
  } catch (error) {
    if (reading === flight) reading = null;
    throw error;
  }
  if (flight.again && flight.generation === generation) return readUntilSettled(flight);
  if (reading === flight) reading = null;
}

export const useTypstFormsStore = create<TypstFormsStore>((set, get) => ({
  projectId: null,
  catalog: EMPTY_TYPST_FORM_CATALOG,
  wanted: [],
  loadedWith: null,

  want(packages) {
    const wanted = get().wanted;
    const added = packages.filter((spec) => !wanted.includes(spec));
    if (added.length === 0) return;
    set({ wanted: [...wanted, ...new Set(added)].sort((a, b) => a.localeCompare(b)) });
    cancelWant();
    wantTimer = setTimeout(() => {
      wantTimer = null;
      void get().refresh();
    }, WANT_DEBOUNCE_MS);
  },

  async refresh() {
    if (!get().projectId) return;
    // Each answer is applied as it lands, so triggers faster than the backend still update
    // the catalog once per read. A switch starts a new generation and doesn't wait.
    if (reading?.generation === generation) {
      reading.again = true;
      return;
    }
    const flight = { generation, again: false };
    reading = flight;
    await readUntilSettled(flight);
  },
}));

export function formsRefreshNeeded(changedPaths: readonly string[], catalog: TypstFormCatalog): boolean {
  return changedPaths.some((changed) =>
    catalog.watch.some((watched) => watched === changed || watched.startsWith(`${changed}/`)),
  );
}

// Whether a change to these paths can change the catalog. Before the first load nothing is
// watched, so any change might.
export function formsChangeNeedsRefresh(changedPaths: readonly string[]): boolean {
  const { catalog } = useTypstFormsStore.getState();
  return unread(catalog) || formsRefreshNeeded(changedPaths, catalog);
}

function engineKey(state: FilesState): string | null {
  return state.engineLoaded ? `${state.engine.id}\n${state.mainDoc}` : null;
}

function resetFor(projectId: string | null): void {
  generation += 1;
  cancelTimers();
  retried = false;
  engineSeen = engineKey(useFilesStore.getState());
  useTypstFormsStore.setState({ projectId, catalog: EMPTY_TYPST_FORM_CATALOG, wanted: [], loadedWith: null });
  if (projectId) void useTypstFormsStore.getState().refresh();
}

// Set as main and an engine switch can make a project a Typst project, or stop it being one.
function engineChanged(state: FilesState): boolean {
  const key = engineKey(state);
  if (key === null || key === engineSeen) return false;
  engineSeen = key;
  return true;
}

// A save from inside the app takes a buffer from dirty to clean.
function savedAny(files: OpenFiles, previous: OpenFiles): boolean {
  return Object.entries(files).some(([path, file]) => !file.dirty && previous[path]?.dirty === true);
}

// How the buffers of watched files changed: "saved" from inside the app, or "changed" without
// a save, when a clean buffer's text changed (the assistant or live collaboration wrote the
// file) or a buffer appeared clean or went away (the file was created, opened, renamed or
// deleted).
function watchedBufferChange(watch: readonly string[], files: OpenFiles, previous: OpenFiles): "saved" | "changed" | null {
  let change: "changed" | null = null;
  for (const path of watch) {
    const now = files[path];
    const before = previous[path];
    if (now === before || now?.dirty) continue;
    if (now && before?.dirty) return "saved";
    if (now?.content !== before?.content) change = "changed";
  }
  return change;
}

function inTree(tree: FilesState["tree"], path: string): boolean {
  return tree.some((entry) => entry.path === path);
}

// One reload once a burst of such changes settles.
function scheduleChangeRefresh(): void {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    void useTypstFormsStore.getState().refresh();
  }, CHANGE_DEBOUNCE_MS);
}

function followFiles(state: FilesState, previous: FilesState): void {
  const forms = useTypstFormsStore.getState();
  if (state.projectId !== forms.projectId) {
    resetFor(state.projectId);
    return;
  }
  if (!state.projectId) return;
  const { watch } = forms.catalog;
  let now = engineChanged(state);
  let later = false;
  if (state.files !== previous.files) {
    const change = watchedBufferChange(watch, state.files, previous.files);
    // Until a catalog has loaded nothing is watched, so any save may be the one that matters.
    now ||= change === "saved" || (unread(forms.catalog) && savedAny(state.files, previous.files));
    later = change === "changed";
  }
  // A watched file created or removed in the file tree without an open buffer.
  if (state.tree !== previous.tree) {
    later ||= watch.some((path) => inTree(state.tree, path) !== inTree(previous.tree, path));
  }
  if (now) void forms.refresh();
  if (later) scheduleChangeRefresh();
}

let started = false;

// Follows the open project, its engine, changes to watched files and compiles from the first
// time anything asks for forms (the Visual mode port or the forms lint), not from import, so
// the stores it reads are ready by then.
export function startTypstFormsSync(): void {
  if (started) return;
  started = true;
  useFilesStore.subscribe(followFiles);
  // A compile can install a package the catalog is still missing.
  useCompileStore.subscribe((state, previous) => {
    if (state.lastCompiledAt === previous.lastCompiledAt) return;
    if (useTypstFormsStore.getState().wanted.length > 0) void useTypstFormsStore.getState().refresh();
  });
  const { projectId } = useFilesStore.getState();
  if (projectId !== useTypstFormsStore.getState().projectId) resetFor(projectId);
}

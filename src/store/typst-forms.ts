import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog } from "@oleafly/editor/typst-forms";
import { create } from "zustand";
import { logError } from "@/lib/log";
import { loadTypstFormCatalog } from "@/lib/typst-forms";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export const WANT_DEBOUNCE_MS = 150;
export const CHANGE_DEBOUNCE_MS = 1_500;
export const RETRY_DELAY_MS = 2_000;

export interface TypstFormsStore {
  readonly projectId: string | null;
  readonly catalog: TypstFormCatalog;
  readonly wanted: readonly string[];
  readonly loadedWith: readonly string[] | null;
  want(packages: readonly string[]): void;
  refresh(): Promise<void>;
}

type FilesState = ReturnType<typeof useFilesStore.getState>;
type OpenFiles = FilesState["files"];

let generation = 0;
let wantTimer: ReturnType<typeof setTimeout> | null = null;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retried = false;
let reading: { generation: number; again: boolean } | null = null;
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
  useTypstFormsStore.setState(
    catalog.version === current.catalog.version ? { loadedWith: wanted } : { catalog, loadedWith: wanted },
  );
}

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

function engineChanged(state: FilesState): boolean {
  const key = engineKey(state);
  if (key === null || key === engineSeen) return false;
  engineSeen = key;
  return true;
}

function savedAny(files: OpenFiles, previous: OpenFiles): boolean {
  return Object.entries(files).some(([path, file]) => !file.dirty && previous[path]?.dirty === true);
}

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
    now ||= change === "saved" || (unread(forms.catalog) && savedAny(state.files, previous.files));
    later = change === "changed";
  }
  if (state.tree !== previous.tree) {
    later ||= watch.some((path) => inTree(state.tree, path) !== inTree(previous.tree, path));
  }
  if (now) void forms.refresh();
  if (later) scheduleChangeRefresh();
}

let started = false;

export function startTypstFormsSync(): void {
  if (started) return;
  started = true;
  useFilesStore.subscribe(followFiles);
  useCompileStore.subscribe((state, previous) => {
    if (state.lastCompiledAt === previous.lastCompiledAt) return;
    if (useTypstFormsStore.getState().wanted.length > 0) void useTypstFormsStore.getState().refresh();
  });
  const { projectId } = useFilesStore.getState();
  if (projectId !== useTypstFormsStore.getState().projectId) resetFor(projectId);
}

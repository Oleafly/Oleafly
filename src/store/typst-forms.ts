import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog } from "@oleafly/editor/typst-forms";
import { create } from "zustand";
import { logError } from "@/lib/log";
import { loadTypstFormCatalog } from "@/lib/typst-forms";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export const WANT_DEBOUNCE_MS = 150;

export interface TypstFormsStore {
  readonly projectId: string | null;
  readonly catalog: TypstFormCatalog;
  readonly wanted: readonly string[];
  // Adds package specs the open documents import; reloads once the burst settles.
  want(packages: readonly string[]): void;
  refresh(): Promise<void>;
}

let generation = 0;
let wantTimer: ReturnType<typeof setTimeout> | null = null;

function cancelWant(): void {
  if (wantTimer) clearTimeout(wantTimer);
  wantTimer = null;
}

export const useTypstFormsStore = create<TypstFormsStore>((set, get) => ({
  projectId: null,
  catalog: EMPTY_TYPST_FORM_CATALOG,
  wanted: [],

  want(packages) {
    const wanted = get().wanted;
    const added = packages.filter((spec) => !wanted.includes(spec));
    if (added.length === 0) return;
    set({ wanted: [...wanted, ...new Set(added)].sort() });
    cancelWant();
    wantTimer = setTimeout(() => {
      wantTimer = null;
      void get().refresh();
    }, WANT_DEBOUNCE_MS);
  },

  async refresh() {
    const { projectId, wanted } = get();
    if (!projectId) return;
    generation += 1;
    const request = generation;
    let catalog: TypstFormCatalog;
    try {
      catalog = await loadTypstFormCatalog(projectId, wanted);
    } catch (error) {
      void logError("load Typst forms", error);
      return;
    }
    if (request !== generation || get().projectId !== projectId) return;
    // The same version keeps the same object, so editors skip a rebuild.
    if (catalog.version !== get().catalog.version) set({ catalog });
  },
}));

export function formsRefreshNeeded(changedPaths: readonly string[], catalog: TypstFormCatalog): boolean {
  return changedPaths.some((changed) =>
    catalog.watch.some((watched) => watched === changed || watched.startsWith(`${changed}/`)),
  );
}

function resetFor(projectId: string | null): void {
  generation += 1;
  cancelWant();
  useTypstFormsStore.setState({ projectId, catalog: EMPTY_TYPST_FORM_CATALOG, wanted: [] });
  if (projectId) void useTypstFormsStore.getState().refresh();
}

type OpenFiles = ReturnType<typeof useFilesStore.getState>["files"];

// A watched file saved from inside the app goes from dirty to clean.
function savedWatchedFile(files: OpenFiles, previous: OpenFiles): boolean {
  return useTypstFormsStore
    .getState()
    .catalog.watch.some((path) => previous[path]?.dirty === true && files[path]?.dirty === false);
}

let started = false;

// Follows the open project, in-app saves and compiles from the first time anything asks for
// forms (the Visual mode port or the forms lint), not from import, so the stores it reads
// are ready by then.
export function startTypstFormsSync(): void {
  if (started) return;
  started = true;
  useFilesStore.subscribe((state, previous) => {
    if (state.projectId !== useTypstFormsStore.getState().projectId) {
      resetFor(state.projectId);
      return;
    }
    if (state.files !== previous.files && savedWatchedFile(state.files, previous.files)) {
      void useTypstFormsStore.getState().refresh();
    }
  });
  // A compile can install a package the catalog is still missing.
  useCompileStore.subscribe((state, previous) => {
    if (state.lastCompiledAt === previous.lastCompiledAt) return;
    if (useTypstFormsStore.getState().wanted.length > 0) void useTypstFormsStore.getState().refresh();
  });
  const { projectId } = useFilesStore.getState();
  if (projectId !== useTypstFormsStore.getState().projectId) resetFor(projectId);
}

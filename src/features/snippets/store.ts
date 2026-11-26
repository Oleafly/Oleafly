import { create } from "zustand";
import type {
  LanguageIndex,
  ParsedSnippetFile,
  SnippetLibrary,
  SnippetOverride,
  SnippetProblem,
  SnippetRecord,
} from "@oleafly/snippets";
import { isWindowsReservedComponent } from "@/lib/project-notes";
import { isRecord } from "@/lib/is-record";
import { logError } from "@/lib/log";

export const STATE_FILE = "_state.json";
const USES_KEY = "oleafly.snippets.uses";
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}\.json$/u;

export interface SnippetState {
  disabledCollections: string[];
  knownCollections: string[];
  overrides: SnippetOverride[];
  disabledRegex: string[];
}

export type OverrideChange = SnippetOverride | { id: string; collection: string; clear: true };

export interface SnippetFileText {
  name: string;
  text: string;
}

export interface DiskFile {
  name: string;
  modifiedMs: number;
  text: string | null;
  parsed: ParsedSnippetFile;
  good: ParsedSnippetFile | null;
}

export interface PackSet {
  files: ParsedSnippetFile[];
  defaultOff: string[];
}

export interface SnippetStore {
  status: "idle" | "loading" | "ready";
  files: ParsedSnippetFile[];
  state: SnippetState;
  library: SnippetLibrary;
  useCounts: Record<string, number>;
  disk: readonly DiskFile[];
  packs: PackSet | null;
  stateProblems: SnippetProblem[];
  load(): Promise<void>;
  saveRecord(collection: string, record: SnippetRecord): Promise<void>;
  deleteRecord(collection: string, id: string): Promise<void>;
  setCollectionEnabled(collection: string, enabled: boolean): Promise<void>;
  setOverride(change: OverrideChange): Promise<void>;
  importVsCodeFile(fileName: string, text: string): Promise<ParsedSnippetFile>;
  disableRegex(id: string): Promise<void>;
  recordUse(id: string): void;
}

export const EMPTY_STATE: SnippetState = { disabledCollections: [], knownCollections: [], overrides: [], disabledRegex: [] };

const EMPTY_INDEX: LanguageIndex = { prefixSorted: [], autoByLastChar: new Map(), regexByEnd: new Map(), wrappers: [], triggerless: [] };

const EMPTY_LIBRARY: SnippetLibrary = { records: [], all: [], problems: [], byId: () => undefined, forLanguage: () => EMPTY_INDEX };

const engine = () => import("./store-engine");

let loading: Promise<void> | null = null;

function readUseCounts(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(USES_KEY) ?? "{}");
    if (!isRecord(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) > 0),
    );
  } catch {
    return {};
  }
}

function saveUseCounts(counts: Record<string, number>): void {
  try {
    localStorage.setItem(USES_KEY, JSON.stringify(counts));
  } catch {
    return;
  }
}

export function collectionOf(name: string): string {
  return name.slice(0, -".json".length);
}

export function validSnippetFileName(name: string): boolean {
  if (name === STATE_FILE) return true;
  return FILE_NAME.test(name) && !/[. ]$/u.test(collectionOf(name)) && !isWindowsReservedComponent(name);
}

export function snippetsReady(): Promise<void> {
  const store = useSnippetStore.getState();
  return store.status === "ready" ? Promise.resolve() : store.load();
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  status: "idle",
  files: [],
  state: EMPTY_STATE,
  library: EMPTY_LIBRARY,
  useCounts: readUseCounts(),
  disk: [],
  packs: null,
  stateProblems: [],
  load: () => {
    if (get().status === "idle") set({ status: "loading" });
    if (loading) return loading;
    const run = engine()
      .then((module) => module.load())
      .finally(() => {
        loading = null;
      });
    run.catch((error: unknown) => logError("load snippets", error));
    loading = run;
    return run;
  },
  saveRecord: (collection, record) => engine().then((module) => module.saveRecord(collection, record)),
  deleteRecord: (collection, id) => engine().then((module) => module.deleteRecord(collection, id)),
  setCollectionEnabled: (collection, enabled) => engine().then((module) => module.setCollectionEnabled(collection, enabled)),
  setOverride: (change) => engine().then((module) => module.setOverride(change)),
  importVsCodeFile: (fileName, text) => engine().then((module) => module.importVsCodeFile(fileName, text)),
  disableRegex: (id) => engine().then((module) => module.disableRegex(id)),
  recordUse: (id) => {
    const useCounts = { ...get().useCounts, [id]: (get().useCounts[id] ?? 0) + 1 };
    saveUseCounts(useCounts);
    set({ useCounts });
  },
}));

export function snippetSettingsFiles(): SnippetFileText[] {
  return useSnippetStore
    .getState()
    .disk.filter((file): file is DiskFile & { text: string } => file.text !== null)
    .map((file) => ({ name: file.name, text: file.text }));
}

export function importSnippetSettingsFiles(files: readonly SnippetFileText[]): Promise<void> {
  return engine().then((module) => module.importSnippetSettingsFiles(files));
}

import {
  buildLibrary,
  EXPANDS,
  idLine,
  isOneOf,
  parseBody,
  parseJsonc,
  parseSnippetFile,
  PLACES,
  SNIPPET_LANGUAGES,
  serializeBody,
  serializeSnippetFile,
  type BodyNode,
  type ParsedSnippetFile,
  type SnippetLibrary,
  type SnippetOverride,
  type SnippetProblem,
  type SnippetRecord,
} from "@oleafly/snippets";
import { isRecord } from "@/lib/is-record";
import { logError } from "@/lib/log";
import { numberedPath } from "@/lib/path-utils";
import { isWindowsReservedComponent } from "@/lib/project-notes";
import { listSnippetFiles, writeSnippetFile, type SnippetFileEntry } from "@/lib/tauri";
import latexAt from "./packs/builtin-latex-at.json?raw";
import latexSlash from "./packs/builtin-latex-slash.json?raw";
import markdownSlash from "./packs/builtin-markdown-slash.json?raw";
import typstSlash from "./packs/builtin-typst-slash.json?raw";
import {
  collectionOf,
  type DiskFile,
  EMPTY_STATE,
  type OverrideChange,
  type PackSet,
  type SnippetFileText,
  type SnippetState,
  type SnippetStore,
  STATE_FILE,
  useSnippetStore,
} from "./store";
import { parseUserFile, unreadableProblem, wholeFileProblem } from "./user-file";

const STATE_COLLECTION = "_state";
const PACK_FOLDER = "snippets/";
const PACK_FILE = /^[a-z0-9][a-z0-9-]*\.json$/u;
const COLLECTION_ID = /^[a-z0-9][a-z0-9-]*$/u;
const NAME_CHARACTERS = /[^A-Za-z0-9 ._-]+/gu;
const STEM_LIMIT = 56;
const BODY_KEYS: readonly string[] = [...SNIPPET_LANGUAGES, "default"];
const BUNDLED: readonly (readonly [string, string])[] = [
  ["builtin-latex-at", latexAt],
  ["builtin-latex-slash", latexSlash],
  ["builtin-markdown-slash", markdownSlash],
  ["builtin-typst-slash", typstSlash],
];

type Patch = NonNullable<SnippetOverride["patch"]>;
type PatchKey = keyof Patch;
const PATCH_KEYS: readonly PatchKey[] = ["trigger", "expand", "place", "inWord", "lineStart", "priority", "languages", "name", "bodies"];

let bundled: ParsedSnippetFile[] | null = null;
let loading: Promise<void> | null = null;
let fetchingPacks: Promise<PackSet | null> | null = null;
let writing: Promise<unknown> = Promise.resolve();
let watching = false;

function bundledFiles(): ParsedSnippetFile[] {
  bundled ??= BUNDLED.map(([collection, text]) => parseSnippetFile(text, collection, "builtin"));
  return bundled;
}

function libraryOf(files: readonly ParsedSnippetFile[], state: SnippetState, stateProblems: readonly SnippetProblem[]): SnippetLibrary {
  const problemFile: ParsedSnippetFile[] = stateProblems.length > 0 ? [{ collection: STATE_COLLECTION, records: [], problems: [...stateProblems] }] : [];
  return buildLibrary({
    files: [...files, ...problemFile],
    disabledCollections: new Set(state.disabledCollections),
    overrides: state.overrides,
    disabledRegex: new Set(state.disabledRegex),
  });
}

function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? "";
  const stem = base
    .replace(/\.(?:code-snippets|json)$/iu, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(NAME_CHARACTERS, "-")
    .replace(/^[^A-Za-z0-9]+/u, "")
    .slice(0, STEM_LIMIT)
    .replace(/[. ]+$/u, "");
  if (!stem) return "imported";
  return isWindowsReservedComponent(stem) ? `${stem}-snippets` : stem;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...new Set(value)] : null;
}

function readBodies(raw: unknown): Patch["bodies"] | null {
  if (!isRecord(raw)) return null;
  const bodies: Record<string, BodyNode[]> = {};
  for (const [key, text] of Object.entries(raw)) {
    if (!BODY_KEYS.includes(key) || typeof text !== "string") return null;
    const parsed = parseBody(text, { captures: true });
    if (parsed.errors.length > 0) return null;
    bodies[key] = parsed.nodes;
  }
  return bodies;
}

const PATCH_VALUES: Readonly<Record<Exclude<PatchKey, "bodies">, (value: unknown) => boolean>> = {
  trigger: (value) => value === null || typeof value === "string",
  expand: (value) => isOneOf(EXPANDS, value),
  place: (value) => isOneOf(PLACES, value),
  inWord: (value) => typeof value === "boolean",
  lineStart: (value) => typeof value === "boolean",
  priority: (value) => typeof value === "number" && Number.isFinite(value),
  languages: (value) =>
    value === "any" || (Array.isArray(value) && value.length > 0 && value.every((language) => isOneOf(SNIPPET_LANGUAGES, language))),
  name: (value) => typeof value === "string",
};

function readPatch(raw: unknown): Patch | null {
  if (!isRecord(raw)) return null;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "bodies") {
      const bodies = readBodies(value);
      if (!bodies) return null;
      patch.bodies = bodies;
    } else if (key in PATCH_VALUES && PATCH_VALUES[key as keyof typeof PATCH_VALUES](value)) {
      patch[key] = value;
    } else {
      return null;
    }
  }
  return patch as Patch;
}

function readOverride(raw: unknown): SnippetOverride | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.collection !== "string") return null;
  const override: SnippetOverride = { id: raw.id, collection: raw.collection };
  if (raw.patch !== undefined) {
    const patch = readPatch(raw.patch);
    if (!patch) return null;
    override.patch = patch;
  }
  if (raw.disabled !== undefined) {
    if (typeof raw.disabled !== "boolean") return null;
    if (raw.disabled) override.disabled = true;
  }
  return override;
}

function stateProblem(text: string, key: string, message: string): SnippetProblem {
  return { collection: STATE_COLLECTION, line: idLine(text, key), code: "bad-value", message, severity: "error" };
}

function readState(text: string): { state: SnippetState; problems: SnippetProblem[] } | SnippetProblem {
  const parsed = parseJsonc(text);
  if ("error" in parsed) {
    return { collection: STATE_COLLECTION, line: 1, code: "json", message: `Not valid JSON. ${parsed.error.message}`, severity: "error" };
  }
  if (!isRecord(parsed.value)) {
    return { collection: STATE_COLLECTION, line: 1, code: "not-object", message: "The snippet state file is a JSON object", severity: "error" };
  }
  const value = parsed.value;
  const problems: SnippetProblem[] = [];
  const list = (key: "disabledCollections" | "knownCollections" | "disabledRegex"): string[] => {
    if (value[key] === undefined) return [];
    const read = stringList(value[key]);
    if (!read) problems.push(stateProblem(text, key, `${key} is not a list of names, so it was left out`));
    return read ?? [];
  };
  const overrides: SnippetOverride[] = [];
  const rawOverrides = value.overrides ?? [];
  if (Array.isArray(rawOverrides)) {
    for (const [index, entry] of rawOverrides.entries()) {
      const override = readOverride(entry);
      if (override) overrides.push(override);
      else problems.push(stateProblem(text, "overrides", `Change ${index + 1} in overrides is not valid, so it was left out`));
    }
  } else {
    problems.push(stateProblem(text, "overrides", "overrides is not a list, so it was left out"));
  }
  return {
    state: {
      disabledCollections: list("disabledCollections"),
      knownCollections: list("knownCollections"),
      overrides,
      disabledRegex: list("disabledRegex"),
    },
    problems,
  };
}

function overrideJson(override: SnippetOverride): Record<string, unknown> {
  const json: Record<string, unknown> = { id: override.id, collection: override.collection };
  if (override.patch) {
    const { bodies, ...rest } = override.patch;
    json.patch = bodies
      ? { ...rest, bodies: Object.fromEntries(Object.entries(bodies).map(([key, nodes]) => [key, serializeBody(nodes as BodyNode[])])) }
      : rest;
  }
  if (override.disabled) json.disabled = true;
  return json;
}

function serializeSnippetState(state: SnippetState): string {
  const json = {
    disabledCollections: [...state.disabledCollections].sort(),
    knownCollections: [...state.knownCollections].sort(),
    disabledRegex: [...state.disabledRegex].sort(),
    overrides: state.overrides.map(overrideJson),
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

function packIndex(value: unknown): { file: string; collection: string; defaultOn: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is { file: string; collection: string; defaultOn: boolean } =>
      isRecord(entry) &&
      typeof entry.file === "string" &&
      PACK_FILE.test(entry.file) &&
      typeof entry.collection === "string" &&
      COLLECTION_ID.test(entry.collection) &&
      typeof entry.defaultOn === "boolean",
  );
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}${PACK_FOLDER}${path}`);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.text();
}

async function fetchPacks(): Promise<PackSet | null> {
  try {
    const index = parseJsonc(await fetchText("index.json"));
    const entries = "value" in index ? packIndex(index.value) : [];
    const texts = await Promise.all(entries.map((entry) => fetchText(entry.file)));
    return {
      files: entries.map((entry, index) => parseSnippetFile(texts[index], entry.collection, "pack")),
      defaultOff: entries.filter((entry) => !entry.defaultOn).map((entry) => entry.collection),
    };
  } catch (error) {
    void logError("load snippet packs", error);
    return null;
  }
}

function loadPacks(): Promise<PackSet | null> {
  fetchingPacks ??= fetchPacks().then((packs) => {
    if (!packs) fetchingPacks = null;
    return packs;
  });
  return fetchingPacks;
}

function readUserFile(entry: SnippetFileEntry, good: ParsedSnippetFile | null): DiskFile {
  const collection = collectionOf(entry.name);
  const base = { name: entry.name, modifiedMs: entry.modifiedMs, text: entry.text };
  const parsed: ParsedSnippetFile =
    entry.text === null
      ? { collection, records: [], problems: [unreadableProblem(collection, entry.name, entry.error)] }
      : parseUserFile(entry.name, entry.text);
  if (!wholeFileProblem(parsed)) return { ...base, parsed, good: parsed };
  return { ...base, parsed: good ? { ...good, problems: parsed.problems } : parsed, good };
}

function sameFiles(left: readonly DiskFile[], right: readonly DiskFile[]): boolean {
  return left.length === right.length && left.every((file, index) => file === right[index]);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function patchBetween(original: SnippetRecord, edited: SnippetRecord): Patch | null {
  const patch: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (!sameValue(original[key], edited[key])) patch[key] = edited[key];
  }
  return Object.keys(patch).length > 0 ? (patch as Patch) : null;
}

function sameOverride(override: SnippetOverride, id: string, collection: string): boolean {
  return override.id === id && override.collection === collection;
}

function rebuild(patch: Partial<Pick<SnippetStore, "files" | "state" | "stateProblems">>): void {
  const current = useSnippetStore.getState();
  const next = { files: current.files, state: current.state, stateProblems: current.stateProblems, ...patch };
  useSnippetStore.setState({ ...next, library: libraryOf(next.files, next.state, next.stateProblems) });
}

function readStateFile(entry: SnippetFileEntry, fallback: SnippetState): { state: SnippetState; problems: SnippetProblem[] } {
  const read = entry.text === null ? unreadableProblem(STATE_COLLECTION, entry.name, entry.error) : readState(entry.text);
  return "state" in read ? read : { state: fallback, problems: [read] };
}

function readDisk(entries: readonly SnippetFileEntry[], current: readonly DiskFile[], stateProblems: SnippetProblem[]): readonly DiskFile[] {
  const previous = new Map(current.map((file) => [file.name, file]));
  const disk = entries.map((entry): DiskFile => {
    const known = previous.get(entry.name);
    if (known && known.modifiedMs === entry.modifiedMs && known.text === entry.text) return known;
    if (entry.name !== STATE_FILE) return readUserFile(entry, known?.good ?? null);
    const parsed = { collection: STATE_COLLECTION, records: [], problems: stateProblems };
    return { name: entry.name, modifiedMs: entry.modifiedMs, text: entry.text, parsed, good: null };
  });
  return sameFiles(disk, current) ? current : disk;
}

async function refresh(force: boolean): Promise<void> {
  const packs = useSnippetStore.getState().packs ?? (await loadPacks());
  const entries = await listSnippetFiles();
  const current = useSnippetStore.getState();
  const defaults: SnippetState = { ...EMPTY_STATE, disabledCollections: [...(packs?.defaultOff ?? [])] };
  const stateEntry = entries.find((entry) => entry.name === STATE_FILE);
  const { state: stored, problems: stateProblems } = stateEntry
    ? readStateFile(stateEntry, current.status === "ready" ? current.state : defaults)
    : { state: defaults, problems: [] };
  const disk = readDisk(entries, current.disk, stateProblems);
  if (current.status === "ready" && disk === current.disk && packs === current.packs && !force) return;
  const state = withNewPackDefaults(stored, packs);
  const files = [
    ...bundledFiles(),
    ...(packs?.files ?? []),
    ...disk.filter((file) => file.name !== STATE_FILE).map((file) => file.parsed),
  ];
  useSnippetStore.setState({
    status: "ready",
    disk,
    packs,
    files,
    state,
    stateProblems,
    library: libraryOf(files, state, stateProblems),
  });
}

function watchFocus(): void {
  if (watching) return;
  watching = true;
  window.addEventListener("focus", () => {
    void useSnippetStore.getState().load();
  });
}

export function load(force = false): Promise<void> {
  watchFocus();
  const store = useSnippetStore.getState();
  if (store.status !== "ready" && store.files.length === 0) {
    const files = bundledFiles();
    useSnippetStore.setState({ status: "loading", files, library: libraryOf(files, store.state, []) });
  }
  if (loading && !force) return loading;
  const run = (loading ?? Promise.resolve()).catch(() => undefined).then(() => refresh(force));
  const tracked: Promise<void> = run.finally(() => {
    if (loading === tracked) loading = null;
  });
  loading = tracked;
  return tracked;
}

function queued<T>(change: () => Promise<T>): Promise<T> {
  const run = writing.then(async () => {
    await load(true);
    return change();
  });
  writing = run.catch(() => undefined);
  return run;
}

async function afterWrite(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } finally {
    await load(true).catch((error: unknown) => logError("load snippets", error));
  }
}

function withNewPackDefaults(state: SnippetState, packs: PackSet | null): SnippetState {
  const known = new Set(state.knownCollections);
  const added = (packs?.defaultOff ?? []).filter(
    (collection) => !known.has(collection) && !state.disabledCollections.includes(collection),
  );
  return added.length ? { ...state, disabledCollections: [...state.disabledCollections, ...added] } : state;
}

function refused(file: DiskFile): Promise<never> {
  return Promise.reject(new Error(`${file.name} has problems to fix before it can be changed here`));
}

function writeState(next: SnippetState): Promise<void> {
  const store = useSnippetStore.getState();
  const file = store.disk.find((candidate) => candidate.name === STATE_FILE);
  if (file && wholeFileProblem(file.parsed)) return refused(file);
  const state = store.packs ? { ...next, knownCollections: store.packs.files.map((pack) => pack.collection) } : next;
  rebuild({ state });
  return afterWrite(() => writeSnippetFile(STATE_FILE, serializeSnippetState(state)));
}

function userFile(collection: string): DiskFile | undefined {
  return useSnippetStore.getState().disk.find((file) => file.name !== STATE_FILE && collectionOf(file.name) === collection);
}

function writeUserRecords(collection: string, change: (records: SnippetRecord[]) => SnippetRecord[]): Promise<void> {
  const disk = userFile(collection);
  if (disk?.parsed.problems.some((problem) => problem.severity === "error")) return refused(disk);
  const text = serializeSnippetFile(change([...(disk?.parsed.records ?? [])]), disk?.parsed.header);
  return afterWrite(() => writeSnippetFile(`${collection}.json`, text));
}

function findOverride(id: string, collection: string): SnippetOverride | undefined {
  return useSnippetStore.getState().state.overrides.find((override) => sameOverride(override, id, collection));
}

function applyOverride(change: OverrideChange): Promise<void> {
  const state = useSnippetStore.getState().state;
  const overrides = state.overrides.filter((override) => !sameOverride(override, change.id, change.collection));
  if (!("clear" in change)) overrides.push(change);
  return writeState({ ...state, overrides });
}

async function applyRecord(collection: string, record: SnippetRecord): Promise<void> {
  const file = useSnippetStore.getState().files.find((candidate) => candidate.collection === collection);
  const original = file?.records.find((candidate) => candidate.id === record.id);
  if (original && original.layer !== "user") {
    const disabled = findOverride(record.id, collection)?.disabled === true;
    const patch = patchBetween(original, record);
    if (!patch && !disabled) return applyOverride({ id: record.id, collection, clear: true });
    return applyOverride({ id: record.id, collection, ...(patch ? { patch } : {}), ...(disabled ? { disabled } : {}) });
  }
  if (file && !userFile(collection)) throw new Error(`${collection} is not a collection of your own snippets`);
  const saved: SnippetRecord = { ...record, collection, layer: "user" };
  return writeUserRecords(collection, (records) => {
    const index = records.findIndex((candidate) => candidate.id === record.id);
    if (index < 0) return [...records, saved];
    records[index] = saved;
    return records;
  });
}

export function setOverride(change: OverrideChange): Promise<void> {
  return queued(() => applyOverride(change));
}

export function saveRecord(collection: string, record: SnippetRecord): Promise<void> {
  return queued(() => applyRecord(collection, record));
}

export function deleteRecord(collection: string, id: string): Promise<void> {
  return queued(() => {
    if (userFile(collection)) return writeUserRecords(collection, (records) => records.filter((record) => record.id !== id));
    return applyOverride({ ...(findOverride(id, collection) ?? { id, collection }), disabled: true });
  });
}

export function setCollectionEnabled(collection: string, enabled: boolean): Promise<void> {
  return queued(async () => {
    const state = useSnippetStore.getState().state;
    const others = state.disabledCollections.filter((name) => name !== collection);
    const disabledCollections = enabled ? others : [...others, collection];
    if (sameValue(disabledCollections, state.disabledCollections)) return;
    return writeState({ ...state, disabledCollections });
  });
}

export function importVsCodeFile(fileName: string, text: string): Promise<ParsedSnippetFile> {
  return queued(async () => {
    const store = useSnippetStore.getState();
    const taken = new Set([
      ...store.files.map((file) => file.collection.toLowerCase()),
      ...store.disk.map((file) => collectionOf(file.name).toLowerCase()),
    ]);
    const name = numberedPath(`${fileStem(fileName)}.json`, (candidate) => taken.has(collectionOf(candidate).toLowerCase()));
    const parsed = parseUserFile(name, text);
    if (parsed.records.length === 0) return parsed;
    await afterWrite(() => writeSnippetFile(name, text));
    return parsed;
  });
}

export function disableRegex(id: string): Promise<void> {
  return queued(async () => {
    const state = useSnippetStore.getState().state;
    if (state.disabledRegex.includes(id)) return;
    return writeState({ ...state, disabledRegex: [...state.disabledRegex, id] });
  });
}

export function importSnippetSettingsFiles(files: readonly SnippetFileText[]): Promise<void> {
  return queued(() => {
    const existing = new Map(useSnippetStore.getState().disk.map((file) => [file.name.toLowerCase(), file.name]));
    return afterWrite(async () => {
      for (const file of files) await writeSnippetFile(existing.get(file.name.toLowerCase()) ?? file.name, file.text);
    });
  });
}

import { i18n } from "@/i18n";
import { formatList } from "@/lib/intl";
import type { EditorView } from "@codemirror/view";
import { editBackgroundDocument, type BackgroundDocumentChange } from "@oleafly/editor";
import { useIndexStore } from "@/store/project-index";
import { useFilesStore } from "@/store/files";
import { projectFolderIsReadOnly, readOnlyFolderMessage } from "@/store/folder-access";
import { isReadOnlyProjectPath } from "@/lib/project-paths";
import { useReferencesStore } from "@/store/references";
import { useRenameStore } from "@/store/rename";
import { useSettingsStore } from "@/store/settings";
import {
  acceptedProjectSnapshot,
  currentSourceProjectIntelligence,
} from "@/lib/project-intelligence/current";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import {
  definitionsForUse,
  referencesFor,
  symbolAt,
} from "@/lib/project-intelligence/selectors";
import type {
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
  ProjectUse,
} from "@/lib/project-intelligence/types";
import { toast } from "@/lib/toast";
import type { DefKind, Edit, ProjectIndex, RenamePlan, Sym } from "./types";
import { projectIntelligenceReasonText } from "@/lib/project-intelligence/reason";
import {
  currentInteractiveDocument,
  interactiveRequestStillCurrent,
  type CurrentInteractiveDocument,
} from "@/lib/analysis/interactive-document";
import type { InteractiveLanguageServiceSession } from "@/lib/analysis/interactive-language-service";
import {
  locationsFromValue,
  offsetEdits,
  offsetRange,
  projectPathForUri,
  workspaceEditFromValue,
  type LanguageServiceLocation,
  type OffsetRange,
  type WorkspaceEditOperation,
} from "@/lib/analysis/language-service-results";
import type { LanguageServiceFeature } from "@/lib/language-service";
import {
  isLanguageServiceCancellation,
  isLanguageServiceStaleError,
} from "@/lib/language-service/errors";
import { JsonRpcRemoteError } from "@/lib/language-service/json-rpc";
import { TextPositionIndex } from "@/lib/language-service/position";
import { openProjectLocation } from "@/lib/open-location";
import type { ReferenceLocation, ReferenceQueryMode } from "@/store/references";

export const NAVIGATION_LOOKUP_TOAST_KEY = "navigation:lookup";

export type RenameOutcome =
  | "renamed"
  | "partial"
  | "collision"
  | "unchanged"
  | "skipped";

const RENAMABLE = new Set<DefKind>(["label", "macro", "bibentry", "theorem", "glossary", "environment"]);

// Flushes the active file into the index first (pure, fast) so offsets are current
// before looking up the cursor token.
function legacySymbolAtCursor(view: EditorView): Sym | null {
  const path = useFilesStore.getState().activePath;
  if (!path) return null;
  useIndexStore.getState().updateFile(path, view.state.doc.toString());
  const index = useIndexStore.getState().index;
  return index?.symbolAt(path, view.state.selection.main.head) ?? null;
}

function isUse(
  symbol: ProjectDefinition | ProjectUse,
): symbol is ProjectUse {
  return "definitionIds" in symbol;
}

function intelligenceAtCursor(view: EditorView): {
  snapshot: ProjectIntelligenceSnapshot;
  symbol: ProjectDefinition | ProjectUse | null;
} | null {
  const current = currentSourceProjectIntelligence(
    view.state.doc.toString(),
  );
  if (!current) return null;
  const offset = view.state.selection.main.head;
  const symbol =
    symbolAt(current.snapshot, current.path, offset) ??
    (offset > 0
      ? symbolAt(current.snapshot, current.path, offset - 1)
      : null);
  return { snapshot: current.snapshot, symbol };
}

function showReferenceQuery(
  snapshot: ProjectIntelligenceSnapshot,
  mode: "references" | "definitions",
  targetId: string,
  title: string,
) {
  useReferencesStore.getState().show({
    ...snapshot.identity,
    mode,
    targetId,
    title,
  });
  const settings = useSettingsStore.getState();
  settings.setRailTab("refs");
  if (!settings.showTree) settings.toggleTree();
}

export function showLookupResult(message: string): void {
  toast.infoUnique(NAVIGATION_LOOKUP_TOAST_KEY, message);
}

function analysisIsUpdating(
  state: ProjectIntelligenceState,
  editorText: string | undefined,
): boolean {
  if (state.status === "running" || state.stale) return true;
  const files = useFilesStore.getState();
  const path = files.activePath;
  if (!path) return false;
  const snapshot = acceptedProjectSnapshot(state, files.projectId);
  if (snapshot?.fileStates[path] === undefined) return false;
  const text = editorText ?? files.files[path]?.content;
  return text !== undefined && useIndexStore.getState().texts[path] !== text;
}

export function explainMissingAnalysis(
  editorText?: string,
  editPending = false,
): boolean {
  const state = useIndexStore.getState().intelligenceState;
  if (state.status === "error" || state.status === "unavailable") {
    toast.errorUnique(
      NAVIGATION_LOOKUP_TOAST_KEY,
      projectIntelligenceReasonText(state.failure?.reason) ??
        projectIntelligenceReasonText(state.reason) ??
        i18n.t(($) => $.core.navigation.analysisUnavailable),
    );
    return true;
  }
  if (!editPending && !analysisIsUpdating(state, editorText)) return false;
  showLookupResult(i18n.t(($) => $.core.navigation.analysisUpdating));
  return true;
}

const SYMBOL_START = /[\\@<]/g;
const COMMAND_LIKE = /^\\[A-Za-z@]+\*?(?:\[[^\]\n]*\])?(?:\{[^}\n]*\}?)?/;
const KEY_LIKE = /^(?:@[\w:.-]+|<[\w:.-]+>)/;

function symbolLikeLengthAt(text: string, start: number): number {
  const rest = text.slice(start);
  const pattern = rest.startsWith("\\") ? COMMAND_LIKE : KEY_LIKE;
  return pattern.exec(rest)?.[0].length ?? 0;
}

export function symbolLikeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let end = 0;
  for (const { index } of text.matchAll(SYMBOL_START)) {
    if (index < end) continue;
    const length = symbolLikeLengthAt(text, index);
    if (length === 0) continue;
    end = index + length;
    ranges.push([index, end]);
  }
  return ranges;
}

function cursorOnSymbolLikeText(view: EditorView): boolean {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const column = head - line.from;
  return symbolLikeRanges(line.text).some(([start, end]) => column >= start && column <= end);
}

export type LookupSource = "keyboard" | "pointer";

function explainMissingAnalysisAt(view: EditorView, source: LookupSource): boolean {
  const { status } = useIndexStore.getState().intelligenceState;
  const failed = status === "error" || status === "unavailable";
  if (!failed && (source === "pointer" || !cursorOnSymbolLikeText(view))) return false;
  return explainMissingAnalysis(view.state.doc.toString());
}

function definitionsForSymbol(
  snapshot: ProjectIntelligenceSnapshot,
  symbol: ProjectDefinition | ProjectUse,
): readonly ProjectDefinition[] {
  return isUse(symbol)
    ? definitionsForUse(snapshot, symbol.id)
    : [symbol];
}

const TYPST_PATH = /\.typ$/i;
const LANGUAGE_SERVICE_LOOKUP_TIMEOUT_MS = 5_000;
const LANGUAGE_SERVICE_RENAME_TIMEOUT_MS = 10_000;
const MAX_PREVIEW_LENGTH = 160;

function typstLanguageService(
  view: EditorView,
  feature: LanguageServiceFeature,
): CurrentInteractiveDocument | null {
  const path = useFilesStore.getState().activePath;
  if (!path || !TYPST_PATH.test(path)) return null;
  const current = currentInteractiveDocument(path, view.state.doc.toString());
  return current?.session.client.supports(feature) ? current : null;
}

function cursorPosition(current: CurrentInteractiveDocument, offset: number) {
  return new TextPositionIndex(current.document.text).offsetToPosition(
    offset,
    current.session.positionEncoding,
  );
}

function lookupOptions(current: CurrentInteractiveDocument, timeoutMs: number) {
  return {
    timeoutMs,
    projectRevision: current.session.projectRevision,
    documentUri: current.document.uri,
    documentVersion: current.document.version,
  };
}

function projectText(
  session: InteractiveLanguageServiceSession,
  path: string,
): string | undefined {
  return (
    session.documentForPath(path)?.text ??
    useFilesStore.getState().files[path]?.content ??
    useIndexStore.getState().texts[path]
  );
}

function wordAt(text: string, offset: number): OffsetRange | null {
  const word = /[\p{L}\p{N}_.-]/u;
  let from = offset;
  let to = offset;
  while (from > 0 && word.test(text[from - 1])) from -= 1;
  while (to < text.length && word.test(text[to])) to += 1;
  return to > from ? { from, to } : null;
}

interface ResolvedLocation extends ReferenceLocation {
  location: LanguageServiceLocation;
}

function resolveLocation(
  session: InteractiveLanguageServiceSession,
  location: LanguageServiceLocation,
): ResolvedLocation | null {
  const root = session.client.workspaceRoot;
  const path = root ? projectPathForUri(root, location.uri) : null;
  if (!path) return null;
  const line = location.range.start.line + 1;
  const column = location.range.start.character + 1;
  const text = projectText(session, path);
  const range =
    text === undefined
      ? null
      : offsetRange(location.range, new TextPositionIndex(text), session.positionEncoding);
  const lineText = text?.split("\n")[location.range.start.line] ?? "";
  return {
    path,
    from: range?.from ?? -1,
    to: range?.to ?? -1,
    line,
    column,
    preview: lineText.trim().slice(0, MAX_PREVIEW_LENGTH),
    location,
  };
}

function openResolvedLocation(target: ResolvedLocation): void {
  if (target.from >= 0) {
    void navigateToProjectRange({
      path: target.path,
      range: { from: target.from, to: target.to },
      source: "editor",
    });
    return;
  }
  void openProjectLocation(
    { path: target.path, line: target.line, column: target.column },
    { pdfView: "editor" },
  );
}

function showLocationQuery(
  mode: ReferenceQueryMode,
  locations: readonly ResolvedLocation[],
  title: string,
): void {
  const identity = useIndexStore.getState().intelligenceState.identity;
  const projectId = useFilesStore.getState().projectId;
  if (!identity || identity.projectId !== projectId) {
    openResolvedLocation(locations[0]);
    return;
  }
  useReferencesStore.getState().show({
    projectId: identity.projectId,
    projectRevision: identity.projectRevision,
    requestGeneration: identity.requestGeneration,
    mode,
    targetId: "",
    title,
    locations: locations
      .filter((location) => location.from >= 0)
      .map(({ location: _location, ...reference }) => reference),
  });
  const settings = useSettingsStore.getState();
  settings.setRailTab("refs");
  if (!settings.showTree) settings.toggleTree();
}

function languageServiceFailureFallsBack(error: unknown): boolean {
  return !isLanguageServiceStaleError(error) && !isLanguageServiceCancellation(error);
}

async function languageServiceDefinition(
  view: EditorView,
  current: CurrentInteractiveDocument,
  source: LookupSource,
): Promise<void> {
  const offset = view.state.selection.main.head;
  const text = current.document.text;
  let response: unknown;
  try {
    response = await current.session.client.requestDefinition(
      {
        textDocument: { uri: current.document.uri },
        position: cursorPosition(current, offset),
      },
      lookupOptions(current, LANGUAGE_SERVICE_LOOKUP_TIMEOUT_MS),
    );
  } catch (error) {
    if (languageServiceFailureFallsBack(error)) localGoToDefinition(view, source);
    return;
  }
  if (!interactiveRequestStillCurrent(current.session, current.document, text)) return;
  const locations = locationsFromValue(response)
    .map((location) => resolveLocation(current.session, location))
    .filter((location): location is ResolvedLocation => location !== null);
  if (locations.length === 0) {
    localGoToDefinition(view, source);
    return;
  }
  const [first] = locations;
  if (
    locations.length === 1 &&
    first.path === current.document.path &&
    offset >= first.from &&
    offset <= first.to
  ) {
    findReferences(view);
    return;
  }
  if (locations.length === 1) {
    openResolvedLocation(first);
    return;
  }
  const name = wordAt(text, offset);
  showLocationQuery(
    "definitions",
    locations,
    i18n.t(($) => $.core.navigation.definitionsFor, {
      name: name ? text.slice(name.from, name.to) : first.preview,
    }),
  );
}

async function languageServiceReferences(
  view: EditorView,
  current: CurrentInteractiveDocument,
): Promise<void> {
  const offset = view.state.selection.main.head;
  const text = current.document.text;
  let response: unknown;
  try {
    response = await current.session.client.requestReferences(
      {
        textDocument: { uri: current.document.uri },
        position: cursorPosition(current, offset),
        context: { includeDeclaration: true },
      },
      lookupOptions(current, LANGUAGE_SERVICE_LOOKUP_TIMEOUT_MS),
    );
  } catch (error) {
    if (languageServiceFailureFallsBack(error)) localFindReferences(view);
    return;
  }
  if (!interactiveRequestStillCurrent(current.session, current.document, text)) return;
  const locations = locationsFromValue(response)
    .map((location) => resolveLocation(current.session, location))
    .filter((location): location is ResolvedLocation => location !== null);
  if (locations.length === 0) {
    localFindReferences(view);
    return;
  }
  const name = wordAt(text, offset);
  showLocationQuery(
    "references",
    locations,
    i18n.t(($) => $.core.navigation.referencesFor, {
      name: name ? text.slice(name.from, name.to) : locations[0].preview,
    }),
  );
}

export function goToDefinition(view: EditorView, source: LookupSource = "keyboard"): boolean {
  const lsp = typstLanguageService(view, "definition");
  if (lsp) {
    void languageServiceDefinition(view, lsp, source);
    return true;
  }
  return localGoToDefinition(view, source);
}

function localGoToDefinition(view: EditorView, source: LookupSource): boolean {
  const current = intelligenceAtCursor(view);
  if (!current) return explainMissingAnalysisAt(view, source);
  const { snapshot, symbol } = current;
  if (!symbol) return false;
  // On a definition, F12 acts as find-references (IDE convention).
  if (!isUse(symbol)) return findReferences(view);

  const definitions = definitionsForUse(snapshot, symbol.id);
  if (definitions.length === 0) {
    showLookupResult(
      i18n.t(($) => $.core.navigation.noDefinition, { name: symbol.name }),
    );
    return true;
  }
  if (definitions.length > 1) {
    showReferenceQuery(
      snapshot,
      "definitions",
      symbol.id,
      i18n.t(($) => $.core.navigation.definitionsFor, { name: symbol.name }),
    );
    return true;
  }
  const definition = definitions[0];
  void navigateToProjectRange({
    path: definition.location.file,
    range: definition.location.range,
    source: "editor",
  });
  return true;
}

export function findReferences(view: EditorView): boolean {
  const lsp = typstLanguageService(view, "references");
  if (lsp) {
    void languageServiceReferences(view, lsp);
    return true;
  }
  return localFindReferences(view);
}

function localFindReferences(view: EditorView): boolean {
  const current = intelligenceAtCursor(view);
  if (!current) return explainMissingAnalysisAt(view, "keyboard");
  const { snapshot, symbol } = current;
  if (!symbol) return false;
  const definitions = definitionsForSymbol(snapshot, symbol);
  if (definitions.length === 0) {
    showLookupResult(
      i18n.t(($) => $.core.navigation.noDefinition, { name: symbol.name }),
    );
    return true;
  }
  if (definitions.length > 1 && isUse(symbol)) {
    showReferenceQuery(
      snapshot,
      "definitions",
      symbol.id,
      i18n.t(($) => $.core.navigation.definitionsFor, { name: symbol.name }),
    );
    return true;
  }
  const definition = definitions[0];
  const references = referencesFor(snapshot, definition.id);
  if (references.length === 0) {
    showLookupResult(
      i18n.t(($) => $.core.navigation.noReferences, { name: definition.name }),
    );
    return true;
  }
  showReferenceQuery(
    snapshot,
    "references",
    definition.id,
    i18n.t(($) => $.core.navigation.referencesFor, { name: definition.name }),
  );
  return true;
}

interface LanguageServiceRenameTarget {
  current: CurrentInteractiveDocument;
  offset: number;
}

const languageServiceRenames = new WeakMap<Sym, LanguageServiceRenameTarget>();

function prepareRenameRange(
  value: unknown,
  current: CurrentInteractiveDocument,
  offset: number,
): { range: OffsetRange; placeholder: string | null } | "default" | null {
  if (value === null || value === undefined) return null;
  const record =
    typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!record) return null;
  if (record.defaultBehavior === true) return "default";
  const index = new TextPositionIndex(current.document.text);
  const encoding = current.session.positionEncoding;
  const range =
    offsetRange(record.range, index, encoding) ?? offsetRange(record, index, encoding);
  if (!range || offset < range.from || offset > range.to) return null;
  return {
    range,
    placeholder: typeof record.placeholder === "string" ? record.placeholder : null,
  };
}

async function startLanguageServiceRename(
  view: EditorView,
  current: CurrentInteractiveDocument,
): Promise<void> {
  const offset = view.state.selection.main.head;
  const text = current.document.text;
  let prepared: ReturnType<typeof prepareRenameRange> = "default";
  if (current.session.client.supports("prepareRename")) {
    try {
      prepared = prepareRenameRange(
        await current.session.client.requestPrepareRename(
          {
            textDocument: { uri: current.document.uri },
            position: cursorPosition(current, offset),
          },
          lookupOptions(current, LANGUAGE_SERVICE_LOOKUP_TIMEOUT_MS),
        ),
        current,
        offset,
      );
    } catch (error) {
      if (languageServiceFailureFallsBack(error)) startLocalRenameOrExplain(view);
      return;
    }
  }
  if (!interactiveRequestStillCurrent(current.session, current.document, text)) return;
  if (prepared === null) {
    startLocalRenameOrExplain(view);
    return;
  }
  const range = prepared === "default" ? wordAt(text, offset) : prepared.range;
  if (!range) {
    startLocalRenameOrExplain(view);
    return;
  }
  const name =
    (prepared === "default" ? null : prepared.placeholder) ??
    text.slice(range.from, range.to);
  const sym: Sym = {
    kind: "label",
    name,
    file: current.document.path,
    line: text.slice(0, range.from).split("\n").length,
    from: range.from,
    to: range.to,
    nameFrom: range.from,
    nameTo: range.to,
  };
  languageServiceRenames.set(sym, { current, offset });
  useRenameStore.getState().open(sym);
}

function startLocalRenameOrExplain(view: EditorView): void {
  if (!startLocalRename(view)) {
    showLookupResult(i18n.t(($) => $.core.navigation.notRenamable));
  }
}

export function renamePreview(
  index: ProjectIndex | null,
  sym: Sym,
  newName: string,
): RenamePlan | null {
  if (languageServiceRenames.has(sym)) return null;
  return index && newName && newName !== sym.name ? index.renamePlan(sym, newName) : null;
}

export function startRename(view: EditorView): boolean {
  const lsp = typstLanguageService(view, "rename");
  if (lsp) {
    if (projectFolderIsReadOnly(useFilesStore.getState().projectId)) {
      showLookupResult(readOnlyFolderMessage());
      return true;
    }
    void startLanguageServiceRename(view, lsp);
    return true;
  }
  return startLocalRename(view);
}

function startLocalRename(view: EditorView): boolean {
  const sym = legacySymbolAtCursor(view);
  if (!sym) return false;
  if (projectFolderIsReadOnly(useFilesStore.getState().projectId)) {
    showLookupResult(readOnlyFolderMessage());
    return true;
  }
  const index = useIndexStore.getState().index;
  const def = (index?.definitionFor(sym) ?? sym) as Sym;
  if (!RENAMABLE.has(def.kind as DefKind)) {
    showLookupResult(i18n.t(($) => $.core.navigation.notRenamable));
    return true;
  }
  useRenameStore.getState().open(def);
  return true;
}

function groupEditsByFile(edits: readonly Edit[]): Map<string, Edit[]> {
  const byFile = new Map<string, Edit[]>();
  for (const e of edits) {
    const arr = byFile.get(e.file) ?? [];
    arr.push(e);
    byFile.set(e.file, arr);
  }
  return byFile;
}

function applyEditsToText(base: string, edits: readonly Edit[]): string {
  let text = base;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, e.from) + e.newText + text.slice(e.to);
  }
  return text;
}

function ascendingChanges(edits: readonly Edit[]): BackgroundDocumentChange[] {
  return [...edits]
    .sort((a, b) => a.from - b.from)
    .map((e) => ({ from: e.from, to: e.to, insert: e.newText }));
}

async function writeRenamedFile(
  files: ReturnType<typeof useFilesStore.getState>,
  projectId: string | null,
  file: string,
  base: string,
  edits: readonly Edit[],
): Promise<"edited" | "ignored" | "failed"> {
  const text = applyEditsToText(base, edits);
  if (files.files[file] !== undefined) {
    if (!files.setContent(file, text)) return "failed";
    editBackgroundDocument(file, base, ascendingChanges(edits));
    return "edited";
  }
  if (!projectId) return "ignored";
  try {
    await useFilesStore.getState().writeProjectFile(projectId, file, text);
    return "edited";
  } catch {
    return "failed";
  }
}

interface RenameWriteResult {
  editedFiles: number;
  editedCount: number;
  unwritten: string[];
}

type RenameFileOutcome = "edited" | "ignored" | "failed";

interface RenameWriteContext {
  readonly view: EditorView;
  readonly files: ReturnType<typeof useFilesStore.getState>;
  readonly baseFor: (file: string) => string | undefined;
}

function inSequence<T>(items: readonly T[], task: (item: T) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>((chain, item) => chain.then(() => task(item)), Promise.resolve());
}

function writeRenameFile(
  context: RenameWriteContext,
  file: string,
  edits: readonly Edit[],
): Promise<RenameFileOutcome> {
  const { view, files, baseFor } = context;
  if (isReadOnlyProjectPath(file, files.manifestHome, files.tree)) return Promise.resolve("failed");
  if (file === files.activePath) {
    // Edit the live editor so the view updates; CM wants ascending, non-overlapping changes.
    view.dispatch({ changes: ascendingChanges(edits) });
    return Promise.resolve("edited");
  }
  const base = baseFor(file);
  if (base === undefined) return Promise.resolve("ignored");
  return writeRenamedFile(files, files.projectId, file, base, edits);
}

async function writeRenameEdits(
  view: EditorView,
  edits: readonly Edit[],
  baseFor: (file: string) => string | undefined,
): Promise<RenameWriteResult> {
  const context: RenameWriteContext = { view, files: useFilesStore.getState(), baseFor };
  const result: RenameWriteResult = { editedFiles: 0, editedCount: 0, unwritten: [] };
  await inSequence([...groupEditsByFile(edits)], async ([file, fileEdits]) => {
    const outcome = await writeRenameFile(context, file, fileEdits);
    if (outcome === "failed") result.unwritten.push(file);
    else if (outcome === "edited") {
      result.editedFiles++;
      result.editedCount += fileEdits.length;
    }
  });
  return result;
}

function reportRename(
  newName: string,
  result: RenameWriteResult,
  totalFiles: number,
): RenameOutcome {
  if (result.unwritten.length > 0) {
    toast.error(
      i18n.t(($) => $.core.navigation.renamePartial, {
        name: newName,
        edited: result.editedFiles,
        total: totalFiles,
        files: formatList(result.unwritten),
      }),
    );
    return "partial";
  }
  toast.success(
    i18n.t(($) => $.core.navigation.renamed, {
      name: newName,
      edits: result.editedCount,
      files: result.editedFiles,
    }),
  );
  return "renamed";
}

function appTextFor(path: string): string | undefined {
  return (
    useFilesStore.getState().files[path]?.content ??
    useIndexStore.getState().texts[path]
  );
}

interface LanguageServiceRenamePlan {
  edits: Edit[];
  bases: Map<string, string>;
  moves: Array<{ from: string; to: string }>;
  skipped: string[];
}

function planFileMove(
  plan: LanguageServiceRenamePlan,
  root: string,
  operation: Extract<WorkspaceEditOperation, { kind: "rename" }>,
): void {
  const from = projectPathForUri(root, operation.oldUri);
  const to = projectPathForUri(root, operation.newUri);
  if (from && to) plan.moves.push({ from, to });
  else plan.skipped.push(from ?? operation.oldUri);
}

function planFileEdits(
  plan: LanguageServiceRenamePlan,
  current: CurrentInteractiveDocument,
  root: string,
  operation: Extract<WorkspaceEditOperation, { kind: "edit" }>,
): void {
  const path = projectPathForUri(root, operation.uri);
  const base = path ? projectText(current.session, path) : undefined;
  const converted =
    path && base !== undefined && base === appTextFor(path)
      ? offsetEdits(operation.edits, base, current.session.positionEncoding)
      : null;
  if (!path || base === undefined || !converted) {
    plan.skipped.push(path ?? operation.uri);
    return;
  }
  plan.bases.set(path, base);
  for (const edit of converted) {
    plan.edits.push({ file: path, from: edit.from, to: edit.to, newText: edit.insert });
  }
}

function languageServiceRenamePlan(
  current: CurrentInteractiveDocument,
  value: unknown,
): LanguageServiceRenamePlan | null {
  const parsed = workspaceEditFromValue(value);
  const root = current.session.client.workspaceRoot;
  if (!parsed || parsed.unsupported || !root) return null;
  const plan: LanguageServiceRenamePlan = {
    edits: [],
    bases: new Map(),
    moves: [],
    skipped: [],
  };
  for (const operation of parsed.operations) {
    if (operation.kind === "rename") planFileMove(plan, root, operation);
    else planFileEdits(plan, current, root, operation);
  }
  return plan;
}

async function moveRenamedFiles(
  moves: readonly { from: string; to: string }[],
  unwritten: string[],
): Promise<number> {
  let moved = 0;
  await inSequence(moves, async (move) => {
    try {
      await useFilesStore.getState().renameEntry(move.from, move.to);
      moved++;
    } catch {
      unwritten.push(move.from);
    }
  });
  return moved;
}

async function applyLanguageServiceRename(
  view: EditorView,
  target: LanguageServiceRenameTarget,
  newName: string,
): Promise<RenameOutcome> {
  const { current, offset } = target;
  let response: unknown;
  try {
    response = await current.session.client.requestRename(
      {
        textDocument: { uri: current.document.uri },
        position: cursorPosition(current, offset),
        newName,
      },
      lookupOptions(current, LANGUAGE_SERVICE_RENAME_TIMEOUT_MS),
    );
  } catch (error) {
    if (error instanceof JsonRpcRemoteError) {
      toast.error(i18n.t(($) => $.core.navigation.renameFailed, { name: newName }));
    } else {
      showLookupResult(i18n.t(($) => $.core.navigation.analysisUpdating));
    }
    return "skipped";
  }
  if (!interactiveRequestStillCurrent(current.session, current.document, view.state.doc.toString())) {
    showLookupResult(i18n.t(($) => $.core.navigation.analysisUpdating));
    return "skipped";
  }
  const plan = languageServiceRenamePlan(current, response);
  if (!plan) {
    toast.error(i18n.t(($) => $.core.navigation.renameFailed, { name: newName }));
    return "skipped";
  }
  if (plan.edits.length === 0 && plan.moves.length === 0) {
    toast.info(i18n.t(($) => $.core.navigation.nothingToRename));
    return "unchanged";
  }
  const result = await writeRenameEdits(view, plan.edits, (file) => plan.bases.get(file));
  result.unwritten.push(...plan.skipped);
  const moved = await moveRenamedFiles(plan.moves, result.unwritten);
  result.editedFiles += moved;
  await useIndexStore.getState().rebuildFromDisk();
  const totalFiles =
    new Set(plan.edits.map((edit) => edit.file)).size + plan.moves.length + plan.skipped.length;
  return reportRename(newName, result, totalFiles);
}

// Edits are applied against the exact text the index was built from (the cache), so
// offsets are always valid. The active file is edited through the editor (so it
// updates live); other files via the store / disk.
export async function applyRename(
  view: EditorView,
  sym: Sym,
  newName: string,
): Promise<RenameOutcome> {
  if (projectFolderIsReadOnly(useFilesStore.getState().projectId)) {
    toast.error(readOnlyFolderMessage());
    return "skipped";
  }
  const languageServiceTarget = languageServiceRenames.get(sym);
  if (languageServiceTarget) {
    return applyLanguageServiceRename(view, languageServiceTarget, newName);
  }
  const store = useIndexStore.getState();
  const index = store.index;
  if (!index) return "skipped";
  const plan = index.renamePlan(sym, newName);
  if (plan.collision) {
    toast.error(i18n.t(($) => $.core.navigation.nameExists, { name: newName }));
    return "collision";
  }
  if (plan.edits.length === 0) {
    toast.info(i18n.t(($) => $.core.navigation.nothingToRename));
    return "unchanged";
  }

  const result = await writeRenameEdits(view, plan.edits, (file) => store.texts[file]);

  await store.rebuildFromDisk();
  return reportRename(newName, result, plan.fileCount);
}

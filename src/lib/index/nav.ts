import { i18n } from "@/i18n";
import { formatList } from "@/lib/intl";
import type { EditorView } from "@codemirror/view";
import { useIndexStore } from "@/store/project-index";
import { useFilesStore } from "@/store/files";
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
import type { DefKind, Edit, Sym } from "./types";
import { projectIntelligenceReasonText } from "@/lib/project-intelligence/reason";

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

export function goToDefinition(view: EditorView, source: LookupSource = "keyboard"): boolean {
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

export function startRename(view: EditorView): boolean {
  const sym = legacySymbolAtCursor(view);
  if (!sym) return false;
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

async function writeRenamedFile(
  files: ReturnType<typeof useFilesStore.getState>,
  projectId: string | null,
  file: string,
  text: string,
): Promise<"edited" | "ignored" | "failed"> {
  if (files.files[file] !== undefined) {
    files.setContent(file, text);
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

// Edits are applied against the exact text the index was built from (the cache), so
// offsets are always valid. The active file is edited through the editor (so it
// updates live); other files via the store / disk.
export async function applyRename(
  view: EditorView,
  sym: Sym,
  newName: string,
): Promise<RenameOutcome> {
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

  const files = useFilesStore.getState();
  const id = files.projectId;
  const activePath = files.activePath;

  const byFile = groupEditsByFile(plan.edits);

  const unwritten: string[] = [];
  let editedFiles = 0;
  let editedCount = 0;
  for (const [file, edits] of byFile) {
    if (file === activePath) {
      // Edit the live editor so the view updates; CM wants ascending, non-overlapping changes.
      const asc = [...edits].sort((a, b) => a.from - b.from);
      view.dispatch({ changes: asc.map((e) => ({ from: e.from, to: e.to, insert: e.newText })) });
      editedFiles++;
      editedCount += edits.length;
      continue;
    }
    const base = store.texts[file];
    if (base === undefined) continue;
    const outcome = await writeRenamedFile(
      files,
      id,
      file,
      applyEditsToText(base, edits),
    );
    if (outcome === "failed") unwritten.push(file);
    else if (outcome === "edited") {
      editedFiles++;
      editedCount += edits.length;
    }
  }

  await store.rebuildFromDisk();
  if (unwritten.length > 0) {
    toast.error(
      i18n.t(($) => $.core.navigation.renamePartial, {
        name: newName,
        edited: editedFiles,
        total: plan.fileCount,
        files: formatList(unwritten),
      }),
    );
    return "partial";
  }
  toast.success(
    i18n.t(($) => $.core.navigation.renamed, {
      name: newName,
      edits: editedCount,
      files: editedFiles,
    }),
  );
  return "renamed";
}

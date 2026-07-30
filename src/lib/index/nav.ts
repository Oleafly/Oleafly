import type { EditorView } from "@codemirror/view";
import { useIndexStore } from "@/store/project-index";
import { useFilesStore } from "@/store/files";
import { useReferencesStore } from "@/store/references";
import { useRenameStore } from "@/store/rename";
import { useSettingsStore } from "@/store/settings";
import { currentSourceProjectIntelligence } from "@/lib/project-intelligence/current";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import {
  definitionsForUse,
  referencesFor,
  symbolAt,
} from "@/lib/project-intelligence/selectors";
import type {
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectUse,
} from "@/lib/project-intelligence/types";
import { writeFileContent } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import type { DefKind, Sym } from "./types";

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

function notifyAnalysisUnavailable(): void {
  const state = useIndexStore.getState().intelligenceState;
  if (state.status === "error" || state.status === "unavailable") {
    toast.error(
      state.failure?.message ??
        state.reason ??
        "Project reference analysis is unavailable.",
    );
  } else {
    toast.info("Project references are updating.");
  }
}

function definitionsForSymbol(
  snapshot: ProjectIntelligenceSnapshot,
  symbol: ProjectDefinition | ProjectUse,
): readonly ProjectDefinition[] {
  return isUse(symbol)
    ? definitionsForUse(snapshot, symbol.id)
    : [symbol];
}

export function goToDefinition(view: EditorView): boolean {
  const current = intelligenceAtCursor(view);
  if (!current) {
    notifyAnalysisUnavailable();
    return false;
  }
  const { snapshot, symbol } = current;
  if (!symbol) return false;
  // On a definition, F12 acts as find-references (IDE convention).
  if (!isUse(symbol)) return findReferences(view);

  const definitions = definitionsForUse(snapshot, symbol.id);
  if (definitions.length === 0) {
    toast.info(`No definition found for "${symbol.name}"`);
    return true;
  }
  if (definitions.length > 1) {
    showReferenceQuery(
      snapshot,
      "definitions",
      symbol.id,
      `Definitions for ${symbol.name}`,
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
  if (!current) {
    notifyAnalysisUnavailable();
    return false;
  }
  const { snapshot, symbol } = current;
  if (!symbol) return false;
  const definitions = definitionsForSymbol(snapshot, symbol);
  if (definitions.length === 0) {
    toast.info(`No definition found for "${symbol.name}"`);
    return true;
  }
  if (definitions.length > 1 && isUse(symbol)) {
    showReferenceQuery(
      snapshot,
      "definitions",
      symbol.id,
      `Definitions for ${symbol.name}`,
    );
    return true;
  }
  const definition = definitions[0];
  const references = referencesFor(snapshot, definition.id);
  if (references.length === 0) {
    toast.info(`No references to "${definition.name}"`);
    return true;
  }
  showReferenceQuery(
    snapshot,
    "references",
    definition.id,
    `References to ${definition.name}`,
  );
  return true;
}

export function startRename(view: EditorView): boolean {
  const sym = legacySymbolAtCursor(view);
  if (!sym) return false;
  const index = useIndexStore.getState().index;
  const def = (index?.definitionFor(sym) ?? sym) as Sym;
  if (!RENAMABLE.has(def.kind as DefKind)) {
    toast.info("This symbol cannot be renamed.");
    return true;
  }
  useRenameStore.getState().open(def);
  return true;
}

// Edits are applied against the exact text the index was built from (the cache), so
// offsets are always valid. The active file is edited through the editor (so it
// updates live); other files via the store / disk.
export async function applyRename(view: EditorView, sym: Sym, newName: string): Promise<void> {
  const store = useIndexStore.getState();
  const index = store.index;
  if (!index) return;
  const plan = index.renamePlan(sym, newName);
  if (plan.collision) {
    toast.error(`"${newName}" already exists.`);
    return;
  }
  if (plan.edits.length === 0) {
    toast.info("Nothing to rename.");
    return;
  }

  const files = useFilesStore.getState();
  const id = files.projectId;
  const activePath = files.activePath;

  const byFile = new Map<string, typeof plan.edits>();
  for (const e of plan.edits) {
    const arr = byFile.get(e.file) ?? [];
    arr.push(e);
    byFile.set(e.file, arr);
  }

  for (const [file, edits] of byFile) {
    if (file === activePath) {
      // Edit the live editor so the view updates; CM wants ascending, non-overlapping changes.
      const asc = [...edits].sort((a, b) => a.from - b.from);
      view.dispatch({ changes: asc.map((e) => ({ from: e.from, to: e.to, insert: e.newText })) });
      continue;
    }
    const base = store.texts[file];
    if (base === undefined) continue;
    let text = base;
    for (const e of [...edits].sort((a, b) => b.from - a.from)) {
      text = text.slice(0, e.from) + e.newText + text.slice(e.to);
    }
    if (files.files[file] !== undefined) {
      files.setContent(file, text);
    } else if (id) {
      try {
        await writeFileContent(id, file, text);
      } catch {
        /* leave the file untouched on write failure */
      }
    }
  }

  await store.rebuildFromDisk();
  toast.success(
    `Renamed to "${newName}" (${plan.edits.length} edit${plan.edits.length > 1 ? "s" : ""} in ${plan.fileCount} file${plan.fileCount > 1 ? "s" : ""})`,
  );
}

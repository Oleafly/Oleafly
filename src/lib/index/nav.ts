import type { EditorView } from "@codemirror/view";
import { useIndexStore } from "@/store/project-index";
import { useFilesStore } from "@/store/files";
import { useReferencesStore } from "@/store/references";
import { useRenameStore } from "@/store/rename";
import { useSettingsStore } from "@/store/settings";
import { gotoRange } from "@/components/editor/cm/controller";
import { writeFileContent } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import type { DefKind, Sym } from "./types";

const DEF_KINDS = new Set<string>(["label", "macro", "bibentry", "theorem", "glossary", "environment", "section", "file"]);
const RENAMABLE = new Set<DefKind>(["label", "macro", "bibentry", "theorem", "glossary", "environment"]);
const isDef = (s: Sym) => DEF_KINDS.has(s.kind);

// Flushes the active file into the index first (pure, fast) so offsets are current
// before looking up the cursor token.
function symbolAtCursor(view: EditorView): Sym | null {
  const path = useFilesStore.getState().activePath;
  if (!path) return null;
  useIndexStore.getState().updateFile(path, view.state.doc.toString());
  const index = useIndexStore.getState().index;
  return index?.symbolAt(path, view.state.selection.main.head) ?? null;
}

function jumpTo(sym: Sym) {
  const files = useFilesStore.getState();
  if (sym.file === files.activePath) {
    gotoRange(sym.from, sym.to);
  } else {
    void files.openFile(sym.file).then(() => window.setTimeout(() => gotoRange(sym.from, sym.to), 80));
  }
}

export function goToDefinition(view: EditorView): boolean {
  const sym = symbolAtCursor(view);
  if (!sym) return false;
  // On a definition, F12 acts as find-references (IDE convention).
  if (isDef(sym)) return findReferences(view);
  const def = useIndexStore.getState().index?.definitionFor(sym) ?? null;
  if (!def) {
    toast.info(`No definition found for "${sym.name}"`);
    return true;
  }
  jumpTo(def);
  return true;
}

export function findReferences(view: EditorView): boolean {
  const sym = symbolAtCursor(view);
  if (!sym) return false;
  const results = useIndexStore.getState().index?.allReferences(sym) ?? [];
  if (results.length === 0) {
    toast.info(`No references to "${sym.name}"`);
    return true;
  }
  useReferencesStore.getState().show(`References to ${sym.name}`, results);
  const s = useSettingsStore.getState();
  s.setRailTab("refs");
  if (!s.showTree) s.toggleTree();
  return true;
}

export function startRename(view: EditorView): boolean {
  const sym = symbolAtCursor(view);
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

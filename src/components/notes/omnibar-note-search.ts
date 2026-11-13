import { analyze } from "@oleafly/search-query";
import { i18n, loadNamespace } from "@/i18n";
import type { SearchMode } from "@/lib/search-modes";
import { type NoteSearchHit, noteSearch } from "@/lib/tauri";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { vaultSnapshot } from "./app-notes";
import { buildNoteSearchSchema, mergeHits, type VaultPlan, vaultPlan } from "./note-query";
import type { NoteItem } from "./types";

export interface OmnibarNoteResults {
  readonly truncated: boolean;
  readonly hits: NoteSearchHit[];
}

export type OmnibarNoteSearch = (term: string, limit: number, mode: SearchMode) => Promise<OmnibarNoteResults>;

async function notePlan(term: string): Promise<VaultPlan> {
  await loadNamespace("notes");
  const favorites = new Set(useNotesPrefsStore.getState().favorites);
  const schema = buildNoteSearchSchema(i18n.getFixedT(null, ["notes"]), { favorites, tags: null, projects: [] });
  const context = { now: Date.now() };
  return vaultPlan(analyze(term, schema, context), schema, context);
}

export function omnibarNoteSearch(): OmnibarNoteSearch {
  let notes: Promise<readonly NoteItem[]> | null = null;
  const vaultNotes = () => {
    notes ??= vaultSnapshot().then(
      (snapshot) => snapshot.notes,
      (error: unknown) => {
        notes = null;
        throw error;
      },
    );
    return notes;
  };
  return async (term, limit, mode) => {
    const plan = await notePlan(term);
    if (plan.branches.length === 0) return { truncated: plan.truncated, hits: [] };
    const options = { mode, blocks: true };
    const [results, vault] = await Promise.all([Promise.all(plan.searches.map((search) => noteSearch(search, limit, options))), vaultNotes()]);
    return { truncated: plan.truncated, hits: mergeHits(plan, results, vault, limit) };
  };
}

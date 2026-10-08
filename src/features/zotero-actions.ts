import { create } from "zustand";
import type { ZoteroHit } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { zoteroLibraryLookup } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useZoteroDialogStore } from "@/store/zotero-dialogs";
import { zoteroHasKey } from "@/store/zotero-library";
import { insertCitationKey } from "./cite-insert";
import {
  citationKeyForHit,
  ensureZoteroEntries,
  requestZoteroUpdate,
  staleZoteroEntries,
  unresolvedCitationKeys,
  type StaleEntry,
} from "./zotero-cite";

interface ZoteroStaleState {
  projectId: string | null;
  entries: readonly StaleEntry[];
  revision: number;
  refresh: () => Promise<void>;
}

let refreshing: Promise<void> | null = null;
let refreshAgain = false;

export const useZoteroStaleStore = create<ZoteroStaleState>((set, get) => ({
  projectId: null,
  entries: [],
  revision: 0,
  refresh: async () => {
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = (async () => {
      const projectId = useFilesStore.getState().projectId;
      try {
        const entries = projectId ? await staleZoteroEntries() : [];
        if (useFilesStore.getState().projectId !== projectId) return;
        const previous = get().entries;
        const same =
          previous.length === entries.length &&
          previous.every((entry, index) => entry.key === entries[index].key && entry.handEdited === entries[index].handEdited);
        if (!same || get().projectId !== projectId) {
          set((state) => ({ projectId, entries, revision: state.revision + 1 }));
        }
      } catch (error) {
        void logError("check Zotero for changed entries", error);
      }
    })().finally(() => {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        void get().refresh();
      }
    });
    return refreshing;
  },
}));

export function staleEntryFor(path: string, key: string): StaleEntry | null {
  const state = useZoteroStaleStore.getState();
  if (state.projectId !== useFilesStore.getState().projectId) return null;
  return state.entries.find((entry) => entry.bib === path && entry.key === key) ?? null;
}

export function missingKeysInZotero(): string[] {
  return unresolvedCitationKeys().filter(zoteroHasKey);
}

function chooseBibliography(choices: readonly string[]): Promise<string | null> {
  return useZoteroDialogStore.getState().chooseBibliography(choices);
}

export async function addCitedKeyFromZotero(key: string): Promise<void> {
  try {
    const [hit] = await zoteroLibraryLookup([key]);
    if (!hit) {
      toast.error(i18n.t(($) => $.references.zotero.actions.notInLibrary, { key }));
      return;
    }
    const result = await ensureZoteroEntries([{ hit, key }], { chooseBibliography });
    if (result.error) {
      toast.error(i18n.t(($) => $.references.zotero.completion.addFailed, { key, detail: result.error }));
      return;
    }
    void useZoteroStaleStore.getState().refresh();
  } catch (error) {
    void logError("add a cited key from Zotero", error);
    toast.error(i18n.t(($) => $.references.zotero.completion.addFailed, { key, detail: describeError(error) }));
  }
}

export async function updateEntryFromZotero(key: string): Promise<void> {
  try {
    const outcome = await requestZoteroUpdate(key, (entries) => useZoteroDialogStore.getState().confirmHandEdits(entries));
    if (outcome === "updated") {
      toast.success(i18n.t(($) => $.references.zotero.actions.updated, { key }));
    } else if (outcome === "failed") {
      toast.error(i18n.t(($) => $.references.zotero.actions.updateFailed, { key }));
    }
  } catch (error) {
    void logError("update an entry from Zotero", error);
    toast.error(i18n.t(($) => $.references.zotero.actions.updateFailed, { key }));
  } finally {
    void useZoteroStaleStore.getState().refresh();
  }
}

export function openMissingCitations(): void {
  useZoteroDialogStore.getState().openBulk("missing");
}

export function openZoteroUpdates(): void {
  useZoteroDialogStore.getState().openBulk("update");
}

export function insertZoteroCitation(hit: ZoteroHit): string | null {
  const key = citationKeyForHit(hit);
  const cite = insertCitationKey(key);
  if (!cite) return null;
  void ensureZoteroEntries([{ hit, key }], { chooseBibliography })
    .then((result) => {
      if (result.error) toast.error(i18n.t(($) => $.references.zotero.completion.addFailed, { key, detail: result.error }));
    })
    .catch((error: unknown) => {
      void logError("add a Zotero citation", error);
      toast.error(i18n.t(($) => $.references.zotero.completion.addFailed, { key, detail: describeError(error) }));
    });
  return cite;
}

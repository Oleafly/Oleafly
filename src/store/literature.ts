import { create } from "zustand";
import {
  bibtexForLiteratureRecord,
  literatureIdentity,
  type LiteratureRecord,
} from "@/lib/literature-search";
import { readJson, writeJson } from "@/lib/local-storage";

const STORAGE_KEY = "oleafly.literature-library.v1";
const MAX_SAVED_CITATIONS = 500;

export interface SavedLiteratureCitation {
  id: string;
  record: LiteratureRecord;
  bibtex: string;
  savedAt: number;
}

function savedCitations(parsed: unknown): SavedLiteratureCitation[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is SavedLiteratureCitation =>
      Boolean(
        entry &&
          typeof entry === "object" &&
          typeof entry.id === "string" &&
          typeof entry.bibtex === "string" &&
          typeof entry.savedAt === "number" &&
          entry.record &&
          typeof entry.record.title === "string",
      ),
  );
}

function load(): SavedLiteratureCitation[] {
  return readJson(STORAGE_KEY, [], savedCitations);
}

function persist(saved: SavedLiteratureCitation[]) {
  writeJson(STORAGE_KEY, saved);
}

interface LiteratureLibraryState {
  saved: SavedLiteratureCitation[];
  save: (record: LiteratureRecord) => void;
  remove: (id: string) => void;
  has: (record: LiteratureRecord) => boolean;
}

export const useLiteratureLibraryStore = create<LiteratureLibraryState>(
  (set, get) => ({
    saved: load(),
    save: (record) => {
      const id = literatureIdentity(record);
      const citation: SavedLiteratureCitation = {
        id,
        record,
        bibtex: bibtexForLiteratureRecord(record),
        savedAt: Date.now(),
      };
      const next = [
        citation,
        ...get().saved.filter((entry) => entry.id !== id),
      ].slice(0, MAX_SAVED_CITATIONS);
      persist(next);
      set({ saved: next });
    },
    remove: (id) => {
      const next = get().saved.filter((entry) => entry.id !== id);
      persist(next);
      set({ saved: next });
    },
    has: (record) =>
      get().saved.some(
        (entry) => entry.id === literatureIdentity(record),
      ),
  }),
);

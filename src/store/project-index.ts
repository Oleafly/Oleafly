import { create } from "zustand";
import { assembleIndex } from "@/lib/index/build";
import { parseFile } from "@/lib/index/parse-file";
import type { FileSymbols, ProjectIndex } from "@/lib/index/types";
import { useFilesStore } from "@/store/files";
import { readFileContent } from "@/lib/tauri";

// Live whole-project index. Built from an in-memory text cache so edits re-index
// with pure JS (no disk IO). `updateFile` re-parses only the changed file (the
// expensive per-file regex work) and reassembles, instead of re-parsing every
// file on every keystroke. `rebuildFromDisk` (project switch) reads every
interface IndexStore {
  index: ProjectIndex | null;
  // Path -> text the current index was built from (rename applies against this).
  texts: Record<string, string>;
  // Path -> cached parse result, so unchanged files are not re-parsed.
  parsed: Record<string, FileSymbols>;
  building: boolean;
  rebuildFromDisk: () => Promise<void>;
  updateFile: (path: string, text: string) => void;
  reset: () => void;
}

const isIndexable = (p: string) => /\.(?:tex|ltx|latex|typ|md|markdown|bib)$/i.test(p);

// Bumped on every rebuild so a rebuild that finishes after the project switched
// can detect it is stale and not install the old project's symbols.
let rebuildSeq = 0;

export const useIndexStore = create<IndexStore>((set, get) => ({
  index: null,
  texts: {},
  parsed: {},
  building: false,

  rebuildFromDisk: async () => {
    const seq = ++rebuildSeq;
    const files = useFilesStore.getState();
    const id = files.projectId;
    if (!id) return;
    set({ building: true });
    try {
      const paths = files.tree.filter((f) => !f.is_dir && isIndexable(f.path)).map((f) => f.path);
      const texts: Record<string, string> = {};
      for (const path of paths) {
        const open = files.files[path]?.content;
        if (open !== undefined) {
          texts[path] = open;
        } else {
          try {
            texts[path] = await readFileContent(id, path);
          } catch {
            /* unreadable file: skip */
          }
        }
      }
      // A newer rebuild started (or the project switched) while we were reading
      // from disk: discard this stale result.
      if (seq !== rebuildSeq || useFilesStore.getState().projectId !== id) return;
      const parsed: Record<string, FileSymbols> = {};
      for (const [path, text] of Object.entries(texts)) parsed[path] = parseFile(path, text);
      set({ texts, parsed, index: assembleIndex(parsed, texts), building: false });
    } catch {
      if (seq === rebuildSeq) set({ building: false });
    }
  },

  updateFile: (path, text) => {
    if (!isIndexable(path)) return;
    const cur = get();
    // Skip the rebuild when nothing changed (go-to-def/click call this to be safe).
    if (cur.texts[path] === text && cur.index) return;
    const texts = { ...cur.texts, [path]: text };
    const parsed = { ...cur.parsed, [path]: parseFile(path, text) };
    set({ texts, parsed, index: assembleIndex(parsed, texts) });
  },

  reset: () => set({ index: null, texts: {}, parsed: {}, building: false }),
}));

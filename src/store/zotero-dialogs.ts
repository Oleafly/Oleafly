import { create } from "zustand";
import type { StaleEntry } from "@/features/zotero-cite";
import type { HandListRequest } from "@/features/zotero-hand-bibliography";

interface Pending<T, R> {
  readonly value: T;
  readonly resolve: (result: R) => void;
}

export type ZoteroBulkKind = "missing" | "update";

interface ZoteroDialogState {
  bibliographyChoice: Pending<readonly string[], string | null> | null;
  handEdits: Pending<readonly StaleEntry[], boolean> | null;
  handList: Pending<HandListRequest, boolean> | null;
  bulk: ZoteroBulkKind | null;
  chooseBibliography: (choices: readonly string[]) => Promise<string | null>;
  confirmHandEdits: (entries: readonly StaleEntry[]) => Promise<boolean>;
  confirmHandList: (request: HandListRequest) => Promise<boolean>;
  openBulk: (kind: ZoteroBulkKind) => void;
  closeBulk: () => void;
}

export const useZoteroDialogStore = create<ZoteroDialogState>((set, get) => ({
  bibliographyChoice: null,
  handEdits: null,
  handList: null,
  bulk: null,
  chooseBibliography: (choices) =>
    new Promise((resolve) => {
      get().bibliographyChoice?.resolve(null);
      set({
        bibliographyChoice: {
          value: choices,
          resolve: (path) => {
            set({ bibliographyChoice: null });
            resolve(path);
          },
        },
      });
    }),
  confirmHandEdits: (entries) =>
    new Promise((resolve) => {
      get().handEdits?.resolve(false);
      set({
        handEdits: {
          value: entries,
          resolve: (accepted) => {
            set({ handEdits: null });
            resolve(accepted);
          },
        },
      });
    }),
  confirmHandList: (request) =>
    new Promise((resolve) => {
      get().handList?.resolve(false);
      set({
        handList: {
          value: request,
          resolve: (accepted) => {
            set({ handList: null });
            resolve(accepted);
          },
        },
      });
    }),
  openBulk: (kind) => set({ bulk: kind }),
  closeBulk: () => set({ bulk: null }),
}));

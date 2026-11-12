import type { JSONContent } from "@tiptap/core";

export interface UndoEntry {
  at: number;
  selection: unknown;
  steps: unknown[];
  skip?: true;
  undo?: true;
  redo?: true;
}

export interface UndoRecord {
  base: JSONContent;
  entries: UndoEntry[];
  savedAt: number;
}

export interface UndoStore {
  read(id: string): Promise<UndoRecord | null>;
  write(id: string, record: UndoRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  sweep(): Promise<void>;
}

const DATABASE = "oleafly-note-undo";
const STORE = "notes";
export const UNDO_KEPT_FOR_MS = 30 * 24 * 60 * 60 * 1000;

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error ?? request.error);
      }),
  );
}

function usable(): boolean {
  return typeof indexedDB !== "undefined";
}

function kept(record: UndoRecord): boolean {
  return Date.now() - record.savedAt <= UNDO_KEPT_FOR_MS;
}

function change(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  if (!usable()) return Promise.resolve();
  return run(mode, work).then(
    () => undefined,
    () => undefined,
  );
}

export const indexedUndoStore: UndoStore = {
  async read(id) {
    if (!usable()) return null;
    const record = await run<UndoRecord | undefined>("readonly", (store) => store.get(id)).catch(() => undefined);
    if (!record) return null;
    if (kept(record)) return record;
    await indexedUndoStore.remove(id);
    return null;
  },
  write: (id, record) => change("readwrite", (store) => store.put(record, id)),
  remove: (id) => change("readwrite", (store) => store.delete(id)),
  clear: () => change("readwrite", (store) => store.clear()),
  sweep: () =>
    change("readwrite", (store) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!kept(cursor.value as UndoRecord)) cursor.delete();
        cursor.continue();
      };
      return request;
    }),
};

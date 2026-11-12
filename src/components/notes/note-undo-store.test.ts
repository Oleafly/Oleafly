// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UndoRecord } from "./note-undo-store";

interface Pending {
  result?: unknown;
  onsuccess: (() => void) | null;
}

function fakeIndexedDB() {
  const rows = new Map<string, unknown>();
  let commits = 0;
  const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const transaction = () => {
    let waiting = 0;
    let done = false;
    const tx = {
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      error: null,
      objectStore: () => store,
    };
    const later = (work: () => void) => {
      waiting += 1;
      setTimeout(() => {
        work();
        waiting -= 1;
        if (waiting > 0) return;
        setTimeout(() => {
          if (waiting > 0 || done) return;
          done = true;
          commits += 1;
          tx.oncomplete?.();
        });
      });
    };
    const ask = (work: () => unknown): Pending => {
      const request: Pending = { onsuccess: null };
      later(() => {
        request.result = work();
        request.onsuccess?.();
      });
      return request;
    };
    const store = {
      get: (key: string) => ask(() => copy(rows.get(key))),
      put: (value: unknown, key: string) => {
        const kept = copy(value);
        return ask(() => rows.set(key, kept) && key);
      },
      delete: (key: string) => ask(() => rows.delete(key) && undefined),
      clear: () => ask(() => rows.clear()),
      openCursor: () => {
        const keys = [...rows.keys()];
        const request: Pending = { onsuccess: null };
        const visit = (index: number) =>
          later(() => {
            const key = keys[index];
            request.result =
              key === undefined
                ? null
                : { value: copy(rows.get(key)), delete: () => rows.delete(key), continue: () => visit(index + 1) };
            request.onsuccess?.();
          });
        visit(0);
        return request;
      },
    };
    return tx;
  };
  const indexedDB = {
    open: () => {
      const request = {
        result: { createObjectStore: () => undefined, transaction },
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null,
      };
      setTimeout(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { indexedDB, rows, commits: () => commits };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function record(savedAt: number): UndoRecord {
  return { base: { type: "doc" }, entries: [], savedAt };
}

async function freshStore() {
  vi.resetModules();
  const fake = fakeIndexedDB();
  vi.stubGlobal("indexedDB", fake.indexedDB);
  const { indexedUndoStore, UNDO_KEPT_FOR_MS } = await import("./note-undo-store");
  const { startKeptUndoTidy } = await import("./note-undo-tidy");
  const { useSettingsStore } = await import("@/store/settings");
  return { ...fake, store: indexedUndoStore, keptFor: UNDO_KEPT_FOR_MS, startKeptUndoTidy, useSettingsStore };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the kept undo store", () => {
  it("reads nothing and keeps nothing where the webview has no IndexedDB", async () => {
    const { indexedUndoStore } = await import("./note-undo-store");
    await expect(indexedUndoStore.read("note-1")).resolves.toBeNull();
    await expect(indexedUndoStore.write("note-1", record(0))).resolves.toBeUndefined();
    await expect(indexedUndoStore.remove("note-1")).resolves.toBeUndefined();
    await expect(indexedUndoStore.clear()).resolves.toBeUndefined();
    await expect(indexedUndoStore.sweep()).resolves.toBeUndefined();
  });

  it("keeps a record, reads it back and forgets it", async () => {
    const { store } = await freshStore();
    const kept = record(Date.now());
    await store.write("note-1", kept);
    await expect(store.read("note-1")).resolves.toEqual(kept);
    await store.remove("note-1");
    await expect(store.read("note-1")).resolves.toBeNull();
  });

  it("finishes a write only once its transaction has committed", async () => {
    const { store, commits } = await freshStore();
    await store.write("note-1", record(Date.now()));
    expect(commits()).toBe(1);
  });

  it("drops a record that has not been saved for thirty days when it is read", async () => {
    const { store, rows, keptFor } = await freshStore();
    await store.write("old", record(Date.now() - keptFor - DAY_MS));
    await expect(store.read("old")).resolves.toBeNull();
    expect(rows.has("old")).toBe(false);
  });

  it("sweeps expired records at startup and keeps recent ones", async () => {
    const { store, rows, keptFor, startKeptUndoTidy } = await freshStore();
    await store.write("old", record(Date.now() - keptFor - DAY_MS));
    await store.write("older", record(Date.now() - 2 * keptFor));
    await store.write("recent", record(Date.now() - DAY_MS));
    const stop = await startKeptUndoTidy();
    await vi.waitFor(() => expect([...rows.keys()]).toEqual(["recent"]));
    stop();
  });

  it("deletes every record at startup when Keep undo is off", async () => {
    const { store, rows, startKeptUndoTidy, useSettingsStore } = await freshStore();
    useSettingsStore.setState({ notesKeepUndo: false });
    await store.write("recent", record(Date.now()));
    const stop = await startKeptUndoTidy();
    await vi.waitFor(() => expect(rows.size).toBe(0));
    stop();
  });

  it("deletes every record when Keep undo is turned off, and nothing when it is turned on", async () => {
    const { store, rows, startKeptUndoTidy, useSettingsStore } = await freshStore();
    useSettingsStore.setState({ notesKeepUndo: true });
    const stop = await startKeptUndoTidy();
    await store.write("a", record(Date.now()));
    await store.write("b", record(Date.now()));
    useSettingsStore.setState({ notesKeepUndo: false });
    await vi.waitFor(() => expect(rows.size).toBe(0));
    await store.write("c", record(Date.now()));
    useSettingsStore.setState({ notesKeepUndo: true });
    await store.sweep();
    expect([...rows.keys()]).toEqual(["c"]);
    stop();
    useSettingsStore.setState({ notesKeepUndo: false });
    await store.sweep();
    expect([...rows.keys()]).toEqual(["c"]);
  });
});

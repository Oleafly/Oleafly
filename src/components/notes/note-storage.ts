import { useSyncExternalStore } from "react";
import { readString, writeString } from "@/lib/local-storage";

export interface StoredValue<T> {
  read(): T;
  write(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function storedValue<T>(key: string, parse: (raw: string | null) => T, serialize: (value: T) => string): StoredValue<T> {
  let memory: { value: T } | null = null;
  let cache: { raw: string | null; value: T } | null = null;
  const listeners = new Set<() => void>();

  const read = (): T => {
    if (memory) return memory.value;
    const raw = readString(key);
    if (cache === null || cache.raw !== raw) cache = { raw, value: parse(raw) };
    return cache.value;
  };

  const write = (value: T): void => {
    const raw = serialize(value);
    if (writeString(key, raw)) {
      memory = null;
      cache = { raw, value };
    } else {
      memory = { value };
    }
    for (const listener of [...listeners]) listener();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };

  return { read, write, subscribe };
}

export function useStoredValue<T>(store: StoredValue<T>): T {
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}

export function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

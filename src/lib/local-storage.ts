function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    return;
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    return;
  }
}

export function readJson<T>(
  key: string,
  fallback: T,
  parse?: (value: unknown) => T,
): T {
  const raw = readString(key);
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    return parse ? parse(value) : (value as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    return;
  }
}

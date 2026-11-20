export type TabKind = "outbox" | "unsent";

const ROOT = "oleafly.web.";
const KINDS: readonly TabKind[] = ["outbox", "unsent"];
const VERSION = "v2";

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function tabScope(account: string, projectId: string): string {
  return `${encodeURIComponent(account)}/${encodeURIComponent(projectId)}`;
}

export function tabKey(kind: TabKind, scope: string): string {
  return `${ROOT}${kind}.${VERSION}.${scope}`;
}

export function readTab(kind: TabKind, scope: string): unknown {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(tabKey(kind, scope)) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function writeTab(kind: TabKind, scope: string, text: string | null): void {
  const store = storage();
  if (!store) return;
  try {
    if (text === null) store.removeItem(tabKey(kind, scope));
    else store.setItem(tabKey(kind, scope), text);
  } catch {
    return;
  }
}

export function forgetTabs(): void {
  const store = storage();
  if (!store) return;
  try {
    const prefixes = KINDS.map((kind) => `${ROOT}${kind}.`);
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) store.removeItem(key);
    }
  } catch {
    return;
  }
}

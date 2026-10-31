import type { CollabTextOperation } from "@oleafly/backend-port";

export interface UnsentTyping {
  base: string;
  inflight: { id: string; op: CollabTextOperation } | null;
  rest: CollabTextOperation;
  at: number;
}

export type UnsentFiles = Readonly<Record<string, UnsentTyping>>;

const PREFIX = "oleafly.web.unsent.v1.";
export const MAX_UNSENT_CHARS = 2_000_000;
export const MAX_UNSENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isTyping(value: unknown): value is UnsentTyping {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  const inflight = entry.inflight as Record<string, unknown> | null | undefined;
  return (
    typeof entry.base === "string" &&
    Array.isArray(entry.rest) &&
    typeof entry.at === "number" &&
    (inflight === null || (typeof inflight?.id === "string" && Array.isArray(inflight.op)))
  );
}

export function readUnsent(projectId: string, now = Date.now()): UnsentFiles {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(`${PREFIX}${projectId}`) ?? null;
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const kept: Record<string, UnsentTyping> = {};
  for (const [fileId, entry] of Object.entries(parsed)) {
    if (isTyping(entry) && now - entry.at <= MAX_UNSENT_AGE_MS) kept[fileId] = entry;
  }
  return kept;
}

export function writeUnsent(projectId: string, fileId: string, typing: UnsentTyping | null, now = Date.now()): void {
  const store = storage();
  if (!store) return;
  const key = `${PREFIX}${projectId}`;
  const files: Record<string, UnsentTyping> = { ...readUnsent(projectId, now) };
  if (typing) files[fileId] = typing;
  else delete files[fileId];
  try {
    const text = JSON.stringify(files);
    if (Object.keys(files).length === 0) store.removeItem(key);
    else if (text.length > MAX_UNSENT_CHARS) {
      delete files[fileId];
      store.setItem(key, JSON.stringify(files));
    } else store.setItem(key, text);
  } catch {
    return;
  }
}

export function forgetUnsent(projectId: string): void {
  try {
    storage()?.removeItem(`${PREFIX}${projectId}`);
  } catch {
    return;
  }
}

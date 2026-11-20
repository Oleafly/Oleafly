import type { CollabTextOperation } from "@oleafly/backend-port";
import { readTab, writeTab } from "./tab-storage";

export interface UnsentTyping {
  base: string;
  inflight: { id: string; op: CollabTextOperation } | null;
  rest: CollabTextOperation;
  at: number;
}

export type UnsentFiles = Readonly<Record<string, UnsentTyping>>;

export const MAX_UNSENT_CHARS = 2_000_000;
export const MAX_UNSENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

export function readUnsent(scope: string, now = Date.now()): UnsentFiles {
  const parsed = readTab("unsent", scope);
  if (typeof parsed !== "object" || parsed === null) return {};
  const kept: Record<string, UnsentTyping> = {};
  for (const [fileId, entry] of Object.entries(parsed)) {
    if (isTyping(entry) && now - entry.at <= MAX_UNSENT_AGE_MS) kept[fileId] = entry;
  }
  return kept;
}

export function writeUnsent(scope: string, fileId: string, typing: UnsentTyping | null, now = Date.now()): void {
  const files: Record<string, UnsentTyping> = { ...readUnsent(scope, now) };
  if (typing) files[fileId] = typing;
  else delete files[fileId];
  let text = JSON.stringify(files);
  if (text.length > MAX_UNSENT_CHARS) {
    delete files[fileId];
    text = JSON.stringify(files);
  }
  writeTab("unsent", scope, Object.keys(files).length === 0 ? null : text);
}

export function forgetUnsent(scope: string): void {
  writeTab("unsent", scope, null);
}

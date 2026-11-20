import { COMMENTS_REFUSED_OUTRIGHT } from "@/features/collab/comments/refused-outright";
import { readTab, writeTab } from "./tab-storage";

export type OutboxKind = "create" | "reply" | "chat";

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  body: string;
  at: number;
  state: "waiting" | "failed";
  reason: string | null;
  retry: boolean;
  fileId: string | null;
  threadId: string | null;
  path: string | null;
  from: number | null;
  to: number | null;
  quote: string | null;
  before: string | null;
  after: string | null;
}

const REFUSED_OUTRIGHT: ReadonlySet<string> = new Set([...COMMENTS_REFUSED_OUTRIGHT, "chat_role"]);

export function refusedOutright(code: string): boolean {
  return REFUSED_OUTRIGHT.has(code);
}

const KINDS: ReadonlySet<string> = new Set(["create", "reply", "chat"]);

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseItem(value: unknown): OutboxItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const id = text(item.id);
  const body = text(item.body);
  const kind = text(item.kind);
  const at = count(item.at);
  if (!id || body === null || !kind || !KINDS.has(kind) || at === null) return null;
  return {
    id,
    kind: kind as OutboxKind,
    body,
    at,
    state: item.state === "failed" ? "failed" : "waiting",
    reason: text(item.reason),
    retry: item.retry === true,
    fileId: text(item.fileId),
    threadId: text(item.threadId),
    path: text(item.path),
    from: count(item.from),
    to: count(item.to),
    quote: text(item.quote),
    before: text(item.before),
    after: text(item.after),
  };
}

export function loadOutbox(scope: string): OutboxItem[] {
  const parsed = readTab("outbox", scope);
  return Array.isArray(parsed) ? parsed.flatMap((value) => parseItem(value) ?? []) : [];
}

export function saveOutbox(scope: string, items: readonly OutboxItem[]): void {
  writeTab("outbox", scope, items.length === 0 ? null : JSON.stringify(items));
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function outboxId(): string {
  return `outbox-${randomId()}`;
}

export function outboxItem(kind: OutboxKind, body: string, place: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: outboxId(),
    kind,
    body,
    at: Date.now(),
    state: "waiting",
    reason: null,
    retry: false,
    fileId: null,
    threadId: null,
    path: null,
    from: null,
    to: null,
    quote: null,
    before: null,
    after: null,
    ...place,
  };
}

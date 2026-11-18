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

const PREFIX = "oleafly.web.outbox.v1.";
const REFUSED_OUTRIGHT: ReadonlySet<string> = new Set(["comment_off_server", "comment_off_project", "comment_viewer", "chat_role"]);

export function refusedOutright(code: string): boolean {
  return REFUSED_OUTRIGHT.has(code);
}

const KINDS: ReadonlySet<string> = new Set(["create", "reply", "chat"]);

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

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

export function loadOutbox(projectId: string): OutboxItem[] {
  const raw = storage()?.getItem(PREFIX + projectId);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => parseItem(value) ?? []);
  } catch {
    return [];
  }
}

export function saveOutbox(projectId: string, items: readonly OutboxItem[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (items.length === 0) store.removeItem(PREFIX + projectId);
    else store.setItem(PREFIX + projectId, JSON.stringify(items));
  } catch {
    return;
  }
}

let made = 0;

export function outboxId(): string {
  made += 1;
  return `outbox-${Date.now().toString(36)}-${made}`;
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

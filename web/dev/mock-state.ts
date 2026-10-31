import { TextOperation } from "../../src/features/collab/live/ot.ts";

export type Role = "owner" | "editor" | "reviewer" | "commenter" | "viewer";
export type Mode = "editing" | "suggesting";
export type Wire = (number | string)[];
export type OutputKind = "pdf" | "synctex";

export const REQUESTED_WITH = "oleafly-web";
export const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const OUTPUT_KINDS: readonly OutputKind[] = ["pdf", "synctex"];

export interface Account {
  accountId: string;
  name: string;
  login: string;
  email: string;
}

export interface MockFile {
  fileId: string;
  path: string;
  kind: "text" | "blob";
  text: string;
  rev: number;
  history: TextOperation[];
  blob: string | null;
}

export interface Suggestion {
  id: string;
  fileId: string;
  kind: "insert" | "delete";
  author: string;
  createdAt: number;
  from: number;
  to: number;
  text: string;
  threadId: string | null;
}

export interface Message {
  id: string;
  author: string;
  at: number;
  body: string;
  editedAt: number | null;
  deleted: boolean;
  mentions: string[];
  verified: boolean;
}

export interface Thread {
  id: string;
  fileId: string;
  anchor: { quote: string; range: { from: number; to: number } | null };
  createdBy: string;
  createdAt: number;
  resolved: { by: string; at: number; verified: boolean } | null;
  messages: Message[];
  verified: boolean;
}

export interface ChatMessage {
  id: string;
  author: string;
  at: number;
  body: string;
  deleted: boolean;
  verified: boolean;
}

export interface Output {
  kind: OutputKind;
  bytes: Uint8Array;
  compiledBy: string;
  compiledAt: number;
  mainFile: string;
}

export interface OutputItem {
  kind: OutputKind;
  size: number;
  compiledBy: string;
  compiledAt: number;
  mainFile: string;
}

export interface RequestHeaders {
  origin?: string;
  host?: string;
  "x-requested-with"?: string | string[];
}

export class Refusal extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export function mapPosition(op: TextOperation, position: number, assoc: -1 | 1): number {
  let base = 0;
  let target = 0;
  for (const step of op.toWire()) {
    if (typeof step === "string") {
      if (base < position || (base === position && assoc > 0)) {
        target += step.length;
        continue;
      }
      break;
    }
    if (step > 0) {
      if (position < base + step || (position === base + step && assoc < 0)) return target + (position - base);
      base += step;
      target += step;
      continue;
    }
    if (position <= base) break;
    if (position <= base - step) return target;
    base -= step;
  }
  return target + (position - base);
}

let serial = 0;

export function nextId(prefix: string): string {
  serial += 1;
  return `${prefix}-${Date.now().toString(36)}-${serial}`;
}

export function manages(role: Role): boolean {
  return role === "owner" || role === "editor";
}

export function canComment(role: Role): boolean {
  return role !== "viewer";
}

export function requestedByTheApp(headers: RequestHeaders): boolean {
  return headers["x-requested-with"] === REQUESTED_WITH && !!headers.host && headers.origin === `http://${headers.host}`;
}

const PDF_MARKER = [0x25, 0x50, 0x44, 0x46, 0x2d];

function looksLike(kind: OutputKind, bytes: Uint8Array): boolean {
  if (kind === "synctex") return bytes[0] === 0x1f && bytes[1] === 0x8b;
  const head = bytes.subarray(0, 1024);
  for (let at = 0; at + PDF_MARKER.length <= head.length; at += 1) {
    if (PDF_MARKER.every((byte, index) => head[at + index] === byte)) return true;
  }
  return false;
}

export function outputItem(output: Output): OutputItem {
  return {
    kind: output.kind,
    size: output.bytes.length,
    compiledBy: output.compiledBy,
    compiledAt: output.compiledAt,
    mainFile: output.mainFile,
  };
}

export interface ChangeResult {
  op: TextOperation;
  rev: number;
  length: number;
  suggestionsChanged: boolean;
  threadsChanged: boolean;
}

export type ChangeFate = "applied" | "abandoned";

const CHAT_PAGE = 200;
const KEPT_FATES = 1_024;

export class MockProject {
  readonly projectId: string;
  readonly title: string;
  readonly owner: string;
  readonly roles = new Map<string, Role>();
  readonly files = new Map<string, MockFile>();
  readonly suggestions = new Map<string, Suggestion>();
  readonly threads = new Map<string, Thread>();
  readonly chat: ChatMessage[] = [];
  readonly compile: Record<string, string> = {};
  readonly outputs = new Map<OutputKind, Output>();
  private readonly changeFates = new Map<string, ChangeFate>();

  constructor(projectId: string, title: string, owner: string) {
    this.projectId = projectId;
    this.title = title;
    this.owner = owner;
    this.roles.set(owner, "owner");
  }

  addText(fileId: string, path: string, text: string): MockFile {
    const file: MockFile = { fileId, path, kind: "text", text, rev: 0, history: [], blob: null };
    this.files.set(fileId, file);
    return file;
  }

  addBlob(fileId: string, path: string, blob: string): void {
    this.files.set(fileId, { fileId, path, kind: "blob", text: "", rev: 0, history: [], blob });
  }

  texts(): { fileId: string; path: string; text: string }[] {
    return [...this.files.values()]
      .filter((file) => file.kind === "text")
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => ({ fileId: file.fileId, path: file.path, text: file.text }));
  }

  storeOutput(kind: string, bytes: Uint8Array, compiledBy: string, mainFile: string | null): Output {
    const known = OUTPUT_KINDS.find((entry) => entry === kind);
    if (!known || !mainFile?.trim() || bytes.length > MAX_OUTPUT_BYTES || !looksLike(known, bytes)) {
      throw new Refusal("bad_request");
    }
    const output = { kind: known, bytes, compiledBy, compiledAt: Date.now(), mainFile: mainFile.trim() };
    this.outputs.set(known, output);
    return output;
  }

  outputItems(): OutputItem[] {
    return OUTPUT_KINDS.flatMap((kind) => {
      const output = this.outputs.get(kind);
      return output ? [outputItem(output)] : [];
    });
  }

  text(fileId: string): MockFile {
    const file = this.files.get(fileId);
    if (file?.kind !== "text") throw new Refusal("not_found");
    return file;
  }

  fileSuggestions(fileId: string): Suggestion[] {
    return [...this.suggestions.values()].filter((entry) => entry.fileId === fileId);
  }

  fileThreads(fileId: string): Thread[] {
    return [...this.threads.values()].filter((entry) => entry.fileId === fileId);
  }

  moveToCurrent(fileId: string, rev: number | null, position: number, assoc: -1 | 1): number {
    const file = this.text(fileId);
    if (rev === null || rev >= file.rev) return Math.min(position, file.text.length);
    let mapped = position;
    for (const op of file.history.slice(Math.max(0, rev))) mapped = mapPosition(op, mapped, assoc);
    return Math.min(mapped, file.text.length);
  }

  change(fileId: string, rev: number, wire: Wire, author: string, suggesting: boolean): ChangeResult {
    const file = this.text(fileId);
    if (rev < 0 || rev > file.rev) throw new Refusal("invalid");
    let op = TextOperation.fromWire(wire);
    for (const concurrent of file.history.slice(rev)) [op] = TextOperation.transform(op, concurrent);
    return this.apply(file, op, author, suggesting);
  }

  serverEdit(fileId: string, op: TextOperation): ChangeResult {
    return this.apply(this.text(fileId), op, "", false);
  }

  private apply(file: MockFile, op: TextOperation, author: string, suggesting: boolean): ChangeResult {
    const before = file.text;
    file.text = op.apply(before);
    file.history.push(op);
    file.rev += 1;
    const own = suggesting
      ? this.fileSuggestions(file.fileId).filter((entry) => entry.kind === "insert" && entry.author === author)
      : [];
    const ownRanges = own.map((entry) => ({ from: entry.from, to: entry.to }));
    let suggestionsChanged = false;
    for (const entry of this.fileSuggestions(file.fileId)) {
      if (entry.kind === "delete") {
        const at = mapPosition(op, entry.from, -1);
        if (at !== entry.from) suggestionsChanged = true;
        entry.from = at;
        entry.to = at;
        continue;
      }
      const from = mapPosition(op, entry.from, 1);
      const to = mapPosition(op, entry.to, -1);
      if (from !== entry.from || to !== entry.to) suggestionsChanged = true;
      entry.from = from;
      entry.to = to;
      entry.text = file.text.slice(from, Math.max(from, to));
      if (to <= from) this.suggestions.delete(entry.id);
    }
    let threadsChanged = false;
    for (const thread of this.fileThreads(file.fileId)) {
      const range = thread.anchor.range;
      if (!range) continue;
      const from = mapPosition(op, range.from, 1);
      const to = mapPosition(op, range.to, -1);
      if (from !== range.from || to !== range.to) threadsChanged = true;
      thread.anchor.range = to > from ? { from, to } : null;
    }
    if (suggesting) {
      this.record(file, op, before, author, ownRanges);
      suggestionsChanged = true;
    }
    return { op, rev: file.rev, length: file.text.length, suggestionsChanged, threadsChanged };
  }

  private record(
    file: MockFile,
    op: TextOperation,
    before: string,
    author: string,
    own: readonly { from: number; to: number }[],
  ): void {
    let base = 0;
    let target = 0;
    for (const step of op.toWire()) {
      if (typeof step === "string") {
        this.recordInsert(file, author, target, target + step.length);
        target += step.length;
        continue;
      }
      if (step > 0) {
        base += step;
        target += step;
        continue;
      }
      const end = base - step;
      let removed = "";
      for (let index = base; index < end; index += 1) {
        if (!own.some((range) => index >= range.from && index < range.to)) removed += before[index];
      }
      if (removed) this.recordDelete(file, author, target, removed);
      base = end;
    }
  }

  private recordInsert(file: MockFile, author: string, from: number, to: number): void {
    const joined = this.fileSuggestions(file.fileId).find(
      (entry) => entry.kind === "insert" && entry.author === author && (entry.to === from || entry.from === to),
    );
    if (joined) {
      joined.from = Math.min(joined.from, from);
      joined.to = Math.max(joined.to, to);
      joined.text = file.text.slice(joined.from, joined.to);
      return;
    }
    const id = nextId("sug");
    this.suggestions.set(id, {
      id,
      fileId: file.fileId,
      kind: "insert",
      author,
      createdAt: Date.now(),
      from,
      to,
      text: file.text.slice(from, to),
      threadId: null,
    });
  }

  private recordDelete(file: MockFile, author: string, at: number, removed: string): void {
    const joined = this.fileSuggestions(file.fileId).find(
      (entry) => entry.kind === "delete" && entry.author === author && entry.from === at,
    );
    if (joined) {
      joined.text = removed + joined.text;
      return;
    }
    const id = nextId("sug");
    this.suggestions.set(id, {
      id,
      fileId: file.fileId,
      kind: "delete",
      author,
      createdAt: Date.now(),
      from: at,
      to: at,
      text: removed,
      threadId: null,
    });
  }

  resolveSuggestion(id: string, accept: boolean): ChangeResult | null {
    const entry = this.suggestions.get(id);
    if (!entry) throw new Refusal("suggestion_not_found");
    this.suggestions.delete(id);
    if (accept) return null;
    const file = this.text(entry.fileId);
    const op =
      entry.kind === "insert"
        ? new TextOperation()
            .retain(entry.from)
            .delete(entry.to - entry.from)
            .retain(file.text.length - entry.to)
        : new TextOperation().retain(entry.from).insert(entry.text).retain(file.text.length - entry.from);
    return this.serverEdit(entry.fileId, op);
  }

  addThread(fileId: string, from: number, to: number, author: string, body: string): Thread {
    const file = this.text(fileId);
    if (to <= from) throw new Refusal("comment_selection_changed");
    const now = Date.now();
    const thread: Thread = {
      id: nextId("thr"),
      fileId,
      anchor: { quote: file.text.slice(from, to), range: { from, to } },
      createdBy: author,
      createdAt: now,
      resolved: null,
      messages: [this.message(author, body)],
      verified: true,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  message(author: string, body: string): Message {
    const trimmed = body.trim();
    if (!trimmed) throw new Refusal("comment_empty");
    if (trimmed.length > 10_000) throw new Refusal("comment_too_long");
    return { id: nextId("msg"), author, at: Date.now(), body: trimmed, editedAt: null, deleted: false, mentions: [], verified: true };
  }

  thread(threadId: string): Thread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Refusal("not_found");
    return thread;
  }

  chatSend(author: string, body: string): ChatMessage {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 4_000) throw new Refusal("invalid");
    const message = { id: nextId("chat"), author, at: Date.now(), body: trimmed, deleted: false, verified: true };
    this.chat.push(message);
    return message;
  }

  chatPage(): ChatMessage[] {
    return this.chat.slice(-CHAT_PAGE);
  }

  fateOf(author: string, id: string): ChangeFate | null {
    return this.changeFates.get(`${author}\u0000${id}`) ?? null;
  }

  applied(author: string, id: string): void {
    this.noteFate(author, id, "applied");
  }

  resumed(author: string, id: string): boolean {
    const fate = this.fateOf(author, id);
    if (fate) return fate === "applied";
    this.noteFate(author, id, "abandoned");
    return false;
  }

  private noteFate(author: string, id: string, fate: ChangeFate): void {
    const key = `${author}\u0000${id}`;
    this.changeFates.delete(key);
    this.changeFates.set(key, fate);
    while (this.changeFates.size > KEPT_FATES) {
      const oldest = this.changeFates.keys().next().value;
      if (oldest === undefined) break;
      this.changeFates.delete(oldest);
    }
  }
}

export function minimalPdf(lines: readonly string[]): Uint8Array {
  const pdfString = (value: string) => value.replace(/[\\()]/gu, (match) => `\\${match}`).replace(/[^\x20-\x7e]/gu, "?");
  const content = [
    "BT",
    "/F1 22 Tf",
    "72 720 Td",
    ...lines.flatMap((line, index) => [index === 0 ? "" : "0 -30 Td", `(${pdfString(line)}) Tj`]).filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

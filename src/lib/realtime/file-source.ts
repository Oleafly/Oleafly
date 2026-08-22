import {
  applyTextEdits,
  type DocumentChange,
  type DocumentChangeListener,
  type DocumentSession,
  type LocalRevision,
  type ProjectSource,
  type TextEdit,
  type TextSnapshot,
  type TransactionMeta,
  type TreeTransaction,
  type Unsubscribe,
} from "@oleafly/editor/document-session";
import type { FileId } from "@oleafly/realtime-protocol";

export interface FileSourceHost {
  read(fileId: FileId): string;
  write(fileId: FileId, content: string): void | Promise<void>;
  flush?(): Promise<void>;
}

interface HistoryEntry {
  readonly before: string;
  readonly after: string;
}

/** Solo adapter. This module deliberately has no Yjs import or initialization. */
export class FileSource implements ProjectSource {
  readonly mode = "solo" as const;
  readonly #sessions = new Map<FileId, FileDocumentSession>();

  constructor(private readonly host: FileSourceHost) {}

  openText(fileId: FileId): DocumentSession {
    let session = this.#sessions.get(fileId);
    if (!session) {
      session = new FileDocumentSession(fileId, this.host);
      this.#sessions.set(fileId, session);
    }
    return session;
  }

  async applyTreeTransaction(_tx: TreeTransaction): Promise<void> {
    throw new Error("solo tree transactions are not part of the realtime editor slice");
  }

  async captureProjectRevision(): Promise<LocalRevision> {
    const content = [...this.#sessions.values()]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map((session) => `${session.documentId}\0${session.snapshot().text}`)
      .join("\0");
    return revision(content);
  }
}

class FileDocumentSession implements DocumentSession {
  readonly mode = "solo" as const;
  readonly #listeners = new Set<DocumentChangeListener>();
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  #text: string;
  #version = 0;
  #transaction = 0;

  constructor(
    readonly documentId: FileId,
    private readonly host: FileSourceHost,
  ) {
    this.#text = host.read(documentId);
  }

  snapshot(): TextSnapshot {
    return { text: this.#text, version: this.#version };
  }

  apply(edits: readonly TextEdit[], _meta: TransactionMeta): string {
    const before = this.#text;
    const after = applyTextEdits(before, edits);
    const transactionId = `solo:${++this.#transaction}`;
    if (before === after) return transactionId;
    this.#undo.push({ before, after });
    this.#redo.length = 0;
    this.#publish(after, transactionId, edits);
    return transactionId;
  }

  subscribe(listener: DocumentChangeListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  undo(): void {
    const entry = this.#undo.pop();
    if (!entry) return;
    this.#redo.push(entry);
    this.#replace(entry.before, "undo");
  }

  redo(): void {
    const entry = this.#redo.pop();
    if (!entry) return;
    this.#undo.push(entry);
    this.#replace(entry.after, "redo");
  }

  stopCapturing(): void {}

  async captureLocalRevision(): Promise<LocalRevision> {
    return revision(this.#text);
  }

  async flushMaterialization(): Promise<void> {
    await this.host.write(this.documentId, this.#text);
    await this.host.flush?.();
  }

  #replace(next: string, label: string): void {
    const edit = { from: 0, to: this.#text.length, insert: next };
    this.#publish(next, `solo:${label}:${++this.#transaction}`, [edit]);
  }

  #publish(next: string, transactionId: string, edits: readonly TextEdit[]): void {
    this.#text = next;
    this.#version += 1;
    void this.host.write(this.documentId, next);
    const change: DocumentChange = {
      transactionId,
      source: "local",
      edits,
      snapshot: this.snapshot(),
    };
    for (const listener of this.#listeners) listener(change);
  }
}

async function revision(content: string): Promise<LocalRevision> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    content,
    digest: `sha256:${hex}`,
    capturedAtUnixMs: Date.now(),
  };
}

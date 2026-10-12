import type { DocumentSession, RemoteChange, Utf16Edit } from "@oleafly/editor/document-session";
import type { CollabDocMessage, CollabDocOpened, CollabTextOperation } from "@/lib/tauri";
import { editsFromOperation, operationFromEdits, replacementOperation, TextOperation } from "./ot";

export interface RemoteSessionTransport {
  open(path: string, onMessage: (message: CollabDocMessage) => void): Promise<CollabDocOpened | null>;
  change(fileId: string, rev: number, op: CollabTextOperation): Promise<void> | void;
  close(fileId: string): Promise<void> | void;
}

export type RemoteSessionPhase = "opening" | "open" | "detached" | "closed";

export interface RemoteSessionOptions {
  transport: RemoteSessionTransport;
  readOnly?: () => boolean;
  onText?: (text: string) => void;
  onPhase?: (phase: RemoteSessionPhase) => void;
}

export class RemoteDocumentSession implements DocumentSession {
  readonly path: string;
  private content: string;
  private localVersion = 0;
  private serverRev = 0;
  private fileId: string | null = null;
  private base: string;
  private pending: TextOperation | null = null;
  private outstanding: TextOperation | null = null;
  private buffer: TextOperation | null = null;
  private generation = 0;
  private current: RemoteSessionPhase = "opening";
  private readonly listeners = new Set<(change: RemoteChange) => void>();
  private waiters: (() => void)[] = [];
  private readonly options: RemoteSessionOptions;

  constructor(path: string, text: string, options: RemoteSessionOptions) {
    this.path = path;
    this.content = text;
    this.base = text;
    this.options = options;
  }

  get phase(): RemoteSessionPhase {
    return this.current;
  }

  get readOnly(): boolean {
    return this.current === "detached" || this.current === "closed" || (this.options.readOnly?.() ?? false);
  }

  get synchronized(): boolean {
    return this.pending === null && this.outstanding === null && this.buffer === null;
  }

  get revision(): number {
    return this.serverRev;
  }

  version(): number {
    return this.localVersion;
  }

  text(): string {
    return this.content;
  }

  subscribe(listener: (change: RemoteChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  applyLocal(edits: Utf16Edit[], baseVersion: number): void {
    if (this.readOnly) throw new Error(`${this.path} is read-only.`);
    if (baseVersion !== this.localVersion) {
      throw new Error(
        `Edits to ${this.path} are based on version ${baseVersion}, but the document is at version ${this.localVersion}.`,
      );
    }
    if (edits.length === 0) return;
    const operation = operationFromEdits(this.content, edits);
    if (operation.isNoop()) return;
    this.content = operation.apply(this.content);
    this.localVersion += 1;
    this.options.onText?.(this.content);
    if (this.current === "opening") {
      this.pending = this.pending ? this.pending.compose(operation) : operation;
    } else if (this.outstanding === null) {
      this.outstanding = operation;
      this.send(operation);
    } else {
      this.buffer = this.buffer ? this.buffer.compose(operation) : operation;
    }
  }

  async open(): Promise<void> {
    if (this.current === "closed") return;
    const generation = ++this.generation;
    this.base = this.content;
    this.pending = null;
    this.outstanding = null;
    this.buffer = null;
    this.fileId = null;
    this.setPhase("opening");
    const queued: CollabDocMessage[] = [];
    let ready = false;
    const onMessage = (message: CollabDocMessage) => {
      if (generation !== this.generation) return;
      if (ready) this.receive(message);
      else queued.push(message);
    };
    let opened: CollabDocOpened | null;
    try {
      opened = await this.options.transport.open(this.path, onMessage);
    } catch {
      opened = null;
    }
    if (generation !== this.generation) {
      if (opened) this.closeFile(opened.file_id);
      return;
    }
    if (!opened) {
      this.setPhase("detached");
      this.settle();
      return;
    }
    this.fileId = opened.file_id;
    this.serverRev = opened.rev;
    this.join(opened.text);
    ready = true;
    this.setPhase("open");
    for (const message of queued) {
      if (generation !== this.generation) return;
      if (message.rev > opened.rev) this.receive(message);
    }
    this.settle();
  }

  close(): void {
    if (this.current === "closed") return;
    this.generation += 1;
    const fileId = this.fileId;
    this.fileId = null;
    this.pending = null;
    this.outstanding = null;
    this.buffer = null;
    this.setPhase("closed");
    if (fileId) this.closeFile(fileId);
    this.settle();
  }

  settled(): Promise<void> {
    if (this.current !== "open" || this.synchronized) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private join(serverText: string): void {
    const opening = replacementOperation(this.base, serverText);
    const pending = this.pending;
    this.pending = null;
    if (!pending) {
      this.applyRemote(opening);
      return;
    }
    const [pendingPrime, openingPrime] = TextOperation.transform(pending, opening);
    this.applyRemote(openingPrime);
    if (pendingPrime.isNoop()) return;
    this.outstanding = pendingPrime;
    this.send(pendingPrime);
  }

  private receive(message: CollabDocMessage): void {
    try {
      if (message.kind === "ack") this.acknowledge(message.rev, message.length);
      else if (message.kind === "remote") this.remote(message.rev, message.op, message.length);
      else this.reset(message.rev, message.text);
    } catch {
      this.resync();
    }
  }

  private acknowledge(rev: number, length: number): void {
    if (!this.outstanding) {
      this.resync();
      return;
    }
    this.serverRev = rev;
    if (this.buffer) {
      this.outstanding = this.buffer;
      this.buffer = null;
      this.send(this.outstanding);
      return;
    }
    this.outstanding = null;
    if (!this.checkLength(length)) return;
    this.settle();
  }

  private remote(rev: number, wire: CollabTextOperation, length: number): void {
    let operation = TextOperation.fromWire(wire);
    if (this.outstanding) {
      const [outstanding, afterOutstanding] = TextOperation.transform(this.outstanding, operation);
      this.outstanding = outstanding;
      operation = afterOutstanding;
      if (this.buffer) {
        const [buffer, afterBuffer] = TextOperation.transform(this.buffer, operation);
        this.buffer = buffer;
        operation = afterBuffer;
      }
    }
    this.serverRev = rev;
    this.applyRemote(operation);
    if (!this.outstanding) this.checkLength(length);
  }

  private reset(rev: number, text: string): void {
    this.serverRev = rev;
    this.outstanding = null;
    this.buffer = null;
    this.applyRemote(replacementOperation(this.content, text));
    this.settle();
  }

  private checkLength(length: number): boolean {
    if (this.content.length === length) return true;
    this.resync();
    return false;
  }

  private applyRemote(operation: TextOperation): void {
    if (operation.isNoop()) return;
    const edits = editsFromOperation(operation);
    this.content = operation.apply(this.content);
    this.localVersion += 1;
    const change: RemoteChange = { edits, version: this.localVersion };
    for (const listener of [...this.listeners]) listener(change);
    this.options.onText?.(this.content);
  }

  private send(operation: TextOperation): void {
    const fileId = this.fileId;
    if (!fileId) return;
    const generation = this.generation;
    try {
      void Promise.resolve(this.options.transport.change(fileId, this.serverRev, operation.toWire())).catch(() => {
        if (generation === this.generation) this.resync();
      });
    } catch {
      this.resync();
    }
  }

  private resync(): void {
    if (this.current === "closed") return;
    const fileId = this.fileId;
    this.fileId = null;
    if (fileId) this.closeFile(fileId);
    void this.open();
  }

  private closeFile(fileId: string): void {
    try {
      void Promise.resolve(this.options.transport.close(fileId)).catch(() => {});
    } catch {
      return;
    }
  }

  private setPhase(phase: RemoteSessionPhase): void {
    if (this.current === phase) return;
    this.current = phase;
    this.options.onPhase?.(phase);
  }

  private settle(): void {
    if (this.current === "open" && !this.synchronized) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}

import type { DocumentSession, RemoteChange, Utf16Edit } from "@oleafly/editor/document-session";
import type { CollabDocMessage, CollabDocOpened, CollabTextOperation } from "@/lib/tauri";
import { diffOperation, editsFromOperation, operationFromEdits, TextOperation } from "./ot";

export interface RemoteSessionTransport {
  open(path: string, onMessage: (message: CollabDocMessage) => void): Promise<CollabDocOpened | null>;
  change(fileId: string, rev: number, op: CollabTextOperation): Promise<void> | void;
  // `session` is the token `open` returned, so a late close can't shut a
  // channel the same file opened since.
  close(fileId: string, session: number): Promise<void> | void;
}

export type RemoteSessionPhase = "opening" | "open" | "detached" | "closed";

// Why typing that never reached the shared document was dropped: the person
// can only view the project now, or the shared document refused it twice.
export type DiscardReason = "read_only" | "refused";

export interface RemoteSessionOptions {
  transport: RemoteSessionTransport;
  readOnly?: () => boolean;
  onText?: (text: string) => void;
  onPhase?: (phase: RemoteSessionPhase) => void;
  onDiscarded?: (reason: DiscardReason) => void;
}

interface Channel {
  fileId: string;
  token: number;
}

export class RemoteDocumentSession implements DocumentSession {
  private place: string;
  private content: string;
  private localVersion = 0;
  private serverRev = 0;
  private channel: Channel | null = null;
  // The shared text at `serverRev`, as far as Rust has confirmed it. Local
  // typing that isn't confirmed yet is the difference between it and `content`.
  private confirmed: string;
  // While opening, `pending` holds the typing relative to `base`.
  private base: string;
  private pending: TextOperation | null = null;
  private outstanding: TextOperation | null = null;
  private buffer: TextOperation | null = null;
  // Unsent typing went out again after a reset and hasn't been confirmed yet.
  private resent = false;
  // An input method is composing: typing collects in `buffer` until it ends.
  private holding = false;
  private generation = 0;
  private current: RemoteSessionPhase = "opening";
  private readonly listeners = new Set<(change: RemoteChange) => void>();
  private waiters: (() => void)[] = [];
  private readonly options: RemoteSessionOptions;

  constructor(path: string, text: string, options: RemoteSessionOptions) {
    this.place = path;
    this.content = text;
    this.confirmed = text;
    this.base = text;
    this.options = options;
  }

  get path(): string {
    return this.place;
  }

  moveTo(path: string): void {
    this.place = path;
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

  // The text holds typing the shared document never confirmed.
  get unconfirmed(): boolean {
    return this.content !== this.confirmed;
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
    } else if (this.outstanding === null && !this.holding) {
      this.outstanding = operation;
      this.send(operation);
    } else {
      this.buffer = this.buffer ? this.buffer.compose(operation) : operation;
    }
  }

  holdLocal(): void {
    this.holding = true;
  }

  releaseLocal(): void {
    if (!this.holding) return;
    this.holding = false;
    if (this.current !== "open" || this.outstanding !== null || this.buffer === null) return;
    this.outstanding = this.buffer;
    this.buffer = null;
    this.send(this.outstanding);
  }

  async open(): Promise<void> {
    if (this.current === "closed") return;
    const generation = ++this.generation;
    if (this.current !== "opening") {
      // Keep typing Rust hasn't confirmed: it goes out again once the file is
      // open, moved past whatever changed in the shared text meanwhile.
      this.base = this.confirmed;
      this.pending = this.unsent();
      this.outstanding = null;
      this.buffer = null;
    }
    this.channel = null;
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
      if (opened) this.closeChannel({ fileId: opened.file_id, token: opened.session });
      return;
    }
    if (!opened) {
      this.setPhase("detached");
      this.settle();
      return;
    }
    this.channel = { fileId: opened.file_id, token: opened.session };
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
    const channel = this.channel;
    this.channel = null;
    this.pending = null;
    this.outstanding = null;
    this.buffer = null;
    this.setPhase("closed");
    if (channel) this.closeChannel(channel);
    this.settle();
  }

  settled(): Promise<void> {
    if (this.current !== "open" || this.synchronized) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private unsent(): TextOperation | null {
    const { outstanding, buffer } = this;
    if (outstanding && buffer) return outstanding.compose(buffer);
    return outstanding ?? buffer;
  }

  private join(serverText: string): void {
    const pending = this.pending;
    this.pending = null;
    this.confirmed = serverText;
    if (pending && this.rebase(pending, serverText)) return;
    this.applyRemote(diffOperation(this.content, serverText));
  }

  // Moves typing made on `base` onto the shared text and sends it. False when
  // the typing doesn't fit the text it was recorded on, which only a broken
  // state can cause, so the caller falls back to taking the shared text.
  private rebase(pending: TextOperation, serverText: string): boolean {
    let mine: TextOperation;
    let theirs: TextOperation;
    try {
      if (pending.baseLength !== this.base.length || pending.targetLength !== this.content.length) return false;
      [mine, theirs] = TextOperation.transform(pending, diffOperation(this.base, serverText));
      this.applyRemote(theirs);
    } catch {
      return false;
    }
    if (!mine.isNoop()) this.queue(mine);
    return true;
  }

  // Sends typing now, or keeps it while an input method is composing.
  private queue(operation: TextOperation): void {
    if (this.holding) {
      this.buffer = this.buffer ? this.buffer.compose(operation) : operation;
      return;
    }
    this.outstanding = operation;
    this.send(operation);
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
    const confirmed = this.outstanding.apply(this.confirmed);
    this.serverRev = rev;
    this.confirmed = confirmed;
    this.resent = false;
    this.outstanding = this.holding ? null : this.buffer;
    if (!this.holding) this.buffer = null;
    if (!this.checkLength(length)) return;
    if (this.outstanding) {
      this.send(this.outstanding);
      return;
    }
    this.settle();
  }

  private remote(rev: number, wire: CollabTextOperation, length: number): void {
    const server = TextOperation.fromWire(wire);
    const confirmed = server.apply(this.confirmed);
    let operation = server;
    let outstanding = this.outstanding;
    let buffer = this.buffer;
    if (outstanding) {
      [outstanding, operation] = TextOperation.transform(outstanding, operation);
      if (buffer) [buffer, operation] = TextOperation.transform(buffer, operation);
    }
    this.outstanding = outstanding;
    this.buffer = buffer;
    this.serverRev = rev;
    this.confirmed = confirmed;
    this.applyRemote(operation);
    this.checkLength(length);
  }

  // Rust sends a reset when it refused a change or couldn't route one. Typing
  // it never took is moved onto the reset text and sent once more, unless the
  // person can only view the project now or it was already refused once.
  private reset(rev: number, text: string): void {
    const unsent = this.unsent();
    let discarded: DiscardReason | null = null;
    if (unsent) discarded = this.readOnly ? "read_only" : this.resent ? "refused" : null;
    const moved =
      unsent && !discarded ? TextOperation.transform(unsent, diffOperation(this.confirmed, text)) : null;
    this.serverRev = rev;
    this.confirmed = text;
    this.outstanding = null;
    this.buffer = null;
    if (!moved) {
      this.resent = false;
      this.applyRemote(diffOperation(this.content, text));
      if (discarded) this.options.onDiscarded?.(discarded);
      this.settle();
      return;
    }
    const [mine, theirs] = moved;
    this.applyRemote(theirs);
    if (mine.isNoop()) {
      this.resent = false;
      this.settle();
      return;
    }
    this.resent = true;
    this.queue(mine);
  }

  // `length` is the shared text's length after the message, which is what
  // `confirmed` must hold whatever local typing is still in flight.
  private checkLength(length: number): boolean {
    if (this.confirmed.length === length) return true;
    this.resync();
    return false;
  }

  private applyRemote(operation: TextOperation): void {
    if (operation.isNoop()) return;
    const edits = editsFromOperation(operation);
    this.content = operation.apply(this.content);
    this.localVersion += 1;
    const change: RemoteChange = { edits, version: this.localVersion };
    for (const listener of Array.from(this.listeners)) listener(change);
    this.options.onText?.(this.content);
  }

  private send(operation: TextOperation): void {
    const channel = this.channel;
    if (!channel) return;
    const generation = this.generation;
    try {
      void Promise.resolve(this.options.transport.change(channel.fileId, this.serverRev, operation.toWire())).catch(
        () => {
          if (generation === this.generation) this.resync();
        },
      );
    } catch {
      this.resync();
    }
  }

  private resync(): void {
    if (this.current === "closed") return;
    const channel = this.channel;
    this.channel = null;
    if (channel) this.closeChannel(channel);
    void this.open();
  }

  private closeChannel(channel: Channel): void {
    try {
      void Promise.resolve(this.options.transport.close(channel.fileId, channel.token)).catch(() => {});
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

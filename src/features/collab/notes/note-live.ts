import type { RemoteChange, Utf16Edit } from "@oleafly/editor/document-session";
import type { NoteLiveEditor as NoteEditorSurface } from "@/lib/collab-live-bridge";
import { diffOperation, editsFromOperation, operationFromEdits, TextOperation } from "../live/ot";

export const LIVE_SEND_MS = 200;
export const REMOTE_FRAME_MS = 16;

export interface NoteLiveSession {
  readonly readOnly: boolean;
  version(): number;
  text(): string;
  applyLocal(edits: Utf16Edit[], baseVersion: number): void;
  subscribe(listener: (change: RemoteChange) => void): () => void;
}

export type NoteLiveEditor = Pick<NoteEditorSurface, "serialize" | "show" | "composing">;

export interface NoteLiveClock {
  later(run: () => void, ms: number): () => void;
  soon(run: () => void): void;
  now?(): number;
}

export const browserClock: NoteLiveClock = {
  later: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  soon: (run) => queueMicrotask(run),
  now: () => performance.now(),
};

export interface NoteLiveOptions {
  session: NoteLiveSession;
  editor: NoteLiveEditor;
  baseline?: string;
  delayMs?: number;
  clock?: NoteLiveClock;
  onError?: (error: unknown) => void;
}

export interface NoteLiveDetached {
  unsent: boolean;
}

export class NoteLiveBinding {
  private serialized: string;
  private shared: string;
  private known: string;
  private remote: TextOperation | null = null;
  private cancel: (() => void) | null = null;
  private queued = false;
  private waiting = false;
  private stopped = false;
  private synced = Number.NEGATIVE_INFINITY;
  private readonly clock: NoteLiveClock;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: NoteLiveOptions) {
    const text = options.session.text();
    this.serialized = options.baseline ?? text;
    this.shared = text;
    this.known = text;
    this.clock = options.clock ?? browserClock;
    this.unsubscribe = options.session.subscribe((change) => this.received(change));
  }

  get active(): boolean {
    return !this.stopped;
  }

  start(): void {
    if (this.stopped) return;
    if (!this.options.session.readOnly) {
      this.sendLocal();
      return;
    }
    if (this.options.editor.serialize() !== this.serialized || this.options.session.text() !== this.shared) {
      this.apply(false);
    }
  }

  localChanged(): void {
    if (this.stopped || this.cancel) return;
    this.cancel = this.clock.later(() => {
      this.cancel = null;
      this.tick();
    }, this.options.delayMs ?? LIVE_SEND_MS);
  }

  compositionEnd(): void {
    if (this.stopped) return;
    this.tick();
  }

  private tick(): void {
    if (this.stopped) return;
    if (this.options.editor.composing()) this.localChanged();
    else if (this.waiting) this.sync();
    else this.sendLocal();
  }

  flush(): void {
    if (this.stopped || this.options.editor.composing()) return;
    this.sendLocal();
  }

  resync(): void {
    if (this.stopped) return;
    this.apply(false);
  }

  detach(): NoteLiveDetached {
    if (this.stopped) return { unsent: false };
    this.sendLocal();
    const unsent = this.options.editor.serialize() !== this.serialized;
    if (this.options.session.text() !== this.shared) this.apply(!this.options.session.readOnly);
    this.stopped = true;
    this.cancelTimer();
    this.unsubscribe();
    return { unsent };
  }

  private cancelTimer(): void {
    this.cancel?.();
    this.cancel = null;
  }

  private received(change: RemoteChange): void {
    if (this.stopped) return;
    const text = this.options.session.text();
    try {
      const operation = operationFromEdits(this.known, change.edits);
      if (operation.targetLength !== text.length) throw new RangeError("Remote edits do not match the shared text.");
      this.remote = this.remote ? this.remote.compose(operation) : operation;
    } catch {
      this.remote = null;
    }
    this.known = text;
    if (this.queued) return;
    this.queued = true;
    const run = () => {
      this.queued = false;
      this.sync();
    };
    const wait = this.clock.now ? REMOTE_FRAME_MS - (this.clock.now() - this.synced) : 0;
    if (wait > 0) this.clock.later(run, wait);
    else this.clock.soon(run);
  }

  private sync(): void {
    if (this.stopped) return;
    if (this.options.editor.composing()) {
      this.waiting = true;
      this.localChanged();
      return;
    }
    this.waiting = false;
    this.synced = this.clock.now?.() ?? this.synced;
    this.sendLocal();
    if (this.stopped) return;
    if (this.options.session.text() === this.shared) {
      this.remote = null;
      return;
    }
    this.apply(!this.options.session.readOnly);
  }

  private pendingRemote(current: string): TextOperation {
    const remote = this.remote;
    if (remote && remote.baseLength === this.shared.length && remote.targetLength === current.length) return remote;
    return diffOperation(this.shared, current);
  }

  private sendLocal(): void {
    this.cancelTimer();
    if (this.stopped) return;
    const { session, editor } = this.options;
    if (session.readOnly) return;
    const next = editor.serialize();
    if (next === this.serialized) return;
    try {
      let mine = diffOperation(this.serialized, next);
      if (this.serialized !== this.shared) {
        [mine] = TextOperation.transform(mine, diffOperation(this.serialized, this.shared));
      }
      const shared = mine.apply(this.shared);
      const current = session.text();
      let send = mine;
      let remote: TextOperation | null = null;
      if (current !== this.shared) [send, remote] = TextOperation.transform(mine, this.pendingRemote(current));
      session.applyLocal(editsFromOperation(send), session.version());
      const after = session.text();
      if ((remote ? remote.apply(shared) : shared) !== after) throw new RangeError("The live note lost track of its text.");
      this.serialized = next;
      this.shared = shared;
      this.known = after;
      this.remote = remote && !remote.isNoop() ? remote : null;
    } catch (error) {
      this.options.onError?.(error);
      this.apply(false);
    }
  }

  private apply(keepLocal: boolean): void {
    const next = this.options.session.text();
    this.options.editor.show(this.shared, next, keepLocal);
    this.serialized = this.options.editor.serialize();
    this.shared = next;
    this.known = next;
    this.remote = null;
  }
}

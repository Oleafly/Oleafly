import { isBinaryProjectPath } from "@/lib/project-paths";
import { type DiscardReason, RemoteDocumentSession, type RemoteSessionTransport } from "./remote-session";

export interface LiveSessionsOptions {
  transport: RemoteSessionTransport;
  readOnly: () => boolean;
  initialText(path: string): string | null;
  mirror(path: string, text: string): void;
  // `shared` is the text Rust last confirmed, the base to merge `text` from.
  detached(path: string, text: string, edited: boolean, shared: string): void;
  discarded?(path: string, reason: DiscardReason): void;
  // Whether a tab still shows the file. A file whose tab closed and opened
  // again before its typing was confirmed keeps its session.
  shown?(path: string): boolean;
  settleTimeoutMs?: number;
}

const SETTLE_TIMEOUT_MS = 3_000;

// The confirmed text, or the session's own text when a broken state can't
// rebuild it, which only loses the typing a merge would have kept.
function sharedText(session: RemoteDocumentSession): string {
  try {
    return session.confirmed();
  } catch {
    return session.text();
  }
}

export class LiveSessions {
  private readonly sessions = new Map<string, RemoteDocumentSession>();
  private readonly local = new Set<string>();
  private readonly options: LiveSessionsOptions;
  private closed = false;

  constructor(options: LiveSessionsOptions) {
    this.options = options;
  }

  documentSession(path: string): RemoteDocumentSession | null {
    if (this.closed || this.local.has(path) || isBinaryProjectPath(path)) return null;
    const existing = this.sessions.get(path);
    if (existing) {
      this.options.mirror(path, existing.text());
      return existing;
    }
    const text = this.options.initialText(path);
    if (text === null) return null;
    const session: RemoteDocumentSession = new RemoteDocumentSession(path, text, {
      transport: this.options.transport,
      readOnly: this.options.readOnly,
      onText: (next) => this.options.mirror(session.path, next),
      onPhase: (phase) => {
        if (phase === "detached") this.detach(session.path, session);
      },
      onDiscarded: (reason) => this.options.discarded?.(session.path, reason),
    });
    this.sessions.set(path, session);
    void session.open();
    return session;
  }

  holds(path: string): boolean {
    return !this.closed && this.sessions.has(path);
  }

  async flush(write: () => Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS);
    });
    try {
      await Promise.race([Promise.all([...this.sessions.values()].map((session) => session.settled())), timeout]);
    } finally {
      clearTimeout(timer);
    }
    await write();
  }

  move(from: string, to: string): void {
    const moved = (path: string) =>
      path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
    const sessions = [...this.sessions.entries()];
    const local = [...this.local];
    for (const [path, session] of sessions) {
      const next = moved(path);
      if (next === null) continue;
      this.sessions.delete(path);
      this.sessions.get(next)?.close();
      session.moveTo(next);
      this.sessions.set(next, session);
    }
    for (const path of local) {
      const next = moved(path);
      if (next === null) continue;
      this.local.delete(path);
      this.local.add(next);
    }
  }

  forget(path: string): void {
    const covered = (known: string) => known === path || known.startsWith(`${path}/`);
    for (const [known, session] of this.sessions.entries()) {
      if (!covered(known)) continue;
      this.sessions.delete(known);
      void session.settled().then(() => session.close());
    }
    for (const known of this.local) {
      if (covered(known)) this.local.delete(known);
    }
  }

  // The tab for `path` closed. Once the shared document has every change,
  // the session closes, so a file nobody shows no longer costs a copy of
  // its text and a round of work for every remote edit. Opening the file
  // again starts a fresh session from the shared text.
  release(path: string): void {
    const session = this.sessions.get(path);
    if (!session) return;
    void session.settled().then(() => {
      if (this.sessions.get(session.path) !== session || this.options.shown?.(session.path)) return;
      this.sessions.delete(session.path);
      session.close();
    });
  }

  // Live editing stopped. Typing Rust never confirmed goes back as unsaved,
  // so it still reaches the disk; the store only holds it as saved text.
  close(): void {
    this.closed = true;
    for (const [path, session] of this.sessions) {
      const edited = session.unconfirmed;
      const shared = edited ? sharedText(session) : null;
      session.close();
      if (shared !== null) this.options.detached(path, session.text(), true, shared);
    }
    this.sessions.clear();
    this.local.clear();
  }

  private detach(path: string, session: RemoteDocumentSession): void {
    if (this.sessions.get(path) !== session) return;
    // Typing Rust never confirmed has to be saved locally now. A reopen keeps
    // it as pending, so "synchronized" alone can't tell.
    const edited = session.unconfirmed;
    const shared = sharedText(session);
    this.sessions.delete(path);
    this.local.add(path);
    session.close();
    this.options.detached(path, session.text(), edited, shared);
  }
}

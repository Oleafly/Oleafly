import { isBinaryProjectPath } from "@/lib/project-paths";
import { type DiscardReason, RemoteDocumentSession, type RemoteSessionTransport } from "./remote-session";

export interface LiveSessionsOptions {
  transport: RemoteSessionTransport;
  readOnly: () => boolean;
  initialText(path: string): string | null;
  mirror(path: string, text: string): void;
  coauthorEdited?(path: string, text: string): void;
  detached(path: string, text: string, edited: boolean, shared: string): void;
  discarded?(path: string, reason: DiscardReason): void;
  shown?(path: string): boolean;
  settleTimeoutMs?: number;
}

const SETTLE_TIMEOUT_MS = 3_000;

function sharedText(session: RemoteDocumentSession): string {
  try {
    return session.confirmed();
  } catch {
    return session.text();
  }
}

export async function settledWithin(
  sessions: readonly Pick<RemoteDocumentSession, "settled">[],
  ms: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([Promise.all(sessions.map((session) => session.settled())), timeout]);
  } finally {
    clearTimeout(timer);
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
      onDiscarded: (reason) => this.options.discarded?.(session.path, reason),
    });
    session.subscribePhase((phase) => {
      if (phase === "detached") this.detach(session.path, session);
    });
    session.subscribe(() => this.options.coauthorEdited?.(session.path, session.text()));
    this.sessions.set(path, session);
    void session.open();
    return session;
  }

  holds(path: string): boolean {
    return !this.closed && this.sessions.has(path);
  }

  async flush(write: () => Promise<void>): Promise<void> {
    await this.settledWithin([...this.sessions.values()], this.options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS);
    await write();
  }

  private settledWithin(sessions: readonly RemoteDocumentSession[], ms: number): Promise<void> {
    return settledWithin(sessions, ms);
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

  relive(path: string): void {
    this.local.delete(path);
  }

  release(path: string): void {
    const session = this.sessions.get(path);
    if (!session) return;
    void session.settled().then(() => {
      if (this.sessions.get(session.path) !== session || this.options.shown?.(session.path)) return;
      this.sessions.delete(session.path);
      session.close();
    });
  }

  async handBack(waitMs: number): Promise<void> {
    const open = [...this.sessions];
    if (open.length === 0) return;
    await this.settledWithin(
      open.map(([, session]) => session),
      waitMs,
    );
    for (const [path, session] of open) {
      if (this.sessions.get(path) !== session || !session.unconfirmed) continue;
      this.sessions.delete(path);
      this.local.add(path);
      this.handOver(path, session, true);
      this.local.delete(path);
    }
  }

  close(): void {
    this.closed = true;
    for (const [path, session] of this.sessions) {
      if (session.unconfirmed) this.handOver(path, session, true);
      else session.close();
    }
    this.sessions.clear();
    this.local.clear();
  }

  private detach(path: string, session: RemoteDocumentSession): void {
    if (this.sessions.get(path) !== session) return;
    const reason = session.detachedBecause;
    const gone = reason === "removed" || reason === "replaced";
    this.sessions.delete(path);
    if (reason !== "replaced") this.local.add(path);
    this.handOver(path, session, !gone && session.unconfirmed);
  }

  private handOver(path: string, session: RemoteDocumentSession, edited: boolean): void {
    this.options.detached(path, session.text(), edited, sharedText(session));
    session.close();
  }
}

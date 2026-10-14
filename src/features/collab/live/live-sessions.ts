import { isBinaryProjectPath } from "@/lib/project-paths";
import { RemoteDocumentSession, type RemoteSessionTransport } from "./remote-session";

export interface LiveSessionsOptions {
  transport: RemoteSessionTransport;
  readOnly: () => boolean;
  initialText(path: string): string | null;
  mirror(path: string, text: string): void;
  detached(path: string, text: string, edited: boolean): void;
  settleTimeoutMs?: number;
}

const SETTLE_TIMEOUT_MS = 3_000;

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

  close(): void {
    this.closed = true;
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    this.local.clear();
  }

  private detach(path: string, session: RemoteDocumentSession): void {
    if (this.sessions.get(path) !== session) return;
    const edited = !session.synchronized;
    this.sessions.delete(path);
    this.local.add(path);
    session.close();
    this.options.detached(path, session.text(), edited);
  }
}

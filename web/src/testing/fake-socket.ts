import type { GatewaySocket, SocketFactory, SocketHandlers } from "../gateway";
import type { ClientFrame } from "../protocol";

export class FakeSocket implements GatewaySocket {
  readonly sent: ClientFrame[] = [];
  closed = false;
  readonly url: string;
  private readonly handlers: SocketHandlers;

  constructor(url: string, handlers: SocketHandlers) {
    this.url = url;
    this.handlers = handlers;
  }

  send(data: string): void {
    if (this.closed) throw new Error("closed");
    this.sent.push(JSON.parse(data) as ClientFrame);
  }

  close(): void {
    this.closed = true;
  }

  emit(frame: Record<string, unknown>): void {
    this.handlers.message(JSON.stringify(frame));
  }

  raw(data: string): void {
    this.handlers.message(data);
  }

  drop(code = 1006): void {
    this.closed = true;
    this.handlers.close(code, "");
  }

  frames<T extends ClientFrame["t"]>(type: T): Extract<ClientFrame, { t: T }>[] {
    return this.sent.filter((frame): frame is Extract<ClientFrame, { t: T }> => frame.t === type);
  }
}

export class FakeServer {
  readonly sockets: FakeSocket[] = [];

  readonly factory: SocketFactory = (url, handlers) => {
    const socket = new FakeSocket(url, handlers);
    this.sockets.push(socket);
    return socket;
  };

  get current(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error("No socket was opened.");
    return socket;
  }
}

export class ManualTimers {
  readonly pending: { run: () => void; ms: number; cancelled: boolean }[] = [];

  readonly setTimer = (run: () => void, ms: number) => {
    const entry = { run, ms, cancelled: false };
    this.pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };

  get delays(): number[] {
    return this.pending.filter((entry) => !entry.cancelled).map((entry) => entry.ms);
  }

  runNext(): void {
    const index = this.pending.findIndex((entry) => !entry.cancelled);
    if (index < 0) throw new Error("No timer is waiting.");
    const [entry] = this.pending.splice(index, 1);
    entry.run();
  }
}

export const TEST_FILES = [
  { fileId: "f-main", path: "main.tex", kind: "text" },
  { fileId: "f-refs", path: "refs.bib", kind: "text" },
  { fileId: "f-fig", path: "figures/plot.png", kind: "blob", blob: "hash-1" },
];

export function hello(role = "owner", extra: Record<string, unknown> = {}) {
  return { t: "hello", role, features: { suggestions: true, chat: true }, files: TEST_FILES, ...extra };
}

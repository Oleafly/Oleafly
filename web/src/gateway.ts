import type { CollabDocMessage, CollabDocOpened, CollabTextOperation } from "@oleafly/backend-port";
import { TextOperation } from "@/features/collab/live/ot";
import type { RemoteSessionTransport } from "@/features/collab/live/remote-session";
import {
  type ClientFrame,
  type CollabChatMessage,
  type CollabEditMode,
  type CollabOutputInfo,
  type CollabProjectRole,
  type CompileSettings,
  parseServerFrame,
  type ServerFrame,
  type SuggestionsFrame,
  type ThreadsFrame,
  type WebFeatures,
  type WebFile,
  type WebPeer,
  type WebPerson,
} from "./protocol";

export interface SocketHandlers {
  open(): void;
  message(data: string): void;
  close(code: number, reason: string): void;
}

export interface GatewaySocket {
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => GatewaySocket;

export type GatewayState = "connecting" | "online" | "offline" | "ended";
export type GatewayEnd = "signed_out" | "no_access" | "stopped";
export type ProbeResult = "ok" | "signed_out" | "no_access";

export interface HelloInfo {
  role: CollabProjectRole;
  features: WebFeatures;
  files: WebFile[];
  people: WebPerson[];
  compile: CompileSettings;
}

export interface GatewayListener {
  hello?(info: HelloInfo): void;
  tree?(files: WebFile[]): void;
  presence?(peers: WebPeer[]): void;
  threads?(frame: ThreadsFrame): void;
  suggestions?(frame: SuggestionsFrame): void;
  chat?(messages: CollabChatMessage[]): void;
  output?(items: CollabOutputInfo[]): void;
  compile?(settings: CompileSettings): void;
  access?(role: CollabProjectRole): void;
  error?(code: string, message: string): void;
  state?(state: GatewayState, end: GatewayEnd | null): void;
  delivered?(fileId: string): void;
}

export interface GatewayOptions {
  url: string;
  listener: GatewayListener;
  createSocket?: SocketFactory;
  setTimer?: (run: () => void, ms: number) => () => void;
  random?: () => number;
  probe?: () => Promise<ProbeResult>;
}

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 15_000;
export const PROBE_AFTER_FAILURES = 2;

const SIGNED_OUT_CODES = new Set(["unauthorized", "signed_out", "session_expired"]);
const NO_ACCESS_CODES = new Set(["forbidden", "not_found", "removed", "project_not_shared", "archived"]);

export function reconnectDelay(attempt: number, random: () => number): number {
  const exponent = Math.min(attempt, 10);
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** exponent);
  return Math.round(base * (0.8 + 0.4 * random()));
}

export const browserSocket: SocketFactory = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.onopen = () => handlers.open();
  socket.onmessage = (event) => {
    if (typeof event.data === "string") handlers.message(event.data);
  };
  socket.onclose = (event) => handlers.close(event.code, event.reason);
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
  };
};

const defaultTimer = (run: () => void, ms: number) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

interface DocChannel {
  path: string;
  token: number;
  fileId: string | null;
  opened: boolean;
  onMessage: (message: CollabDocMessage) => void;
  resolve: ((opened: CollabDocOpened | null) => void) | null;
  inflight: TextOperation | null;
}

class OfflineError extends Error {
  constructor() {
    super("The connection to the server is down.");
    this.name = "OfflineError";
  }
}

export class WebGateway {
  readonly transport: RemoteSessionTransport;
  private readonly options: GatewayOptions;
  private readonly createSocket: SocketFactory;
  private readonly setTimer: (run: () => void, ms: number) => () => void;
  private readonly random: () => number;
  private socket: GatewaySocket | null = null;
  private generation = 0;
  private current: GatewayState = "connecting";
  private ended: GatewayEnd | null = null;
  private attempt = 0;
  private failures = 0;
  private cancelRetry: (() => void) | null = null;
  private files: WebFile[] = [];
  private readonly channels = new Map<string, DocChannel>();
  private waiting: DocChannel[] = [];
  private tokens = 0;
  private mode: CollabEditMode | null = null;
  private presence: Extract<ClientFrame, { t: "presence" }> | null = null;

  constructor(options: GatewayOptions) {
    this.options = options;
    this.createSocket = options.createSocket ?? browserSocket;
    this.setTimer = options.setTimer ?? defaultTimer;
    this.random = options.random ?? Math.random;
    this.transport = {
      open: (path, onMessage) => this.openDoc(path, onMessage),
      change: (fileId, rev, op) => this.changeDoc(fileId, rev, op),
      close: (fileId, session) => this.closeDoc(fileId, session),
    };
  }

  get state(): GatewayState {
    return this.current;
  }

  get end(): GatewayEnd | null {
    return this.ended;
  }

  get online(): boolean {
    return this.current === "online";
  }

  start(): void {
    if (this.current === "ended" || this.socket) return;
    this.connect();
  }

  stop(): void {
    this.finish("stopped");
  }

  send(frame: ClientFrame): boolean {
    if (!this.online || !this.socket) return false;
    try {
      this.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  setMode(mode: CollabEditMode): boolean {
    this.mode = mode;
    return this.send({ t: "mode", mode });
  }

  setPresence(fileId: string | null, anchor: number | null, head: number | null): void {
    this.presence = { t: "presence", fileId, anchor, head };
    this.send(this.presence);
  }

  fileIdFor(path: string): string | null {
    return this.files.find((file) => file.path === path && file.kind !== "dir")?.fileId ?? null;
  }

  private setState(state: GatewayState): void {
    if (this.current === state) return;
    this.current = state;
    this.options.listener.state?.(state, this.ended);
  }

  private connect(): void {
    const generation = ++this.generation;
    this.cancelRetry = null;
    let greeted = false;
    const live = () => generation === this.generation;
    this.setState(this.attempt === 0 && this.files.length === 0 ? "connecting" : "offline");
    let socket: GatewaySocket;
    try {
      socket = this.createSocket(this.options.url, {
        open: () => undefined,
        message: (data) => {
          if (!live()) return;
          const frame = parseServerFrame(data);
          if (!frame) return;
          if (frame.t === "hello") greeted = true;
          this.receive(frame);
        },
        close: () => {
          if (!live()) return;
          this.socket = null;
          this.lost(greeted);
        },
      });
    } catch {
      this.socket = null;
      this.lost(false);
      return;
    }
    this.socket = socket;
  }

  private lost(greeted: boolean): void {
    if (this.current === "ended") return;
    this.dropChannels();
    if (greeted) {
      this.attempt = 0;
      this.failures = 0;
    } else {
      this.failures += 1;
    }
    this.setState("offline");
    if (!greeted && this.failures >= PROBE_AFTER_FAILURES && this.options.probe) {
      const generation = this.generation;
      this.options.probe().then(
        (result) => {
          if (generation !== this.generation || this.current === "ended") return;
          if (result === "ok") this.retry();
          else this.finish(result);
        },
        () => {
          if (generation === this.generation && this.current !== "ended") this.retry();
        },
      );
      return;
    }
    this.retry();
  }

  private retry(): void {
    const delay = reconnectDelay(this.attempt, this.random);
    this.attempt += 1;
    this.cancelRetry = this.setTimer(() => {
      if (this.current === "ended") return;
      this.connect();
    }, delay);
  }

  private finish(end: GatewayEnd): void {
    if (this.current === "ended") return;
    this.ended = end;
    this.generation += 1;
    this.cancelRetry?.();
    this.cancelRetry = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      this.socket = null;
    }
    for (const channel of [...this.channels.values(), ...this.waiting]) channel.resolve?.(null);
    this.channels.clear();
    this.waiting = [];
    this.setState("ended");
  }

  private dropChannels(): void {
    for (const channel of this.channels.values()) {
      if (channel.opened) continue;
      channel.fileId = null;
      this.waiting.push(channel);
    }
    this.channels.clear();
  }

  private receive(frame: ServerFrame): void {
    const listener = this.options.listener;
    switch (frame.t) {
      case "hello":
        this.greet(frame);
        return;
      case "tree":
        this.files = frame.files;
        listener.tree?.(frame.files);
        return;
      case "opened":
      case "ack":
      case "remote":
      case "reset":
        this.routeDoc(frame);
        listener.delivered?.(frame.fileId);
        return;
      case "presence":
        listener.presence?.(frame.peers);
        return;
      case "threads":
        listener.threads?.(frame);
        return;
      case "suggestions":
        listener.suggestions?.(frame);
        return;
      case "chat":
        listener.chat?.(frame.messages);
        return;
      case "output":
        listener.output?.(frame.items);
        return;
      case "compile":
        listener.compile?.(frame.settings);
        return;
      case "access":
        listener.access?.(frame.role);
        return;
      case "error":
        this.refused(frame.code, frame.message);
        return;
    }
  }

  private greet(frame: Extract<ServerFrame, { t: "hello" }>): void {
    this.files = frame.files;
    this.attempt = 0;
    this.failures = 0;
    this.setState("online");
    if (this.mode && (frame.role === "owner" || frame.role === "editor")) this.send({ t: "mode", mode: this.mode });
    if (this.presence) this.send(this.presence);
    this.options.listener.hello?.({
      role: frame.role,
      features: frame.features,
      files: frame.files,
      people: frame.people,
      compile: frame.compile,
    });
    const waiting = this.waiting;
    this.waiting = [];
    for (const channel of waiting) this.attach(channel);
  }

  private refused(code: string, message: string): void {
    if (SIGNED_OUT_CODES.has(code)) {
      this.finish("signed_out");
      return;
    }
    if (NO_ACCESS_CODES.has(code) && !this.online) {
      this.finish("no_access");
      return;
    }
    if (code === "project_removed" || code === "access_removed") {
      this.finish("no_access");
      return;
    }
    this.options.listener.error?.(code, message);
  }

  private openDoc(path: string, onMessage: (message: CollabDocMessage) => void): Promise<CollabDocOpened | null> {
    if (this.current === "ended") return Promise.resolve(null);
    return new Promise((resolve) => {
      const channel: DocChannel = {
        path,
        token: ++this.tokens,
        fileId: null,
        opened: false,
        onMessage,
        resolve,
        inflight: null,
      };
      this.waiting = this.waiting.filter((waiting) => {
        if (waiting.path !== path) return true;
        waiting.resolve?.(null);
        return false;
      });
      if (this.online) this.attach(channel);
      else this.waiting.push(channel);
    });
  }

  private attach(channel: DocChannel): void {
    const fileId = this.fileIdFor(channel.path);
    if (!fileId) {
      channel.resolve?.(null);
      channel.resolve = null;
      return;
    }
    const previous = this.channels.get(fileId);
    if (previous && previous !== channel) {
      previous.resolve?.(null);
      previous.resolve = null;
    }
    channel.fileId = fileId;
    this.channels.set(fileId, channel);
    if (!this.send({ t: "open", fileId })) {
      this.channels.delete(fileId);
      channel.fileId = null;
      this.waiting.push(channel);
    }
  }

  private changeDoc(fileId: string, rev: number, op: CollabTextOperation): Promise<void> {
    const channel = this.channels.get(fileId);
    if (!channel?.opened || !this.online) return Promise.reject(new OfflineError());
    try {
      channel.inflight = TextOperation.fromWire(op);
    } catch {
      channel.inflight = null;
    }
    if (!this.send({ t: "change", fileId, rev, op })) {
      channel.inflight = null;
      return Promise.reject(new OfflineError());
    }
    return Promise.resolve();
  }

  private closeDoc(fileId: string, token: number): void {
    const channel = this.channels.get(fileId);
    if (!channel) {
      this.waiting = this.waiting.filter((waiting) => {
        if (waiting.token !== token) return true;
        waiting.resolve?.(null);
        return false;
      });
      return;
    }
    if (channel.token !== token) return;
    this.channels.delete(fileId);
    channel.resolve?.(null);
    channel.resolve = null;
    this.send({ t: "close", fileId });
  }

  private routeDoc(frame: Extract<ServerFrame, { t: "opened" | "ack" | "remote" | "reset" }>): void {
    const channel = this.channels.get(frame.fileId);
    if (!channel) return;
    if (frame.t === "opened") {
      channel.inflight = null;
      if (!channel.opened) {
        channel.opened = true;
        const resolve = channel.resolve;
        channel.resolve = null;
        resolve?.({ file_id: frame.fileId, rev: frame.rev, text: frame.text, session: channel.token });
        return;
      }
      channel.onMessage({ kind: "reset", rev: frame.rev, text: frame.text });
      return;
    }
    if (frame.t === "reset") {
      channel.inflight = null;
      channel.onMessage({ kind: "reset", rev: frame.rev, text: frame.text });
      return;
    }
    if (frame.t === "remote") {
      if (channel.inflight) {
        try {
          [channel.inflight] = TextOperation.transform(channel.inflight, TextOperation.fromWire(frame.op));
        } catch {
          channel.inflight = null;
        }
      }
      channel.onMessage({ kind: "remote", rev: frame.rev, op: frame.op, length: frame.length });
      return;
    }
    const length = frame.length ?? channel.inflight?.targetLength ?? -1;
    channel.inflight = null;
    channel.onMessage({ kind: "ack", rev: frame.rev, length });
  }
}

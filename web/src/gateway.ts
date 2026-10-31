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
  type RequestFrame,
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
export type GatewayEnd = "signed_out" | "no_access" | "too_large" | "stopped";
export type ProbeResult = "ok" | "signed_out" | "no_access";

export interface HelloInfo {
  fresh: boolean;
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
  instance?: string;
}

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 15_000;
export const PROBE_AFTER_FAILURES = 2;
export const MAX_CHANGE_BYTES = 10 * 1024 * 1024;

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
  target: string | null;
  token: number;
  fileId: string | null;
  opened: boolean;
  onMessage: (message: CollabDocMessage) => void;
  resolve: ((opened: CollabDocOpened | null) => void) | null;
  inflight: TextOperation | null;
  changeId: string | null;
  resuming: boolean;
  quiet: boolean;
}

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class OfflineError extends Error {
  constructor() {
    super("offline");
    this.name = "OfflineError";
  }
}

export class RefusedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message || code);
    this.name = "RefusedError";
    this.code = code;
  }
}

function tooLarge(data: string): boolean {
  if (data.length * 3 <= MAX_CHANGE_BYTES) return false;
  return new TextEncoder().encode(data).byteLength > MAX_CHANGE_BYTES;
}

function newInstance(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
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
  private readonly held = new Map<string, DocChannel>();
  private waiting: DocChannel[] = [];
  private tokens = 0;
  private mode: CollabEditMode | null = null;
  private presence: Extract<ClientFrame, { t: "presence" }> | null = null;
  private readonly instance: string;
  private changes = 0;
  private requestIds = 0;
  private readonly requests = new Map<string, PendingRequest>();
  private readonly resumes = new Map<string, string>();
  private readonly resumeAnswers = new Map<string, boolean>();

  constructor(options: GatewayOptions) {
    this.options = options;
    this.createSocket = options.createSocket ?? browserSocket;
    this.setTimer = options.setTimer ?? defaultTimer;
    this.random = options.random ?? Math.random;
    this.instance = options.instance ?? newInstance();
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
    return this.sendText(JSON.stringify(frame));
  }

  request(frame: RequestFrame): Promise<void> {
    const reqId = `${this.instance}:r${++this.requestIds}`;
    if (!this.send({ ...frame, reqId })) return Promise.reject(new OfflineError());
    return new Promise((resolve, reject) => {
      this.requests.set(reqId, { resolve, reject });
    });
  }

  inflight(fileId: string): { id: string; op: CollabTextOperation } | null {
    const channel = this.channels.get(fileId) ?? this.held.get(fileId);
    return channel?.inflight && channel.changeId ? { id: channel.changeId, op: channel.inflight.toWire() } : null;
  }

  resumeOnOpen(fileId: string, id: string): void {
    this.resumes.set(fileId, id);
  }

  resumedOf(fileId: string): boolean | null {
    const answer = this.resumeAnswers.get(fileId);
    this.resumeAnswers.delete(fileId);
    return answer ?? null;
  }

  holds(fileId: string): boolean {
    return this.held.has(fileId) || this.channels.get(fileId)?.resuming === true;
  }

  private sendText(data: string): boolean {
    if (!this.online || !this.socket) return false;
    try {
      this.socket.send(data);
      return true;
    } catch {
      return false;
    }
  }

  private failRequests(): void {
    const pending = [...this.requests.values()];
    this.requests.clear();
    for (const request of pending) request.reject(new OfflineError());
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
          if (frame.t === "hello") {
            const fresh = !greeted;
            greeted = true;
            this.greet(frame, fresh);
            return;
          }
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
    this.failRequests();
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
    this.held.clear();
    this.waiting = [];
    this.failRequests();
    this.setState("ended");
  }

  private dropChannels(): void {
    for (const channel of this.channels.values()) {
      if (channel.opened) {
        if (channel.fileId && channel.inflight && channel.changeId) {
          channel.resuming = false;
          this.held.set(channel.fileId, channel);
        }
        continue;
      }
      channel.fileId = null;
      this.waiting.push(channel);
    }
    this.channels.clear();
  }

  private receive(frame: Exclude<ServerFrame, { t: "hello" }>): void {
    const listener = this.options.listener;
    switch (frame.t) {
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
      case "done":
        this.answered(frame.reqId, null);
        return;
      case "error":
        if (frame.reqId && this.answered(frame.reqId, new RefusedError(frame.code, frame.message))) return;
        this.refused(frame.code, frame.message);
        return;
    }
  }

  private answered(reqId: string, error: Error | null): boolean {
    const request = this.requests.get(reqId);
    if (!request) return false;
    this.requests.delete(reqId);
    if (error) request.reject(error);
    else request.resolve();
    return true;
  }

  private greet(frame: Extract<ServerFrame, { t: "hello" }>, fresh: boolean): void {
    this.files = frame.files;
    this.attempt = 0;
    this.failures = 0;
    this.setState("online");
    if (this.mode && (frame.role === "owner" || frame.role === "editor")) this.send({ t: "mode", mode: this.mode });
    if (this.presence) this.send(this.presence);
    this.options.listener.hello?.({
      fresh,
      role: frame.role,
      features: frame.features,
      files: frame.files,
      people: frame.people,
      compile: frame.compile,
    });
    this.resume();
    const waiting = this.waiting;
    this.waiting = [];
    for (const channel of waiting) this.attach(channel);
  }

  private resume(): void {
    const held = [...this.held];
    this.held.clear();
    for (const [fileId, channel] of held) {
      if (!this.files.some((file) => file.fileId === fileId && file.kind === "text")) continue;
      channel.resuming = true;
      this.channels.set(fileId, channel);
      const resume = channel.changeId ?? undefined;
      if (!this.send({ t: "open", fileId, resume })) {
        this.channels.delete(fileId);
        channel.resuming = false;
        this.held.set(fileId, channel);
      }
    }
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
    if (code === "project_too_large" && !this.online) {
      this.finish("too_large");
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
      const target = this.fileIdFor(path);
      const channel: DocChannel = {
        path,
        target,
        token: ++this.tokens,
        fileId: null,
        opened: false,
        onMessage,
        resolve,
        inflight: null,
        changeId: null,
        resuming: false,
        quiet: false,
      };
      if (target) this.held.delete(target);
      this.waiting = this.waiting.filter((waiting) => {
        if (waiting.path !== path && (target === null || waiting.target !== target)) return true;
        waiting.resolve?.(null);
        return false;
      });
      if (this.online) this.attach(channel);
      else this.waiting.push(channel);
    });
  }

  private attach(channel: DocChannel): void {
    const fileId = channel.target
      ? this.files.some((file) => file.fileId === channel.target)
        ? channel.target
        : null
      : this.fileIdFor(channel.path);
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
    if (!this.send({ t: "open", fileId, resume: this.resumes.get(fileId) })) {
      this.channels.delete(fileId);
      channel.fileId = null;
      this.waiting.push(channel);
    }
  }

  private changeDoc(fileId: string, rev: number, op: CollabTextOperation): Promise<void> {
    const channel = this.channels.get(fileId);
    if (channel?.quiet) return Promise.resolve();
    if (!channel?.opened || channel.resuming || !this.online) return Promise.reject(new OfflineError());
    const id = `${this.instance}:${++this.changes}`;
    const data = JSON.stringify({ t: "change", fileId, rev, op, id });
    if (tooLarge(data)) {
      channel.inflight = null;
      channel.changeId = null;
      this.options.listener.error?.("too_large", "");
      this.send({ t: "open", fileId });
      return Promise.resolve();
    }
    try {
      channel.inflight = TextOperation.fromWire(op);
    } catch {
      channel.inflight = null;
    }
    channel.changeId = id;
    if (!this.sendText(data)) {
      channel.inflight = null;
      channel.changeId = null;
      return Promise.reject(new OfflineError());
    }
    return Promise.resolve();
  }

  private closeDoc(fileId: string, token: number): void {
    const kept = this.held.get(fileId);
    if (kept?.token === token) this.held.delete(fileId);
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
      const inflight = channel.resuming && frame.resumed === true ? channel.inflight : null;
      channel.inflight = null;
      channel.changeId = null;
      channel.resuming = false;
      if (!channel.opened) {
        channel.opened = true;
        if (this.resumes.delete(frame.fileId) && frame.resumed !== null) {
          this.resumeAnswers.set(frame.fileId, frame.resumed);
        }
        const resolve = channel.resolve;
        channel.resolve = null;
        resolve?.({ file_id: frame.fileId, rev: frame.rev, text: frame.text, session: channel.token });
        return;
      }
      if (inflight) {
        channel.quiet = true;
        try {
          channel.onMessage({ kind: "ack", rev: frame.rev, length: inflight.targetLength });
        } finally {
          channel.quiet = false;
        }
      }
      channel.onMessage({ kind: "reset", rev: frame.rev, text: frame.text });
      return;
    }
    if (frame.t === "reset") {
      channel.inflight = null;
      channel.changeId = null;
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
    channel.changeId = null;
    channel.onMessage({ kind: "ack", rev: frame.rev, length });
  }
}

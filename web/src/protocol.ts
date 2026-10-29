import type {
  CollabChatMessage,
  CollabCommentMember,
  CollabCommentThread,
  CollabEditMode,
  CollabOutputInfo,
  CollabProjectRole,
  CollabSuggestion,
  CollabTextOperation,
} from "@oleafly/backend-port";

export type {
  CollabChatMessage,
  CollabEditMode,
  CollabOutputInfo,
  CollabProjectRole,
  CollabSuggestion,
  CollabSuggestionKind,
} from "@oleafly/backend-port";

export type WebFileKind = "dir" | "text" | "blob";

export interface WebFile {
  fileId: string;
  path: string;
  kind: WebFileKind;
  blob: string | null;
}

export interface WebFeatures {
  comments: boolean;
  suggestions: boolean;
  chat: boolean;
}

export interface WebPeer {
  deviceId: string;
  accountId: string;
  name: string | null;
  fileId: string | null;
  anchor: number | null;
  head: number | null;
}

/** The project's compile settings as the server stores them: setting name to value. */
export type CompileSettings = Readonly<Record<string, string>>;

export interface WebPerson {
  accountId: string;
  name: string;
  avatarUrl: string | null;
  login: string | null;
}

export type ServerFrame =
  | {
      t: "hello";
      role: CollabProjectRole;
      features: WebFeatures;
      files: WebFile[];
      people: WebPerson[];
      compile: CompileSettings;
    }
  | { t: "opened"; fileId: string; rev: number; text: string }
  | { t: "ack"; fileId: string; rev: number; length: number | null }
  | { t: "remote"; fileId: string; rev: number; op: CollabTextOperation; length: number }
  | { t: "reset"; fileId: string; rev: number; text: string }
  | { t: "tree"; files: WebFile[] }
  | { t: "presence"; peers: WebPeer[] }
  | { t: "threads"; fileId: string; rev: number | null; threads: CollabCommentThread[] }
  | { t: "suggestions"; fileId: string; rev: number | null; suggestions: CollabSuggestion[] }
  | { t: "chat"; messages: CollabChatMessage[] }
  | { t: "output"; items: CollabOutputInfo[] }
  | { t: "compile"; settings: CompileSettings }
  | { t: "access"; role: CollabProjectRole }
  | { t: "error"; code: string; message: string };

export type ThreadsFrame = Extract<ServerFrame, { t: "threads" }>;
export type SuggestionsFrame = Extract<ServerFrame, { t: "suggestions" }>;

export type CommentFrame =
  | {
      action: "create";
      fileId: string;
      path: string;
      from: number;
      to: number;
      rev: number | null;
      body: string;
      members: CollabCommentMember[];
    }
  | { action: "reply"; fileId: string; threadId: string; body: string; members: CollabCommentMember[] }
  | {
      action: "edit";
      fileId: string;
      threadId: string;
      messageId: string;
      body: string;
      members: CollabCommentMember[];
    }
  | { action: "delete"; fileId: string; threadId: string; messageId: string }
  | { action: "resolve"; fileId: string; threadId: string }
  | { action: "reopen"; fileId: string; threadId: string };

export type SuggestionFrame =
  | { action: "accept" | "reject" | "withdraw"; ids: string[] }
  | { action: "accept_file" | "reject_file"; fileId: string };

export type ChatFrame = { action: "send"; body: string } | { action: "delete"; id: string } | { action: "clear" };

export type ClientFrame =
  | { t: "open"; fileId: string }
  | { t: "change"; fileId: string; rev: number; op: CollabTextOperation }
  | { t: "close"; fileId: string }
  | { t: "mode"; mode: CollabEditMode }
  | { t: "presence"; fileId: string | null; anchor: number | null; head: number | null }
  | ({ t: "comment" } & CommentFrame)
  | ({ t: "suggestion" } & SuggestionFrame)
  | ({ t: "chat" } & ChatFrame);

const ROLES = new Set<CollabProjectRole>(["owner", "editor", "reviewer", "commenter", "viewer"]);

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function count(value: unknown): number | null {
  const number = whole(value);
  return number !== null && number >= 0 ? number : null;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function list<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const parsed: T[] = [];
  for (const item of value) {
    const entry = parse(item);
    if (entry !== null) parsed.push(entry);
  }
  return parsed;
}

export function parseRole(value: unknown): CollabProjectRole {
  return typeof value === "string" && ROLES.has(value as CollabProjectRole) ? (value as CollabProjectRole) : "unknown";
}

export function parseFeatures(value: unknown): WebFeatures {
  const raw = isRecord(value) ? value : {};
  const flag = (key: string) => raw[key] !== false;
  return { comments: flag("comments"), suggestions: flag("suggestions"), chat: flag("chat") };
}

export function parseCompileSettings(value: unknown): CompileSettings {
  if (!isRecord(value)) return {};
  const settings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") settings[key] = entry;
  return settings;
}

export function parseFile(value: unknown): WebFile | null {
  if (!isRecord(value)) return null;
  const fileId = text(value.fileId) ?? text(value.file_id) ?? text(value.id);
  const path = text(value.path);
  if (!fileId || path === null || path === "") return null;
  const kind = value.kind === "dir" || value.kind === "blob" ? value.kind : "text";
  return { fileId, path, kind, blob: text(value.blob) ?? text(value.hash) };
}

export function parsePerson(value: unknown): WebPerson | null {
  if (!isRecord(value)) return null;
  const accountId = text(value.accountId) ?? text(value.account_id) ?? text(value.id);
  if (!accountId) return null;
  const name = text(value.displayName) ?? text(value.display_name) ?? text(value.name) ?? "";
  return {
    accountId,
    name,
    avatarUrl: text(value.avatarUrl) ?? text(value.avatar_url),
    login: text(value.login),
  };
}

function parsePeer(value: unknown): WebPeer | null {
  if (!isRecord(value)) return null;
  const accountId = text(value.accountId) ?? text(value.account_id);
  const deviceId = text(value.deviceId) ?? text(value.device_id) ?? accountId;
  if (!accountId || !deviceId) return null;
  return {
    deviceId,
    accountId,
    name: text(value.name) ?? text(value.displayName) ?? text(value.display_name),
    fileId: text(value.fileId) ?? text(value.file_id),
    anchor: count(value.anchor),
    head: count(value.head) ?? count(value.cursor),
  };
}

function parseSuggestion(value: unknown, frameFile: string): CollabSuggestion | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const fileId = text(value.fileId) ?? frameFile;
  const from = count(value.from);
  const to = count(value.to);
  if (!id || !fileId || from === null || to === null || to < from) return null;
  if (value.kind !== "insert" && value.kind !== "delete") return null;
  return {
    id,
    fileId,
    kind: value.kind,
    author: text(value.author) ?? "",
    createdAt: finite(value.createdAt),
    from,
    to: value.kind === "delete" ? from : to,
    text: text(value.text) ?? "",
    threadId: text(value.threadId),
    verified: value.verified === true,
  };
}

function parseMessage(value: unknown): CollabCommentThread["messages"][number] | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  return {
    id,
    author: text(value.author) ?? "",
    at: finite(value.at),
    body: text(value.body) ?? "",
    editedAt: typeof value.editedAt === "number" ? value.editedAt : null,
    deleted: value.deleted === true,
    mentions: list(value.mentions, text),
    verified: value.verified === true,
  };
}

function parseThread(value: unknown, frameFile: string): CollabCommentThread | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const fileId = text(value.fileId) ?? frameFile;
  if (!id || !fileId) return null;
  const anchor = isRecord(value.anchor) ? value.anchor : {};
  const range = isRecord(anchor.range) ? anchor.range : null;
  const from = range ? count(range.from) : null;
  const to = range ? count(range.to) : null;
  const resolved = isRecord(value.resolved) ? value.resolved : null;
  return {
    id,
    fileId,
    anchor: {
      quote: text(anchor.quote) ?? "",
      range: from !== null && to !== null && to >= from ? { from, to } : null,
    },
    createdBy: text(value.createdBy) ?? "",
    createdAt: finite(value.createdAt),
    resolved: resolved
      ? { by: text(resolved.by) ?? "", at: finite(resolved.at), verified: resolved.verified === true }
      : null,
    messages: list(value.messages, parseMessage),
    verified: value.verified === true,
  };
}

function parseChatMessage(value: unknown): CollabChatMessage | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  return {
    id,
    author: text(value.author) ?? "",
    at: finite(value.at),
    body: text(value.body) ?? "",
    deleted: value.deleted === true,
    verified: value.verified === true,
  };
}

export function parseOutput(value: unknown): CollabOutputInfo | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "pdf" && value.kind !== "synctex") return null;
  return {
    kind: value.kind,
    size: count(value.size) ?? 0,
    compiledBy: text(value.compiledBy) ?? "",
    compiledAt: finite(value.compiledAt),
    mainFile: text(value.mainFile) ?? "",
  };
}

function parseOperation(value: unknown): CollabTextOperation | null {
  if (!Array.isArray(value)) return null;
  for (const step of value) {
    if (typeof step === "string") continue;
    if (typeof step !== "number" || !Number.isSafeInteger(step)) return null;
  }
  return value as CollabTextOperation;
}

function parseKnown(frame: Raw): ServerFrame | null {
  const fileId = text(frame.fileId);
  const rev = count(frame.rev);
  switch (frame.t) {
    case "hello":
      return {
        t: "hello",
        role: parseRole(frame.role),
        features: parseFeatures(frame.features),
        files: list(frame.files, parseFile),
        people: list(frame.people ?? frame.members, parsePerson),
        compile: parseCompileSettings(frame.compile),
      };
    case "opened":
      return fileId && rev !== null && typeof frame.text === "string"
        ? { t: "opened", fileId, rev, text: frame.text }
        : null;
    case "ack":
      return fileId && rev !== null ? { t: "ack", fileId, rev, length: count(frame.length) } : null;
    case "remote": {
      const op = parseOperation(frame.op);
      const length = count(frame.length);
      return fileId && rev !== null && op && length !== null ? { t: "remote", fileId, rev, op, length } : null;
    }
    case "reset":
      return fileId && rev !== null && typeof frame.text === "string"
        ? { t: "reset", fileId, rev, text: frame.text }
        : null;
    case "tree":
      return { t: "tree", files: list(frame.files, parseFile) };
    case "presence":
      return { t: "presence", peers: list(frame.peers, parsePeer) };
    case "threads":
      return fileId
        ? { t: "threads", fileId, rev, threads: list(frame.threads, (item) => parseThread(item, fileId)) }
        : null;
    case "suggestions":
      return fileId
        ? {
            t: "suggestions",
            fileId,
            rev,
            suggestions: list(frame.suggestions, (item) => parseSuggestion(item, fileId)),
          }
        : null;
    case "chat":
      return { t: "chat", messages: list(frame.messages, parseChatMessage) };
    case "output":
      return { t: "output", items: list(frame.items, parseOutput) };
    case "compile":
      return { t: "compile", settings: parseCompileSettings(frame.settings) };
    case "access":
      return { t: "access", role: parseRole(frame.role) };
    case "error":
      return { t: "error", code: text(frame.code) ?? "server", message: text(frame.message) ?? "" };
    default:
      return null;
  }
}

export function parseServerFrame(data: string): ServerFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  return isRecord(raw) ? parseKnown(raw) : null;
}

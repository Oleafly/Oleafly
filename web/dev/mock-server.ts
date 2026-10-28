import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { TextOperation } from "../../src/features/collab/live/ot.ts";
import {
  type Account,
  canComment,
  type ChangeResult,
  type ChatMessage,
  manages,
  minimalPdf,
  MockProject,
  type Mode,
  Refusal,
  type Role,
  type Wire,
} from "./mock-state.ts";

const PORT = Number(process.env.OLEAFLY_WEB_MOCK_PORT ?? 4874);
const HOST = process.env.OLEAFLY_WEB_MOCK_HOST ?? "127.0.0.1";
const COOKIE = "oleafly_web";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const ACCOUNTS: Account[] = [
  { accountId: "olive", name: "Olive Owner", login: "olive", email: "olive@example.test" },
  { accountId: "eddie", name: "Eddie Editor", login: "eddie", email: "eddie@example.test" },
  { accountId: "rita", name: "Rita Reviewer", login: "rita", email: "rita@example.test" },
  { accountId: "cora", name: "Cora Commenter", login: "cora", email: "cora@example.test" },
  { accountId: "vic", name: "Vic Viewer", login: "vic", email: "vic@example.test" },
  { accountId: "sam", name: "Sam Sample", login: "sam", email: "sam@example.test" },
];

const DIAGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect width="320" height="160" rx="12" fill="#e8f5e9"/><circle cx="80" cy="80" r="40" fill="#34B44A"/><rect x="160" y="50" width="120" height="60" rx="8" fill="#1b5e20"/></svg>';

function seedProject(): MockProject {
  const project = new MockProject("demo", "Graph Neural Networks for Sea Ice", "olive");
  project.roles.set("eddie", "editor");
  project.roles.set("rita", "reviewer");
  project.roles.set("cora", "commenter");
  project.roles.set("vic", "viewer");
  project.roles.set("sam", "reviewer");
  project.addText(
    "f-main",
    "main.tex",
    [
      "\\documentclass{article}",
      "\\usepackage{graphicx}",
      "\\title{Graph Neural Networks for Sea Ice}",
      "\\author{Olive Owner}",
      "",
      "\\begin{document}",
      "\\maketitle",
      "",
      "\\input{sections/intro}",
      "",
      "We model sea ice drift with a graph network trained on buoy data.",
      "",
      "\\bibliographystyle{plain}",
      "\\bibliography{refs}",
      "\\end{document}",
      "",
    ].join("\n"),
  );
  project.addText(
    "f-intro",
    "sections/intro.tex",
    "\\section{Introduction}\nSea ice moves with wind and ocean currents.\nPrevious work used grids \\cite{smith2020}.\n",
  );
  project.addText(
    "f-refs",
    "refs.bib",
    "@article{smith2020,\n  title = {Sea ice drift},\n  author = {Smith, Ann},\n  year = {2020}\n}\n",
  );
  project.addBlob("f-diagram", "figures/diagram.svg", "diagram");
  const main = project.text("f-main").text;
  const quoted = "buoy data";
  const at = main.indexOf(quoted);
  const thread = project.addThread("f-main", at, at + quoted.length, "eddie", "Should we say which buoys?");
  thread.messages.push(project.message("olive", "Yes, the IABP ones."));
  project.chat.push({ id: "chat-seed", author: "eddie", at: Date.now() - 3_600_000, body: "I pushed the intro draft.", deleted: false, verified: true });
  return project;
}

const projects = new Map<string, MockProject>([["demo", seedProject()]]);

class Peer {
  readonly account: Account;
  readonly role: Role;
  readonly deviceId: string;
  readonly project: MockProject;
  readonly open = new Set<string>();
  mode: Mode = "editing";
  presence: { fileId: string | null; anchor: number | null; head: number | null } = {
    fileId: null,
    anchor: null,
    head: null,
  };
  private readonly socket: Duplex | null;

  constructor(account: Account, role: Role, project: MockProject, socket: Duplex | null) {
    this.account = account;
    this.role = role;
    this.project = project;
    this.socket = socket;
    this.deviceId = `web-${account.accountId}-${Math.random().toString(36).slice(2, 8)}`;
  }

  get suggesting(): boolean {
    return this.role === "reviewer" || (manages(this.role) && this.mode === "suggesting");
  }

  send(frame: Record<string, unknown>): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(encodeFrame(Buffer.from(JSON.stringify(frame)), 0x1));
  }
}

const peers = new Set<Peer>();

function encodeFrame(payload: Buffer, opcode: number): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function frameReader(onText: (text: string) => void, onClose: () => void, onPing: (payload: Buffer) => void) {
  let buffered = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  return (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (buffered.length < 2) return;
      const fin = (buffered[0] & 0x80) !== 0;
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        length = Number(buffered.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (buffered.length < offset + maskLength + length) return;
      const mask = masked ? buffered.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(buffered.subarray(offset + maskLength, offset + maskLength + length));
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      buffered = buffered.subarray(offset + maskLength + length);
      if (opcode === 0x8) {
        onClose();
        return;
      }
      if (opcode === 0x9) {
        onPing(payload);
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload);
        if (fin) {
          onText(Buffer.concat(fragments).toString("utf8"));
          fragments = [];
        }
      }
    }
  };
}

function cookies(request: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) jar.set(name, decodeURIComponent(rest.join("=")));
  }
  return jar;
}

function accountOf(request: IncomingMessage): Account | null {
  const id = cookies(request).get(COOKIE);
  return ACCOUNTS.find((account) => account.accountId === id) ?? null;
}

function person(account: Account) {
  return { account_id: account.accountId, display_name: account.name, avatar_url: null, email: account.email, login: account.login };
}

function people(project: MockProject) {
  return [...project.roles.keys()]
    .map((id) => ACCOUNTS.find((account) => account.accountId === id))
    .filter((account): account is Account => account !== undefined)
    .map((account) => ({ accountId: account.accountId, displayName: account.name, login: account.login }));
}

function filesOf(project: MockProject) {
  return [...project.files.values()].map((file) => ({
    fileId: file.fileId,
    path: file.path,
    kind: file.kind,
    blob: file.blob,
  }));
}

function summary(project: MockProject, role: Role) {
  const owner = ACCOUNTS.find((account) => account.accountId === project.owner);
  return { project_id: project.projectId, title: project.title, owner: owner ? person(owner) : null, role };
}

function outputItems(project: MockProject) {
  const output = project.output;
  return output
    ? [{ kind: "pdf", size: output.bytes.length, compiledBy: output.compiledBy, compiledAt: output.compiledAt, mainFile: output.mainFile }]
    : [];
}

function viewersOf(project: MockProject, fileId?: string): Peer[] {
  return [...peers].filter((peer) => peer.project === project && (fileId === undefined || peer.open.has(fileId)));
}

function sendSuggestions(project: MockProject, fileId: string): void {
  const file = project.text(fileId);
  const suggestions = project.fileSuggestions(fileId).map((entry) => ({ ...entry, verified: true }));
  for (const peer of viewersOf(project)) peer.send({ t: "suggestions", fileId, rev: file.rev, suggestions });
}

function sendThreads(project: MockProject, fileId: string): void {
  const file = project.text(fileId);
  const threads = project.fileThreads(fileId);
  for (const peer of viewersOf(project)) peer.send({ t: "threads", fileId, rev: file.rev, threads });
}

function sendPresence(project: MockProject): void {
  for (const peer of viewersOf(project)) {
    const others = viewersOf(project)
      .filter((other) => other !== peer && other.presence.fileId)
      .map((other) => ({
        deviceId: other.deviceId,
        accountId: other.account.accountId,
        name: other.account.name,
        fileId: other.presence.fileId,
        anchor: other.presence.anchor,
        head: other.presence.head,
      }));
    peer.send({ t: "presence", peers: others });
  }
}

function broadcastEdit(project: MockProject, fileId: string, result: ChangeResult, except: Peer | null): void {
  for (const peer of viewersOf(project, fileId)) {
    if (peer === except) continue;
    peer.send({ t: "remote", fileId, rev: result.rev, op: result.op.toWire(), length: result.length });
  }
  if (result.suggestionsChanged || project.fileSuggestions(fileId).length > 0) sendSuggestions(project, fileId);
  if (result.threadsChanged) sendThreads(project, fileId);
}

type Frame = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);

function handleComment(peer: Peer, frame: Frame): void {
  const project = peer.project;
  if (!canComment(peer.role)) throw new Refusal("comment_viewer");
  const fileId = text(frame.fileId);
  const action = text(frame.action);
  if (action === "create") {
    const rev = whole(frame.rev);
    const from = project.moveToCurrent(fileId, rev, whole(frame.from) ?? 0, 1);
    const to = project.moveToCurrent(fileId, rev, whole(frame.to) ?? 0, -1);
    project.addThread(fileId, from, to, peer.account.accountId, text(frame.body));
  } else {
    const thread = project.thread(text(frame.threadId));
    if (action === "reply") {
      thread.messages.push(project.message(peer.account.accountId, text(frame.body)));
    } else if (action === "edit" || action === "delete") {
      const message = thread.messages.find((entry) => entry.id === text(frame.messageId));
      if (!message) throw new Refusal("not_found");
      if (message.author !== peer.account.accountId) throw new Refusal("comment_not_yours");
      if (action === "edit") {
        message.body = project.message(peer.account.accountId, text(frame.body)).body;
        message.editedAt = Date.now();
      } else {
        message.deleted = true;
        message.body = "";
      }
    } else if (action === "resolve") {
      thread.resolved = { by: peer.account.accountId, at: Date.now(), verified: true };
    } else if (action === "reopen") {
      thread.resolved = null;
    } else {
      throw new Refusal("invalid");
    }
  }
  sendThreads(project, fileId);
}

function handleSuggestion(peer: Peer, frame: Frame): void {
  const project = peer.project;
  const action = text(frame.action);
  const resolvesAll = action === "accept_file" || action === "reject_file";
  if ((action === "accept" || action === "reject" || resolvesAll) && !manages(peer.role)) throw new Refusal("suggestion_role");
  if (peer.role === "viewer" || peer.role === "commenter") throw new Refusal("suggestion_role");
  const ids = resolvesAll
    ? project.fileSuggestions(text(frame.fileId)).map((entry) => entry.id)
    : Array.isArray(frame.ids)
      ? frame.ids.map(text)
      : [];
  const targets = ids
    .map((id) => project.suggestions.get(id))
    .filter((entry) => entry !== undefined)
    .sort((a, b) => b.from - a.from);
  if (targets.length === 0) throw new Refusal("suggestion_not_found");
  const touched = new Set<string>();
  for (const entry of targets) {
    if (action === "withdraw" && entry.author !== peer.account.accountId) throw new Refusal("suggestion_not_yours");
    touched.add(entry.fileId);
    const result = project.resolveSuggestion(entry.id, action === "accept" || action === "accept_file");
    if (result) broadcastEdit(project, entry.fileId, result, null);
  }
  for (const fileId of touched) sendSuggestions(project, fileId);
}

function handleChat(peer: Peer, frame: Frame): void {
  const project = peer.project;
  if (peer.role === "viewer") throw new Refusal("chat_role");
  const action = text(frame.action);
  let changed: ChatMessage[];
  if (action === "send") {
    changed = [project.chatSend(peer.account.accountId, text(frame.body))];
  } else if (action === "delete") {
    const message = project.chat.find((entry) => entry.id === text(frame.id));
    if (!message) throw new Refusal("not_found");
    if (message.author !== peer.account.accountId) throw new Refusal("chat_role");
    message.deleted = true;
    message.body = "";
    changed = [message];
  } else if (action === "clear") {
    if (peer.role !== "owner") throw new Refusal("chat_role");
    for (const message of project.chat) {
      message.deleted = true;
      message.body = "";
    }
    changed = project.chat;
  } else {
    throw new Refusal("invalid");
  }
  for (const other of viewersOf(project)) other.send({ t: "chat", messages: changed });
}

function handleFrame(peer: Peer, frame: Frame): void {
  const project = peer.project;
  switch (frame.t) {
    case "open": {
      const file = project.text(text(frame.fileId));
      peer.open.add(file.fileId);
      peer.send({ t: "opened", fileId: file.fileId, rev: file.rev, text: file.text });
      peer.send({ t: "threads", fileId: file.fileId, rev: file.rev, threads: project.fileThreads(file.fileId) });
      peer.send({
        t: "suggestions",
        fileId: file.fileId,
        rev: file.rev,
        suggestions: project.fileSuggestions(file.fileId).map((entry) => ({ ...entry, verified: true })),
      });
      return;
    }
    case "close":
      peer.open.delete(text(frame.fileId));
      return;
    case "change": {
      const fileId = text(frame.fileId);
      const file = project.text(fileId);
      if (!manages(peer.role) && peer.role !== "reviewer") {
        peer.send({ t: "reset", fileId, rev: file.rev, text: file.text });
        return;
      }
      const result = project.change(fileId, whole(frame.rev) ?? -1, frame.op as Wire, peer.account.accountId, peer.suggesting);
      peer.send({ t: "ack", fileId, rev: result.rev, length: result.length });
      broadcastEdit(project, fileId, result, peer);
      return;
    }
    case "mode":
      if (!manages(peer.role)) throw new Refusal("suggestion_role");
      peer.mode = frame.mode === "suggesting" ? "suggesting" : "editing";
      return;
    case "presence":
      peer.presence = {
        fileId: typeof frame.fileId === "string" ? frame.fileId : null,
        anchor: whole(frame.anchor),
        head: whole(frame.head),
      };
      sendPresence(project);
      return;
    case "comment":
      handleComment(peer, frame);
      return;
    case "suggestion":
      handleSuggestion(peer, frame);
      return;
    case "chat":
      handleChat(peer, frame);
      return;
    default:
      throw new Refusal("invalid");
  }
}

function upgrade(request: IncomingMessage, socket: Duplex): void {
  const url = new URL(request.url ?? "/", "http://mock");
  const key = request.headers["sec-websocket-key"];
  if (url.pathname !== "/web/ws" || typeof key !== "string") {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }
  const account = accountOf(request);
  if (!account) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const project = projects.get(url.searchParams.get("project") ?? "");
  const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const role = project?.roles.get(account.accountId);
  if (!project || !role) {
    socket.write(encodeFrame(Buffer.from(JSON.stringify({ t: "error", code: "forbidden", message: "No access" })), 0x1));
    socket.end(encodeFrame(Buffer.alloc(0), 0x8));
    return;
  }
  const peer = new Peer(account, role, project, socket);
  peers.add(peer);
  const leave = () => {
    if (!peers.delete(peer)) return;
    sendPresence(project);
  };
  socket.on(
    "data",
    frameReader(
      (data) => {
        let frame: Frame;
        try {
          frame = JSON.parse(data) as Frame;
        } catch {
          return;
        }
        try {
          handleFrame(peer, frame);
        } catch (error) {
          const code = error instanceof Refusal ? error.code : "server";
          peer.send({ t: "error", code, message: error instanceof Error ? error.message : String(error) });
        }
      },
      () => {
        socket.end(encodeFrame(Buffer.alloc(0), 0x8));
        leave();
      },
      (payload) => socket.write(encodeFrame(payload, 0xa)),
    ),
  );
  socket.on("close", leave);
  socket.on("error", leave);
  peer.send({
    t: "hello",
    role,
    features: { suggestions: true, chat: true, web: true },
    files: filesOf(project),
    people: people(project),
  });
  peer.send({ t: "chat", messages: project.chat });
  peer.send({ t: "output", items: outputItems(project) });
  sendPresence(project);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function signInPage(): string {
  const links = ACCOUNTS.filter((account) => account.accountId !== "sam")
    .map((account) => {
      const role = projects.get("demo")?.roles.get(account.accountId) ?? "none";
      return `<li><a href="/auth/start?flow=web&amp;as=${account.accountId}">${account.name}</a> <small>(${role})</small></li>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in</title></head><body style="font-family: system-ui; max-width: 32rem; margin: 3rem auto; padding: 0 1rem"><h1>Mock sign-in</h1><p>Pick an account. The demo project gives each one a different role.</p><ul>${links}</ul></body></html>`;
}

function compile(project: MockProject, by: string): void {
  const at = Date.now();
  project.output = {
    bytes: minimalPdf([project.title, `Compiled by ${by} at ${new Date(at).toISOString()}`, "This PDF comes from the mock server."]),
    compiledBy: by,
    compiledAt: at,
    mainFile: "main.tex",
  };
  for (const peer of viewersOf(project)) peer.send({ t: "output", items: outputItems(project) });
}

function peerEdit(project: MockProject): void {
  const bot = ACCOUNTS.find((account) => account.accountId === "sam");
  if (!bot) return;
  const actor = new Peer(bot, "reviewer", project, null);
  const file = project.text("f-intro");
  const at = file.text.indexOf("\n") >= 0 ? file.text.indexOf("\n", file.text.indexOf("\n") + 1) : file.text.length;
  const insert = " Sea ice also matters for shipping.";
  const op = new TextOperation().retain(at).insert(insert).retain(file.text.length - at);
  const result = project.change(file.fileId, file.rev, op.toWire(), bot.accountId, actor.suggesting);
  broadcastEdit(project, file.fileId, result, null);
  for (const peer of viewersOf(project)) {
    const others = [{ deviceId: "sam-desktop", accountId: "sam", name: bot.name, fileId: file.fileId, anchor: at, head: at + insert.length }];
    peer.send({ t: "presence", peers: others });
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  const path = url.pathname;
  const account = accountOf(request);
  if (path === "/web/sign-in") {
    html(response, signInPage());
    return;
  }
  if (path === "/auth/start") {
    const chosen = ACCOUNTS.find((entry) => entry.accountId === url.searchParams.get("as"));
    if (!chosen) {
      json(response, 400, { code: "invalid", message: "Unknown account" });
      return;
    }
    response.writeHead(302, {
      "Set-Cookie": `${COOKIE}=${chosen.accountId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      Location: "/web/?project=demo",
    });
    response.end();
    return;
  }
  if (path === "/web/api/sign-out" && request.method === "POST") {
    response.writeHead(204, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    response.end();
    return;
  }
  if (path.startsWith("/web/dev/")) {
    const project = projects.get(url.searchParams.get("project") ?? "demo");
    if (!project) {
      json(response, 404, { code: "not_found", message: "No project" });
      return;
    }
    if (path === "/web/dev/compile") compile(project, url.searchParams.get("as") ?? project.owner);
    else if (path === "/web/dev/peer") peerEdit(project);
    else {
      json(response, 404, { code: "not_found", message: "Unknown dev action" });
      return;
    }
    json(response, 200, { ok: true });
    return;
  }
  if (!path.startsWith("/web/api/")) {
    json(response, 404, { code: "not_found", message: "Not found" });
    return;
  }
  if (!account) {
    json(response, 401, { code: "unauthorized", message: "Sign in first" });
    return;
  }
  if (path === "/web/api/me") {
    json(response, 200, { account: person(account) });
    return;
  }
  if (path === "/web/api/projects") {
    const listed = [...projects.values()]
      .filter((project) => project.roles.has(account.accountId))
      .map((project) => summary(project, project.roles.get(account.accountId) ?? "viewer"));
    json(response, 200, { projects: listed });
    return;
  }
  const match = /^\/web\/api\/projects\/([^/]+)(?:\/(blobs|output)\/([^/]+))?$/u.exec(path);
  const project = match ? projects.get(decodeURIComponent(match[1])) : undefined;
  const role = project?.roles.get(account.accountId);
  if (!match || !project || !role) {
    json(response, project ? 403 : 404, { code: project ? "forbidden" : "not_found", message: "No access" });
    return;
  }
  if (!match[2]) {
    json(response, 200, { project: summary(project, role), role, files: filesOf(project), features: { suggestions: true, chat: true }, members: people(project) });
    return;
  }
  if (match[2] === "blobs") {
    if (match[3] !== "diagram") {
      json(response, 404, { code: "not_found", message: "No blob" });
      return;
    }
    response.writeHead(200, { "Content-Type": "image/svg+xml" });
    response.end(DIAGRAM);
    return;
  }
  if (match[3] !== "pdf" || !project.output) {
    json(response, 404, { code: "not_found", message: "Nobody has compiled yet" });
    return;
  }
  response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": project.output.bytes.length });
  response.end(Buffer.from(project.output.bytes));
});

server.on("upgrade", (request, socket) => upgrade(request, socket));

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `Oleafly web mock server on http://${HOST}:${PORT}\nRun pnpm web:dev and open http://localhost:1430/web/\nSimulate a desktop compile: http://localhost:1430/web/dev/compile\nSimulate a co-author suggestion: http://localhost:1430/web/dev/peer\n`,
  );
});

import type { CollabDocMessage } from "@oleafly/backend-port";
import { describe, expect, it, vi } from "vitest";
import { TextOperation } from "@/features/collab/live/ot";
import { RemoteDocumentSession } from "@/features/collab/live/remote-session";
import {
  type GatewayListener,
  MAX_CHANGE_BYTES,
  OfflineError,
  PROBE_AFTER_FAILURES,
  RECONNECT_MAX_MS,
  reconnectDelay,
  WebGateway,
} from "./gateway";
import { FakeServer, hello, ManualTimers } from "./testing/fake-socket";

function setup(listener: GatewayListener = {}, probe?: () => Promise<"ok" | "signed_out" | "no_access">) {
  const server = new FakeServer();
  const timers = new ManualTimers();
  const gateway = new WebGateway({
    url: "wss://collab.test/web/ws?project=p1",
    listener,
    createSocket: server.factory,
    setTimer: timers.setTimer,
    random: () => 0.5,
    probe,
    instance: "t",
  });
  gateway.start();
  return { server, timers, gateway };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("WebGateway frames", () => {
  it("goes online on hello and reports the role, features and files", () => {
    const hellos: unknown[] = [];
    const states: string[] = [];
    const { server, gateway } = setup({ hello: (info) => hellos.push(info), state: (state) => states.push(state) });
    expect(server.current.url).toBe("wss://collab.test/web/ws?project=p1");
    expect(gateway.state).toBe("connecting");
    server.current.emit(hello("reviewer"));
    expect(gateway.state).toBe("online");
    expect(states).toEqual(["online"]);
    expect(hellos).toEqual([
      expect.objectContaining({
        role: "reviewer",
        features: { comments: true, suggestions: true, chat: true },
        files: expect.arrayContaining([expect.objectContaining({ fileId: "f-main", path: "main.tex", kind: "text" })]),
      }),
    ]);
  });

  it("ignores frames that are not JSON or have no known type", () => {
    const errors: string[] = [];
    const { server } = setup({ error: (code) => errors.push(code) });
    server.current.raw("not json");
    server.current.emit({ t: "mystery" });
    server.current.emit({ t: "error", code: "suggestion_role", message: "no" });
    expect(errors).toEqual(["suggestion_role"]);
  });

  it("routes the non-document frames to the listener", () => {
    const seen: string[] = [];
    const { server } = setup({
      tree: () => seen.push("tree"),
      presence: (peers) => seen.push(`presence:${peers[0]?.head}`),
      threads: (frame) => seen.push(`threads:${frame.fileId}:${frame.rev}`),
      suggestions: (frame) => seen.push(`suggestions:${frame.suggestions.length}`),
      chat: (messages) => seen.push(`chat:${messages.length}`),
      output: (items) => seen.push(`output:${items[0]?.compiledBy}`),
      access: (role) => seen.push(`access:${role}`),
    });
    server.current.emit(hello());
    server.current.emit({ t: "tree", files: [] });
    server.current.emit({ t: "presence", peers: [{ deviceId: "d", accountId: "a", fileId: "f-main", anchor: 1, head: 3 }] });
    server.current.emit({ t: "threads", fileId: "f-main", rev: 4, threads: [] });
    server.current.emit({
      t: "suggestions",
      fileId: "f-main",
      rev: 4,
      suggestions: [{ id: "s1", kind: "insert", author: "a", createdAt: 1, from: 0, to: 2, text: "hi", verified: true }],
    });
    server.current.emit({ t: "chat", messages: [{ id: "m1", author: "a", at: 1, body: "x" }] });
    server.current.emit({ t: "output", items: [{ kind: "pdf", size: 10, compiledBy: "a", compiledAt: 5, mainFile: "main.tex" }] });
    server.current.emit({ t: "access", role: "commenter" });
    expect(seen).toEqual([
      "tree",
      "presence:3",
      "threads:f-main:4",
      "suggestions:1",
      "chat:1",
      "output:a",
      "access:commenter",
    ]);
  });

  it("refuses to send while offline", () => {
    const { server, gateway } = setup();
    expect(gateway.send({ t: "chat", action: "send", body: "hi" })).toBe(false);
    server.current.emit(hello());
    expect(gateway.send({ t: "chat", action: "send", body: "hi" })).toBe(true);
    expect(server.current.frames("chat")).toEqual([{ t: "chat", action: "send", body: "hi" }]);
  });
});

describe("WebGateway document transport", () => {
  it("opens a file by id and resolves with the server text", async () => {
    const { server, gateway } = setup();
    server.current.emit(hello());
    const opening = gateway.transport.open("main.tex", () => undefined);
    expect(server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main" }]);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 7, text: "Hello" });
    await expect(opening).resolves.toEqual({ file_id: "f-main", rev: 7, text: "Hello", session: 1 });
  });

  it("resolves null for a path that is not in the project", async () => {
    const { server, gateway } = setup();
    server.current.emit(hello());
    await expect(gateway.transport.open("missing.tex", () => undefined)).resolves.toBeNull();
  });

  it("waits for hello before opening", async () => {
    const { server, gateway } = setup();
    const opening = gateway.transport.open("refs.bib", () => undefined);
    expect(server.current.frames("open")).toEqual([]);
    server.current.emit(hello());
    expect(server.current.frames("open")).toEqual([{ t: "open", fileId: "f-refs" }]);
    server.current.emit({ t: "opened", fileId: "f-refs", rev: 0, text: "" });
    await expect(opening).resolves.toMatchObject({ file_id: "f-refs" });
  });

  it("fills in the ack length from the change in flight, moved past remote changes", async () => {
    const messages: CollabDocMessage[] = [];
    const { server, gateway } = setup();
    server.current.emit(hello());
    const opening = gateway.transport.open("main.tex", (message) => messages.push(message));
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    await opening;
    await gateway.transport.change("f-main", 1, new TextOperation().retain(3).insert("d").toWire());
    expect(server.current.frames("change")).toEqual([{ t: "change", fileId: "f-main", rev: 1, op: [3, "d"], id: "t:1" }]);
    server.current.emit({ t: "remote", fileId: "f-main", rev: 2, op: ["XY", 3], length: 5 });
    server.current.emit({ t: "ack", fileId: "f-main", rev: 3 });
    expect(messages).toEqual([
      { kind: "remote", rev: 2, op: ["XY", 3], length: 5 },
      { kind: "ack", rev: 3, length: 6 },
    ]);
  });

  it("uses the server's ack length when it sends one", async () => {
    const messages: CollabDocMessage[] = [];
    const { server, gateway } = setup();
    server.current.emit(hello());
    const opening = gateway.transport.open("main.tex", (message) => messages.push(message));
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    await opening;
    await gateway.transport.change("f-main", 1, [3, "d"]);
    server.current.emit({ t: "ack", fileId: "f-main", rev: 2, length: 99 });
    expect(messages).toEqual([{ kind: "ack", rev: 2, length: 99 }]);
  });

  it("passes resets through and treats a second opened as a reset", async () => {
    const messages: CollabDocMessage[] = [];
    const { server, gateway } = setup();
    server.current.emit(hello());
    const opening = gateway.transport.open("main.tex", (message) => messages.push(message));
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    await opening;
    server.current.emit({ t: "reset", fileId: "f-main", rev: 5, text: "xyz" });
    server.current.emit({ t: "opened", fileId: "f-main", rev: 6, text: "xyz!" });
    expect(messages).toEqual([
      { kind: "reset", rev: 5, text: "xyz" },
      { kind: "reset", rev: 6, text: "xyz!" },
    ]);
  });

  it("rejects a change while offline so the session reopens", async () => {
    const { server, gateway } = setup();
    server.current.emit(hello());
    const opening = gateway.transport.open("main.tex", () => undefined);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    await opening;
    server.current.drop();
    await expect(gateway.transport.change("f-main", 1, [3, "d"])).rejects.toThrow();
  });

  it("closes only the channel the token belongs to", async () => {
    const { server, gateway } = setup();
    server.current.emit(hello());
    const first = gateway.transport.open("main.tex", () => undefined);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    const opened = await first;
    const second = gateway.transport.open("main.tex", () => undefined);
    gateway.transport.close("f-main", opened?.session ?? -1);
    expect(server.current.frames("close")).toEqual([]);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 2, text: "abc" });
    const reopened = await second;
    gateway.transport.close("f-main", reopened?.session ?? -1);
    expect(server.current.frames("close")).toEqual([{ t: "close", fileId: "f-main" }]);
  });
});

describe("WebGateway reconnects", () => {
  it("backs off exponentially up to the cap", () => {
    expect([0, 1, 2, 3].map((attempt) => reconnectDelay(attempt, () => 0.5))).toEqual([500, 1000, 2000, 4000]);
    expect(reconnectDelay(20, () => 0.5)).toBe(RECONNECT_MAX_MS);
    expect(reconnectDelay(0, () => 0)).toBe(400);
    expect(reconnectDelay(0, () => 1)).toBe(600);
  });

  it("reconnects after a drop and sends waiting opens, the mode and presence again", async () => {
    const states: string[] = [];
    const { server, timers, gateway } = setup({ state: (state) => states.push(state) });
    server.current.emit(hello("editor"));
    gateway.setMode("suggesting");
    gateway.setPresence("f-main", 1, 4);
    server.current.drop();
    expect(states).toEqual(["online", "offline"]);
    expect(timers.delays).toEqual([500]);
    const reopening = gateway.transport.open("main.tex", () => undefined);
    timers.runNext();
    expect(server.sockets).toHaveLength(2);
    server.current.emit(hello("editor"));
    expect(server.current.sent).toEqual([
      { t: "mode", mode: "suggesting" },
      { t: "presence", fileId: "f-main", anchor: 1, head: 4 },
      { t: "open", fileId: "f-main" },
    ]);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 9, text: "abc" });
    await expect(reopening).resolves.toMatchObject({ rev: 9 });
  });

  it("does not send the mode to a role that cannot choose it", () => {
    const { server, timers, gateway } = setup();
    server.current.emit(hello("editor"));
    gateway.setMode("suggesting");
    server.current.drop();
    timers.runNext();
    server.current.emit(hello("commenter"));
    expect(server.current.frames("mode")).toEqual([]);
  });

  it("keeps growing the delay while connections fail before hello", () => {
    const { server, timers } = setup();
    server.current.drop();
    timers.runNext();
    server.current.drop();
    expect(timers.delays).toEqual([1000]);
  });

  it("asks the probe after repeated failures and stops when signed out", async () => {
    const probe = vi.fn(async () => "signed_out" as const);
    const states: string[] = [];
    const { server, timers, gateway } = setup({ state: (state, end) => states.push(`${state}:${end}`) }, probe);
    for (let index = 0; index < PROBE_AFTER_FAILURES; index += 1) {
      server.current.drop();
      if (index < PROBE_AFTER_FAILURES - 1) timers.runNext();
    }
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(gateway.state).toBe("ended");
    expect(gateway.end).toBe("signed_out");
    expect(timers.delays).toEqual([]);
    expect(states.at(-1)).toBe("ended:signed_out");
  });

  it("keeps retrying when the probe finds the account fine", async () => {
    const probe = vi.fn(async () => "ok" as const);
    const { server, timers } = setup({}, probe);
    server.current.drop();
    timers.runNext();
    server.current.drop();
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(timers.delays).toHaveLength(1);
  });

  it("ends on a sign-in error and resolves waiting opens with null", async () => {
    const { server, gateway } = setup();
    const opening = gateway.transport.open("main.tex", () => undefined);
    server.current.emit({ t: "error", code: "unauthorized", message: "" });
    expect(gateway.state).toBe("ended");
    expect(gateway.end).toBe("signed_out");
    expect(server.current.closed).toBe(true);
    await expect(opening).resolves.toBeNull();
  });

  it("ends with no access when the server refuses the project before hello", () => {
    const { server, gateway } = setup();
    server.current.emit({ t: "error", code: "forbidden", message: "" });
    expect(gateway.end).toBe("no_access");
  });

  it("stops for good when asked", () => {
    const { server, timers, gateway } = setup();
    server.current.emit(hello());
    gateway.stop();
    expect(server.current.closed).toBe(true);
    expect(gateway.state).toBe("ended");
    expect(timers.delays).toEqual([]);
  });
});

describe("WebGateway with the shared OT session", () => {
  async function openSession() {
    const context = setup();
    context.server.current.emit(hello());
    const session = new RemoteDocumentSession("main.tex", "", { transport: context.gateway.transport });
    const opening = session.open();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    await opening;
    return { ...context, session };
  }

  it("confirms local typing that crossed a remote change", async () => {
    const { server, session } = await openSession();
    session.applyLocal([{ from: 3, to: 3, insert: "d" }], session.version());
    expect(server.current.frames("change")).toEqual([{ t: "change", fileId: "f-main", rev: 1, op: [3, "d"], id: "t:1" }]);
    server.current.emit({ t: "remote", fileId: "f-main", rev: 2, op: ["XY", 3], length: 5 });
    expect(session.text()).toBe("XYabcd");
    server.current.emit({ t: "ack", fileId: "f-main", rev: 3 });
    await flush();
    expect(session.synchronized).toBe(true);
    expect(session.revision).toBe(3);
    expect(session.confirmed()).toBe("XYabcd");
    expect(server.current.frames("open")).toHaveLength(1);
  });

  it("sends buffered typing after the first ack", async () => {
    const { server, session } = await openSession();
    session.applyLocal([{ from: 0, to: 0, insert: "1" }], session.version());
    session.applyLocal([{ from: 1, to: 1, insert: "2" }], session.version());
    expect(server.current.frames("change")).toHaveLength(1);
    server.current.emit({ t: "ack", fileId: "f-main", rev: 2 });
    expect(server.current.frames("change").at(-1)).toEqual({ t: "change", fileId: "f-main", rev: 2, op: [1, "2", 3], id: "t:2" });
    server.current.emit({ t: "ack", fileId: "f-main", rev: 3 });
    await flush();
    expect(session.synchronized).toBe(true);
    expect(session.text()).toBe("12abc");
  });

  it("moves unconfirmed typing onto a reset and sends it again", async () => {
    const { server, session } = await openSession();
    session.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    server.current.emit({ t: "reset", fileId: "f-main", rev: 4, text: "abcz" });
    expect(session.text()).toBe("abc!z");
    expect(server.current.frames("change").at(-1)).toEqual({ t: "change", fileId: "f-main", rev: 4, op: [3, "!", 1], id: "t:2" });
    server.current.emit({ t: "ack", fileId: "f-main", rev: 5 });
    await flush();
    expect(session.synchronized).toBe(true);
    expect(session.confirmed()).toBe("abc!z");
  });

  it("keeps typing made offline and sends it once the file is open again", async () => {
    const { server, timers, gateway, session } = await openSession();
    server.current.drop();
    const reopening = session.open();
    session.applyLocal([{ from: 0, to: 0, insert: ">" }], session.version());
    expect(session.text()).toBe(">abc");
    timers.runNext();
    server.current.emit(hello());
    expect(server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main" }]);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 3, text: "abc." });
    await reopening;
    expect(session.text()).toBe(">abc.");
    expect(server.current.frames("change")).toEqual([{ t: "change", fileId: "f-main", rev: 3, op: [">", 4], id: "t:1" }]);
    expect(gateway.online).toBe(true);
  });
});

describe("WebGateway requests", () => {
  it("settles a request on its own answer and keeps refusals out of the shared notice", async () => {
    const errors: string[] = [];
    const { server, gateway } = setup({ error: (code) => errors.push(code) });
    server.current.emit(hello());
    const sent = gateway.request({ t: "chat", action: "send", body: "hi" });
    const refused = gateway.request({ t: "chat", action: "clear" });
    const [first, second] = server.current.frames("chat");
    expect(first).toEqual({ t: "chat", action: "send", body: "hi", reqId: "t:r1" });
    expect(second).toMatchObject({ action: "clear", reqId: "t:r2" });
    server.current.emit({ t: "done", reqId: "t:r1" });
    server.current.emit({ t: "error", code: "chat_role", message: "No", reqId: "t:r2" });
    await expect(sent).resolves.toBeUndefined();
    await expect(refused).rejects.toMatchObject({ code: "chat_role" });
    expect(errors).toEqual([]);
    const lost = gateway.request({ t: "chat", action: "send", body: "again" });
    server.current.drop();
    await expect(lost).rejects.toBeInstanceOf(OfflineError);
    await expect(gateway.request({ t: "chat", action: "send", body: "later" })).rejects.toBeInstanceOf(OfflineError);
  });

  it("ends for good when the project is too large to open before hello", () => {
    const { server, timers, gateway } = setup();
    server.current.emit({ t: "error", code: "project_too_large", message: "" });
    expect(gateway.state).toBe("ended");
    expect(gateway.end).toBe("too_large");
    expect(timers.delays).toEqual([]);
  });
});

describe("WebGateway reopening after a drop", () => {
  it("reopens a file renamed while offline by its id, never the new file at its old path", async () => {
    const { server, timers, gateway } = setup();
    server.current.emit(hello());
    server.current.drop();
    const reopening = gateway.transport.open("main.tex", () => undefined);
    const gone = gateway.transport.open("refs.bib", () => undefined);
    timers.runNext();
    server.current.emit(
      hello("owner", {
        files: [
          { fileId: "f-main", path: "chapters/main.tex", kind: "text" },
          { fileId: "f-other", path: "main.tex", kind: "text" },
        ],
      }),
    );
    expect(server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main" }]);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 2, text: "abc" });
    await expect(reopening).resolves.toMatchObject({ file_id: "f-main" });
    await expect(gone).resolves.toBeNull();
  });
});

describe("WebGateway change ids", () => {
  async function typedThenDropped() {
    const context = setup();
    context.server.current.emit(hello());
    const session = new RemoteDocumentSession("main.tex", "", { transport: context.gateway.transport });
    const opening = session.open();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    await opening;
    session.applyLocal([{ from: 3, to: 3, insert: "d" }], session.version());
    context.server.current.drop();
    expect(context.gateway.holds("f-main")).toBe(true);
    session.applyLocal([{ from: 4, to: 4, insert: "e" }], session.version());
    context.timers.runNext();
    context.server.current.emit(hello());
    expect(context.server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main", resume: "t:1" }]);
    return { ...context, session };
  }

  it("does not apply typing twice when the server took it but the ack was lost", async () => {
    const { server, gateway, session } = await typedThenDropped();
    server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "abcd", resumed: true });
    expect(session.text()).toBe("abcde");
    expect(server.current.frames("change")).toEqual([{ t: "change", fileId: "f-main", rev: 0, op: [4, "e"], id: "t:2" }]);
    expect(gateway.holds("f-main")).toBe(false);
    server.current.emit({ t: "ack", fileId: "f-main", rev: 1 });
    await flush();
    expect(session.synchronized).toBe(true);
    expect(session.confirmed()).toBe("abcde");
  });

  it("sends typing again when the server never got it", async () => {
    const { server, session } = await typedThenDropped();
    server.current.emit({ t: "opened", fileId: "f-main", rev: 5, text: "Xabc", resumed: false });
    expect(session.text()).toBe("Xabcde");
    expect(server.current.frames("change")).toEqual([
      { t: "change", fileId: "f-main", rev: 5, op: [4, "de"], id: "t:2" },
    ]);
  });

  it("keeps a change too large for the server off the socket and drops it after one more try", async () => {
    const errors: string[] = [];
    const discarded: string[] = [];
    const { server, gateway } = setup({ error: (code) => errors.push(code) });
    server.current.emit(hello());
    const session = new RemoteDocumentSession("main.tex", "", {
      transport: gateway.transport,
      onDiscarded: (reason) => discarded.push(reason),
    });
    const opening = session.open();
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "abc" });
    await opening;
    session.applyLocal([{ from: 3, to: 3, insert: "x".repeat(MAX_CHANGE_BYTES) }], session.version());
    expect(server.current.frames("change")).toEqual([]);
    expect(server.current.frames("open")).toHaveLength(2);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 2, text: "abc" });
    expect(server.current.frames("open")).toHaveLength(3);
    server.current.emit({ t: "opened", fileId: "f-main", rev: 3, text: "abc" });
    expect(session.text()).toBe("abc");
    expect(discarded).toEqual(["refused"]);
    expect(errors).toEqual(["too_large", "too_large"]);
    expect(server.current.frames("change")).toEqual([]);
  });
});

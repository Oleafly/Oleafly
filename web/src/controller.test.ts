import { EditorSelection, EditorState } from "@codemirror/state";
import { createFakeEngine } from "@oleafly/compile-port/testing";
import { setEditorView } from "@oleafly/editor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type WebApi, type WebProjectDetail } from "./api";
import { OfflineError, ProjectController } from "./controller";
import { resetWebState, useWeb } from "./store";
import { forgetTabs, tabKey, tabScope } from "./tab-storage";
import { FakeServer, hello, ManualTimers, TEST_FILES } from "./testing/fake-socket";

const DETAIL: WebProjectDetail = {
  project: { projectId: "p1", title: "Thesis", owner: { accountId: "own", name: "Olive", avatarUrl: null, login: null }, role: "owner" },
  role: "owner",
  files: [],
  features: { comments: true, suggestions: true, chat: true, reactions: true },
  people: [{ accountId: "ana", name: "Ana", avatarUrl: null, login: "ana" }],
};

function fakeApi(project: WebApi["project"] = vi.fn(async () => DETAIL)): WebApi {
  return {
    me: vi.fn(async () => ({ accountId: "me", name: "Me", avatarUrl: null, login: null, email: null })),
    projects: vi.fn(async () => []),
    project,
    texts: vi.fn(async () => []),
    blob: vi.fn(),
    output: vi.fn(async () => null),
    putOutput: vi.fn(async () => null),
    signOut: vi.fn(async () => undefined),
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function started(role = "owner", api = fakeApi()) {
  resetWebState({ me: { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null } });
  const server = new FakeServer();
  const timers = new ManualTimers();
  const controller = new ProjectController("p1", {
    api,
    socketUrl: "wss://collab.test/web/ws?project=p1",
    createSocket: server.factory,
    setTimer: timers.setTimer,
    random: () => 0.5,
    settleMs: 10,
    instance: "t",
  });
  await controller.start();
  server.current.emit(hello(role));
  return { controller, server, timers, api };
}

async function openMain(context: Awaited<ReturnType<typeof started>>, text = "Hello world", rev = 1) {
  context.server.current.emit({ t: "opened", fileId: "f-main", rev, text });
  await flush();
}

function answered(context: Awaited<ReturnType<typeof started>>, answers: Record<string, string | null> = {}) {
  const socket = context.server.current;
  const seen = new Set<string>();
  return () => {
    for (const frame of socket.sent) {
      const reqId = "reqId" in frame ? frame.reqId : undefined;
      if (!reqId || seen.has(reqId)) continue;
      seen.add(reqId);
      const code = answers[reqId] ?? null;
      socket.emit(code ? { t: "error", code, message: code, reqId } : { t: "done", reqId });
    }
  };
}

function revChecking(context: Awaited<ReturnType<typeof started>>, rev: number) {
  const socket = context.server.current;
  const seen = new Set<string>();
  return () => {
    let opened = false;
    for (const frame of socket.sent) {
      if (frame.t === "open") opened = true;
      const reqId = "reqId" in frame ? frame.reqId : undefined;
      if (!reqId || seen.has(reqId)) continue;
      seen.add(reqId);
      const stale = frame.t === "comment" && frame.action === "create" && frame.rev !== null && (!opened || frame.rev !== rev);
      socket.emit(stale ? { t: "error", code: "comment_selection_changed", message: "moved", reqId } : { t: "done", reqId });
    }
  };
}

async function settle<T>(work: Promise<T>, answer: () => void): Promise<T> {
  let done = false;
  const finished = work.finally(() => {
    done = true;
  });
  finished.catch(() => undefined);
  for (let round = 0; round < 50 && !done; round += 1) {
    answer();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return finished;
}

describe("ProjectController", () => {
  beforeEach(() => sessionStorage.clear());

  it("loads the project and opens the main file after hello", async () => {
    const context = await started("editor");
    const state = useWeb.getState();
    expect(state.title).toBe("Thesis");
    expect(state.role).toBe("editor");
    expect(state.people.ana?.name).toBe("Ana");
    expect(state.people.own?.name).toBe("Olive");
    expect(state.files.map((file) => file.path)).toEqual(TEST_FILES.map((file) => file.path));
    expect(state.activePath).toBe("main.tex");
    expect(context.server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main" }]);
    expect(context.server.current.frames("mode")).toEqual([{ t: "mode", mode: "editing" }]);
    await openMain(context);
    expect(useWeb.getState().loaded["f-main"]).toBe(true);
    expect(context.controller.sessionFor("main.tex")?.text()).toBe("Hello world");
  });

  it("ends signed out or without access when the project cannot be read", async () => {
    resetWebState();
    const signedOut = new ProjectController("p1", {
      api: fakeApi(vi.fn(async () => Promise.reject(new ApiError(401, "unauthorized", "")))),
      socketUrl: "wss://x",
      createSocket: new FakeServer().factory,
    });
    await signedOut.start();
    expect(useWeb.getState().end).toBe("signed_out");
    resetWebState();
    const server = new FakeServer();
    const forbidden = new ProjectController("p1", {
      api: fakeApi(vi.fn(async () => Promise.reject(new ApiError(403, "forbidden", "")))),
      socketUrl: "wss://x",
      createSocket: server.factory,
    });
    await forbidden.start();
    expect(useWeb.getState().end).toBe("no_access");
    expect(server.sockets).toHaveLength(0);
  });

  it("sends the chosen mode only for roles that can choose it, and remembers it", async () => {
    const owner = await started("owner");
    owner.controller.setMode("suggesting");
    expect(owner.server.current.frames("mode").at(-1)).toEqual({ t: "mode", mode: "suggesting" });
    expect(localStorage.getItem("oleafly.web.mode.p1")).toBe("suggesting");
    owner.controller.stop();
    const reviewer = await started("reviewer");
    reviewer.controller.setMode("editing");
    expect(reviewer.server.current.frames("mode")).toEqual([]);
    expect(useWeb.getState().chosenMode).toBe("suggesting");
    localStorage.removeItem("oleafly.web.mode.p1");
  });

  it("keeps viewers and commenters from typing into the shared file", async () => {
    const context = await started("commenter");
    await openMain(context);
    const session = context.controller.sessionFor("main.tex");
    expect(session?.readOnly).toBe(true);
    expect(() => session?.applyLocal([{ from: 0, to: 0, insert: "x" }], session.version())).toThrow();
    expect(context.server.current.frames("change")).toEqual([]);
  });

  it("places suggestions and threads for the editor and lists them for the pane", async () => {
    const context = await started("owner");
    await openMain(context);
    context.server.current.emit({
      t: "suggestions",
      fileId: "f-main",
      rev: 1,
      suggestions: [
        { id: "s1", kind: "insert", author: "ana", createdAt: 1, from: 6, to: 11, text: "world", verified: true },
        { id: "s2", kind: "delete", author: "ana", createdAt: 2, from: 5, to: 5, text: " big", verified: true },
      ],
    });
    context.server.current.emit({
      t: "threads",
      fileId: "f-main",
      rev: 1,
      threads: [{ id: "t1", anchor: { quote: "Hello", range: { from: 0, to: 5 } }, createdBy: "ana", messages: [] }],
    });
    expect(useWeb.getState().suggestions["f-main"]).toHaveLength(2);
    expect(useWeb.getState().threads["f-main"]?.[0]?.fileId).toBe("f-main");
    const snapshot = context.controller.overlaysFor("main.tex");
    expect(snapshot?.suggestions.map((entry) => [entry.id, entry.from, entry.to])).toEqual([
      ["s1", 6, 11],
      ["s2", 5, 5],
    ]);
    expect(snapshot?.threads).toEqual([{ id: "t1", from: 0, to: 5, resolved: false }]);
  });

  it("waits for its own change to be confirmed before placing a newer suggestion frame", async () => {
    const context = await started("reviewer");
    await openMain(context, "abc");
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 3, to: 3, insert: "d" }], session.version());
    expect(context.controller.overlaysFor("main.tex")?.suggestions).toEqual([
      expect.objectContaining({ kind: "insert", from: 3, to: 4, pending: true, author: "me" }),
    ]);
    context.server.current.emit({
      t: "suggestions",
      fileId: "f-main",
      rev: 2,
      suggestions: [{ id: "s1", kind: "insert", author: "me", createdAt: 1, from: 3, to: 4, text: "d", verified: true }],
    });
    expect(context.controller.overlaysFor("main.tex")?.suggestions[0]?.pending).toBe(true);
    context.server.current.emit({ t: "ack", fileId: "f-main", rev: 2 });
    await flush();
    expect(context.controller.overlaysFor("main.tex")?.suggestions).toEqual([
      expect.objectContaining({ id: "s1", pending: false, from: 3, to: 4 }),
    ]);
  });

  it("creates a comment at the confirmed revision", async () => {
    const context = await started("commenter");
    await openMain(context);
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 0, to: 5, quote: "Hello" } });
    await settle(context.controller.createComment("Typo here"), answered(context));
    expect(context.server.current.frames("comment")).toEqual([
      {
        t: "comment",
        action: "create",
        fileId: "f-main",
        path: "main.tex",
        from: 0,
        to: 5,
        rev: 1,
        body: "Typo here",
        members: expect.arrayContaining([{ accountId: "ana", displayName: "Ana", login: "ana" }]),
        clientId: expect.stringMatching(/^outbox-/u),
        reqId: "t:r1",
      },
    ]);
    expect(useWeb.getState().draft).toBeNull();
  });

  it("keeps a refused comment as a Not sent item, and tries again when the text moved", async () => {
    const context = await started("commenter");
    await openMain(context);
    const draft = { fileId: "f-main", path: "main.tex", from: 0, to: 5, quote: "Hello" };
    useWeb.setState({ draft });
    const moved = answered(context, { "t:r1": "comment_selection_changed" });
    await settle(context.controller.createComment("Typo here"), moved);
    expect(context.server.current.frames("comment").map((frame) => frame.reqId)).toEqual(["t:r1", "t:r2"]);
    expect(useWeb.getState().draft).toBeNull();
    useWeb.setState({ draft });
    const refused = answered(context, { "t:r3": "comment_off_project" });
    await settle(context.controller.createComment("Again"), refused);
    expect(useWeb.getState().draft).toBeNull();
    expect(useWeb.getState().outbox).toEqual([
      expect.objectContaining({ kind: "create", body: "Again", state: "failed", reason: "comment_off_project", retry: false, quote: "Hello" }),
    ]);
    expect(useWeb.getState().notice).toBeNull();
    context.controller.discardOutbox(useWeb.getState().outbox[0].id);
    expect(useWeb.getState().outbox).toEqual([]);
  });

  it("anchors a comment in the text the server has, not around typing it has not confirmed", async () => {
    const context = await started("owner");
    await openMain(context, "Hello world");
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 0, to: 0, insert: ">> " }], session.version());
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 9, to: 14, quote: "world" } });
    expect(session?.synchronized).toBe(false);
    await settle(context.controller.createComment("Which world?"), answered(context));
    expect(context.server.current.frames("comment")[0]).toMatchObject({ from: 6, to: 11, rev: 1 });
  });

  it("sends review, comment and chat actions and queues new messages while offline", async () => {
    const context = await started("owner");
    const answer = answered(context);
    await settle(context.controller.acceptSuggestions(["s1"]), answer);
    await settle(context.controller.rejectFile("f-main"), answer);
    const thread = {
      id: "t1",
      fileId: "f-main",
      anchor: { quote: "", range: null },
      createdBy: "ana",
      createdAt: 1,
      resolved: null,
      messages: [],
      verified: true,
    };
    await settle(context.controller.resolveThread(thread), answer);
    await settle(context.controller.replyComment(thread, "Done"), answer);
    await settle(context.controller.sendChat("Hi"), answer);
    await settle(context.controller.clearChat(), answer);
    expect(context.server.current.frames("suggestion")).toEqual([
      { t: "suggestion", action: "accept", ids: ["s1"], reqId: "t:r1" },
      { t: "suggestion", action: "reject_file", fileId: "f-main", reqId: "t:r2" },
    ]);
    expect(context.server.current.frames("comment").map((frame) => frame.action)).toEqual(["resolve", "reply"]);
    expect(context.server.current.frames("chat")).toEqual([
      { t: "chat", action: "send", body: "Hi", members: expect.any(Array), clientId: expect.any(String), reqId: "t:r5" },
      { t: "chat", action: "clear", reqId: "t:r6" },
    ]);
    const pending = context.controller.sendChat("in flight");
    context.server.current.drop();
    await pending;
    await context.controller.sendChat("later");
    expect(useWeb.getState().outbox.map((item) => [item.kind, item.body, item.state])).toEqual([
      ["chat", "in flight", "waiting"],
      ["chat", "later", "waiting"],
    ]);
    await expect(context.controller.resolveThread(thread)).rejects.toBeInstanceOf(OfflineError);
  });

  it("keeps comments written offline through a reload and sends them in order when the server is back", async () => {
    const before = await started("owner");
    const thread = {
      id: "t1",
      fileId: "f-main",
      anchor: { quote: "", range: null },
      createdBy: "ana",
      createdAt: 1,
      resolved: null,
      messages: [],
      verified: true,
    };
    before.server.current.drop();
    await before.controller.replyComment(thread, "First");
    await before.controller.replyComment(thread, "Second");
    await before.controller.sendChat("Third");
    before.controller.stop();
    const after = await started("owner");
    expect(useWeb.getState().outbox.map((item) => item.body)).toEqual(["First", "Second", "Third"]);
    const answer = answered(after);
    for (let round = 0; round < 20 && useWeb.getState().outbox.length > 0; round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(useWeb.getState().outbox).toEqual([]);
    const sent = after.server.current.sent.filter((frame) => frame.t === "comment" || frame.t === "chat");
    expect(sent.map((frame) => ("body" in frame ? frame.body : null))).toEqual(["First", "Second", "Third"]);
    expect(sessionStorage.getItem(tabKey("outbox", tabScope("me", "p1")))).toBeNull();
  });

  it("never shows or sends one account's queued text to the next account in the same tab", async () => {
    const before = await started("owner");
    before.server.current.drop();
    await before.controller.sendChat("Only for me");
    const thread = { id: "t1", fileId: "f-main", anchor: { quote: "", range: null }, createdBy: "ana", createdAt: 1, resolved: null, messages: [], verified: true };
    await before.controller.replyComment(thread, "Also mine");
    expect(useWeb.getState().outbox).toHaveLength(2);
    before.controller.stop();
    expect(sessionStorage.length).toBeGreaterThan(0);
    resetWebState({ me: { accountId: "other", name: "Other", avatarUrl: null, login: null, email: null } });
    const server = new FakeServer();
    const next = new ProjectController("p1", {
      api: fakeApi(),
      socketUrl: "wss://collab.test/web/ws?project=p1",
      createSocket: server.factory,
      setTimer: new ManualTimers().setTimer,
      random: () => 0.5,
      settleMs: 10,
      instance: "t2",
    });
    await next.start();
    server.current.emit(hello("owner"));
    await flush();
    expect(useWeb.getState().outbox).toEqual([]);
    expect(server.current.frames("chat")).toEqual([]);
    expect(server.current.frames("comment")).toEqual([]);
    next.stop();
    forgetTabs();
    expect(sessionStorage.length).toBe(0);
  });

  it("shares a reply or chat activity with the presence and clears it", async () => {
    const context = await started("owner");
    context.controller.setActivity({ kind: "reply", threadId: "t1" }, true);
    expect(context.server.current.frames("presence").at(-1)).toMatchObject({ activity: { kind: "reply", threadId: "t1" } });
    context.controller.setActivity({ kind: "chat" }, true);
    expect(context.server.current.frames("presence").at(-1)).toMatchObject({ activity: { kind: "chat", threadId: null } });
    context.controller.setActivity({ kind: "chat" }, false);
    expect(context.server.current.frames("presence").at(-1)).toMatchObject({ activity: null });
  });

  it("sends comment and chat reactions, passes on refusals and fails them while offline", async () => {
    const context = await started("commenter");
    const answer = answered(context, { "t:r2": "chat_role" });
    const thread = {
      id: "t1",
      fileId: "f-main",
      anchor: { quote: "", range: null },
      createdBy: "ana",
      createdAt: 1,
      resolved: null,
      messages: [],
      verified: true,
    };
    await settle(context.controller.reactComment(thread, "m1", "👍", true), answer);
    await expect(settle(context.controller.reactChat("c1", "🎉", false), answer)).rejects.toMatchObject({
      code: "chat_role",
    });
    expect(context.server.current.frames("comment")).toEqual([
      { t: "comment", action: "react", fileId: "f-main", threadId: "t1", messageId: "m1", emoji: "👍", on: true, reqId: "t:r1" },
    ]);
    expect(context.server.current.frames("chat")).toEqual([
      { t: "chat", action: "react", id: "c1", emoji: "🎉", on: false, reqId: "t:r2" },
    ]);
    context.server.current.drop();
    await expect(context.controller.reactComment(thread, "m1", "👍", false)).rejects.toBeInstanceOf(OfflineError);
    await expect(context.controller.reactChat("c1", "🎉", true)).rejects.toBeInstanceOf(OfflineError);
  });

  it("takes each chat frame as the latest page, so a clear hides older messages too", async () => {
    const context = await started("viewer");
    context.server.current.emit({
      t: "chat",
      messages: [
        { id: "old", author: "ana", at: 1, body: "long ago" },
        { id: "a", author: "ana", at: 2, body: "first" },
      ],
    });
    context.server.current.emit({ t: "chat", messages: [{ id: "a", author: "ana", at: 2, body: "", deleted: true }] });
    expect(useWeb.getState().chat.map((message) => [message.id, message.deleted])).toEqual([["a", true]]);
  });

  it("merges chat frames by id and keeps them in time order", async () => {
    const context = await started("viewer");
    context.server.current.emit({ t: "chat", messages: [{ id: "b", author: "ana", at: 2, body: "second" }] });
    context.server.current.emit({
      t: "chat",
      messages: [
        { id: "a", author: "ana", at: 1, body: "first" },
        { id: "b", author: "ana", at: 2, body: "second", deleted: true },
      ],
    });
    expect(useWeb.getState().chat.map((message) => [message.id, message.deleted])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("follows renames and removals in the tree", async () => {
    const context = await started("owner");
    await openMain(context);
    context.server.current.emit({
      t: "tree",
      files: [{ fileId: "f-main", path: "chapters/intro.tex", kind: "text" }, TEST_FILES[1]],
    });
    expect(useWeb.getState().activePath).toBe("chapters/intro.tex");
    expect(context.controller.sessionFor("chapters/intro.tex")).not.toBeNull();
    context.server.current.emit({ t: "tree", files: [TEST_FILES[1]] });
    expect(useWeb.getState().activeFileId).toBeNull();
    expect(useWeb.getState().removedPath).toBe("chapters/intro.tex");
    expect(context.controller.sessionFor("chapters/intro.tex")).toBeNull();
  });

  it("drops the comments and suggestions of a file removed from the tree", async () => {
    const context = await started("owner");
    await openMain(context);
    const thread = { id: "t1", fileId: "f-main", anchor: { quote: "Hello", range: { from: 0, to: 5 } }, createdBy: "ana", createdAt: 1, resolved: null, messages: [], verified: true };
    context.server.current.emit({ t: "threads", fileId: "f-main", rev: 1, threads: [thread] });
    context.server.current.emit({ t: "suggestions", fileId: "f-main", rev: 1, suggestions: [] });
    expect(useWeb.getState().threads["f-main"]).toHaveLength(1);
    context.server.current.emit({ t: "tree", files: [TEST_FILES[1]] });
    expect(useWeb.getState().threads).not.toHaveProperty("f-main");
    expect(useWeb.getState().suggestions).not.toHaveProperty("f-main");
  });

  it("reports a role change from the server", async () => {
    const context = await started("editor");
    await openMain(context);
    context.server.current.emit({ t: "access", role: "viewer" });
    expect(useWeb.getState().role).toBe("viewer");
    expect(useWeb.getState().roleChanged).toBe("viewer");
    expect(context.controller.sessionFor("main.tex")?.readOnly).toBe(true);
  });

  it("shows server refusals as a notice", async () => {
    const context = await started("reviewer");
    context.server.current.emit({ t: "error", code: "suggestion_not_yours", message: "Not yours" });
    expect(useWeb.getState().notice).toMatchObject({ code: "suggestion_not_yours", message: "Not yours" });
  });

  it("reopens files after a reconnect and sends typing made while offline", async () => {
    const context = await started("owner");
    await openMain(context, "abc");
    context.server.current.drop();
    expect(useWeb.getState().connection).toBe("offline");
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    expect(context.server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main" }]);
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 4, text: "abc" });
    await flush();
    expect(context.server.current.frames("change")).toEqual([
      { t: "change", fileId: "f-main", rev: 4, op: [3, "!"], id: "t:1" },
    ]);
    expect(useWeb.getState().connection).toBe("online");
  });

  it("never applies typing twice when the socket drops before its ack", async () => {
    const context = await started("owner");
    await openMain(context, "abc");
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    expect(context.controller.unconfirmed()).toBe(true);
    context.server.current.drop();
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    expect(context.server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main", resume: "t:1" }]);
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 4, text: "abc!", resumed: true });
    await flush();
    expect(session?.text()).toBe("abc!");
    expect(context.server.current.frames("change")).toEqual([]);
    expect(context.controller.unconfirmed()).toBe(false);
  });

  it("keeps typing the server has not confirmed through a reload and sends it once", async () => {
    const before = await started("owner");
    await openMain(before, "abc");
    const session = before.controller.sessionFor("main.tex");
    before.server.current.drop();
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    before.controller.flushUnsent();
    expect(sessionStorage.length).toBe(1);
    const after = await started("owner");
    expect(after.server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main" }]);
    after.server.current.emit({ t: "opened", fileId: "f-main", rev: 7, text: "Xabc" });
    await flush();
    expect(after.controller.sessionFor("main.tex")?.text()).toBe("Xabc!");
    expect(after.server.current.frames("change")).toEqual([{ t: "change", fileId: "f-main", rev: 7, op: [4, "!"], id: "t:1" }]);
    after.server.current.emit({ t: "ack", fileId: "f-main", rev: 8 });
    await flush();
    expect(sessionStorage.length).toBe(0);
  });

  it("does not send typing again after a reload when the server took it before the drop", async () => {
    const before = await started("owner");
    await openMain(before, "abc");
    const session = before.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    before.server.current.drop();
    session?.applyLocal([{ from: 4, to: 4, insert: "?" }], session.version());
    before.controller.flushUnsent();
    const after = await started("owner");
    expect(after.server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main", resume: "t:1" }]);
    after.server.current.emit({ t: "opened", fileId: "f-main", rev: 3, text: "abc!", resumed: true });
    await flush();
    expect(after.controller.sessionFor("main.tex")?.text()).toBe("abc!?");
    expect(after.server.current.frames("change")).toEqual([{ t: "change", fileId: "f-main", rev: 3, op: [4, "?"], id: "t:1" }]);
  });

  it("forgets saved typing when the person chooses to leave without it", async () => {
    const context = await started("owner");
    await openMain(context, "abc");
    const session = context.controller.sessionFor("main.tex");
    context.server.current.drop();
    session?.applyLocal([{ from: 0, to: 0, insert: ">" }], session.version());
    context.controller.flushUnsent();
    expect(sessionStorage.length).toBe(1);
    context.controller.discardUnsent();
    expect(sessionStorage.length).toBe(0);
  });

  it("forgets comments and suggestions the server no longer lists when it reconnects", async () => {
    const context = await started("owner");
    context.server.current.emit({
      t: "threads",
      fileId: "f-refs",
      rev: null,
      threads: [{ id: "t1", anchor: { quote: "x", range: null }, createdBy: "ana", messages: [] }],
    });
    expect(useWeb.getState().threads["f-refs"]).toHaveLength(1);
    context.server.current.emit(hello("owner"));
    expect(useWeb.getState().threads["f-refs"]).toHaveLength(1);
    context.server.current.drop();
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    expect(useWeb.getState().threads["f-refs"]).toBeUndefined();
    context.server.current.emit({
      t: "suggestions",
      fileId: "f-refs",
      rev: null,
      suggestions: [{ id: "s1", kind: "insert", author: "ana", createdAt: 1, from: 0, to: 1, text: "x", verified: true }],
    });
    expect(useWeb.getState().suggestions["f-refs"]).toHaveLength(1);
  });

  it("tracks the selection for comments and shares the caret as presence", async () => {
    const context = await started("commenter");
    await openMain(context);
    context.controller.selectionChanged(5, 2);
    expect(useWeb.getState().selection).toEqual({ from: 2, to: 5 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(context.server.current.frames("presence").at(-1)).toEqual({ t: "presence", fileId: "f-main", anchor: 5, head: 2 });
    context.controller.selectionChanged(3, 3);
    expect(useWeb.getState().selection).toBeNull();
    context.controller.stop();
  });

  it("opens binary files without a document session", async () => {
    const context = await started("owner");
    context.controller.openFile("f-fig");
    expect(useWeb.getState().activeFileId).toBe("f-fig");
    expect(useWeb.getState().activePath).toBeNull();
    expect(context.server.current.frames("open")).toEqual([{ t: "open", fileId: "f-main" }]);
  });

  it("takes the compile settings from hello and later compile frames", async () => {
    const context = await started("viewer");
    context.server.current.emit(hello("viewer", { compile: { main_doc: "f-main", engine: "latex" } }));
    expect(useWeb.getState().compileSettings).toEqual({ main_doc: "f-main", engine: "latex" });
    context.server.current.emit({ t: "compile", settings: { engine: "typst" } });
    expect(useWeb.getState().compileSettings).toEqual({ engine: "typst" });
    context.controller.stop();
  });

  it("opens the file and line a click in the PDF points at, and a log entry's line", async () => {
    resetWebState({ me: { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null } });
    const api = fakeApi();
    api.texts = vi.fn(async () => [{ fileId: "f-main", path: "main.tex", text: "Hello world\n" }]);
    const inverse = vi.fn(async () => ({ file: "/Users/ana/thesis/refs.bib", line: 2, column: 0 }));
    const server = new FakeServer();
    const controller = new ProjectController("p1", {
      api,
      socketUrl: "wss://collab.test/web/ws?project=p1",
      createSocket: server.factory,
      setTimer: new ManualTimers().setTimer,
      random: () => 0.5,
      engines: async () => [createFakeEngine()],
      openSyncTex: async () => ({ forward: async () => null, inverse, dispose: () => {} }),
    });
    await controller.start();
    server.current.emit(hello("viewer"));
    await vi.waitFor(() => expect(useWeb.getState().compile.ready).toBe(true));
    await controller.compiler.compile();
    await controller.openFromPdf(1, 80, 90);
    expect(inverse).toHaveBeenCalledWith(1, 80, 90);
    expect(useWeb.getState().activeFileId).toBe("f-refs");
    controller.openLocation("./main.tex", 1);
    expect(useWeb.getState().activeFileId).toBe("f-main");
    controller.openLocation("/usr/share/texmf/article.cls", 3);
    expect(useWeb.getState().activeFileId).toBe("f-main");
    controller.stop();
  });

  it("maps a PDF click from the compiled source to the text as it is now", async () => {
    resetWebState({ me: { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null } });
    const api = fakeApi();
    api.texts = vi.fn(async () => [{ fileId: "f-main", path: "main.tex", text: "Hello world\n" }]);
    const inverse = vi.fn(async () => ({ file: "main.tex", line: 1, column: 0 }));
    const mapLine = vi.fn(async () => null);
    const server = new FakeServer();
    const controller = new ProjectController("p1", {
      api,
      socketUrl: "wss://collab.test/web/ws?project=p1",
      createSocket: server.factory,
      setTimer: new ManualTimers().setTimer,
      random: () => 0.5,
      engines: async () => [createFakeEngine()],
      openSyncTex: async () => ({ forward: async () => null, inverse, dispose: () => {} }),
      mapLine,
    });
    await controller.start();
    server.current.emit(hello("viewer"));
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "Hello world\n" });
    await flush();
    await vi.waitFor(() => expect(useWeb.getState().compile.ready).toBe(true));
    await controller.compiler.compile();
    expect(controller.compiler.compiledSource("main.tex")).toBe("Hello world\n");
    server.current.emit({ t: "remote", fileId: "f-main", rev: 2, op: ["Intro\n", 12], length: 18 });
    await flush();
    await controller.openFromPdf(1, 80, 90);
    await vi.waitFor(() => expect(mapLine).toHaveBeenCalledWith("Hello world\n", "Intro\nHello world\n", 1, false));
    useWeb.setState((state) => ({ compile: { ...state.compile, shown: "shared" } }));
    expect(controller.compiler.compiledSource("main.tex")).toBeNull();
    controller.stop();
  });

  it("recompiles after this browser's own edits, not a co-author's", async () => {
    resetWebState({ me: { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null } });
    const api = fakeApi();
    api.texts = vi.fn(async () => [{ fileId: "f-main", path: "main.tex", text: "Hello world" }]);
    const server = new FakeServer();
    const timers = new ManualTimers();
    const controller = new ProjectController("p1", {
      api,
      socketUrl: "wss://collab.test/web/ws?project=p1",
      createSocket: server.factory,
      setTimer: timers.setTimer,
      random: () => 0.5,
      engines: async () => [createFakeEngine()],
    });
    await controller.start();
    server.current.emit(hello("viewer"));
    server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "Hello world" });
    await flush();
    await vi.waitFor(() => expect(useWeb.getState().compile.ready).toBe(true));
    await controller.compiler.compile();
    const compiling = () => timers.delays.filter((ms) => ms === 1_200).length;
    server.current.emit({ t: "remote", fileId: "f-main", rev: 2, op: [11, "!"], length: 12 });
    await flush();
    expect(controller.sessionFor("main.tex")?.text()).toBe("Hello world!");
    expect(compiling()).toBe(0);
    controller.stop();
  });
});


describe("outbox after review", () => {
  beforeEach(() => sessionStorage.clear());

  it("queues a comment written while earlier ones are still being sent, so they land in order", async () => {
    const context = await started("owner");
    const thread = { id: "t1", fileId: "f-main", anchor: { quote: "", range: null }, createdBy: "ana", createdAt: 1, resolved: null, messages: [], verified: true };
    context.server.current.drop();
    await context.controller.replyComment(thread, "First");
    await context.controller.replyComment(thread, "Second");
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await Promise.resolve();
    const late = context.controller.replyComment(thread, "Third");
    const answer = answered(context);
    for (let round = 0; round < 20 && useWeb.getState().outbox.length > 0; round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await late;
    const bodies = context.server.current.frames("comment").map((frame) => ("body" in frame ? frame.body : null));
    expect(bodies).toEqual(["First", "Second", "Third"]);
  });

  async function offlineComment(text: string) {
    const context = await started("commenter");
    await openMain(context, "Hello world", 3);
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
    context.server.current.drop();
    await context.controller.createComment("Which world?");
    context.timers.runNext();
    context.server.current.emit(hello("commenter"));
    const answer = revChecking(context, 0);
    await flush();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text });
    for (let round = 0; round < 30 && useWeb.getState().outbox.some((item) => item.state === "waiting"); round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return context;
  }

  it("sends a comment written offline at the new session's revision once the file reopens", async () => {
    const context = await offlineComment("Hello world");
    expect(useWeb.getState().outbox).toEqual([]);
    expect(context.server.current.frames("comment")).toEqual([
      expect.objectContaining({ action: "create", from: 6, to: 11, rev: 0, body: "Which world?" }),
    ]);
  });

  it("finds the quoted text again when a co-author edited the file while this browser was offline", async () => {
    const context = await offlineComment("Oh, Hello world");
    expect(useWeb.getState().outbox).toEqual([]);
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ from: 10, to: 15, rev: 0 })]);
  });

  it("re-finds a short repeated quote by the text around it, not by the nearest copy", async () => {
    const context = await started("commenter");
    await openMain(context, "We test the model.", 3);
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 8, to: 11, quote: "the" } });
    context.server.current.drop();
    await context.controller.createComment("Which one?");
    context.timers.runNext();
    context.server.current.emit(hello("commenter"));
    const answer = revChecking(context, 0);
    await flush();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "In the abstract, We test the model." });
    for (let round = 0; round < 30 && useWeb.getState().outbox.some((item) => item.state === "waiting"); round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ from: 25, to: 28, rev: 0 })]);
  });

  it("waits for the file to reopen again when the socket drops while the comment waits for typing to settle", async () => {
    const context = await started("owner");
    await openMain(context, "Hello world", 3);
    context.server.current.drop();
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 0, to: 0, insert: "Draft: " }], session.version());
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 13, to: 18, quote: "world" } });
    await context.controller.createComment("Which world?");
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await flush();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Hello world" });
    await flush();
    expect(context.server.current.frames("change")).toHaveLength(1);
    context.server.current.drop();
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();
    expect(context.server.current.frames("comment")).toEqual([]);
    const answer = answered(context);
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "Draft: Hello world", resumed: true });
    for (let round = 0; round < 30 && useWeb.getState().outbox.some((item) => item.state === "waiting"); round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 13, to: 18, rev: 1 })]);
  });

  it("asks for a new selection, without sending, when the quoted text is gone", async () => {
    const context = await offlineComment("Hello there");
    expect(context.server.current.frames("comment")).toEqual([]);
    expect(useWeb.getState().outbox).toEqual([
      expect.objectContaining({ state: "failed", reason: "comment_selection_changed", retry: false }),
    ]);
  });

  it("sends a comment kept through a reload once the file it quotes is open again", async () => {
    const before = await started("commenter");
    await openMain(before, "Hello world", 3);
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
    before.server.current.drop();
    await before.controller.createComment("Which world?");
    before.controller.stop();
    const after = await started("commenter");
    const answer = revChecking(after, 0);
    await flush();
    after.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Hello world" });
    for (let round = 0; round < 30 && useWeb.getState().outbox.length > 0; round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(useWeb.getState().outbox).toEqual([]);
    expect(after.server.current.frames("comment")).toEqual([expect.objectContaining({ from: 6, to: 11, rev: 0 })]);
  });

  it("re-sends its presence while idle so it stays here now", async () => {
    const context = await started("owner");
    const before = context.server.current.frames("presence").length;
    const keepAlive = context.timers.pending.find((entry) => !entry.cancelled && entry.ms > 0 && entry.ms < 30_000 && entry.ms >= 10_000);
    expect(keepAlive).toBeDefined();
    keepAlive?.run();
    expect(context.server.current.frames("presence").length).toBeGreaterThan(before);
  });
});

describe("outbox and presence wire fields", () => {
  beforeEach(() => sessionStorage.clear());

  it("sends each queued comment and chat message with its own client id, so a resend can't post twice", async () => {
    const context = await started("owner");
    const thread = { id: "t1", fileId: "f-main", anchor: { quote: "", range: null }, createdBy: "ana", createdAt: 1, resolved: null, messages: [], verified: true };
    const answer = answered(context);
    await settle(context.controller.replyComment(thread, "Done"), answer);
    await settle(context.controller.sendChat("Hi @Ana"), answer);
    const [reply] = context.server.current.frames("comment");
    const [chat] = context.server.current.frames("chat");
    expect(reply).toMatchObject({ clientId: expect.stringMatching(/^outbox-/u) });
    expect(chat).toMatchObject({ clientId: expect.stringMatching(/^outbox-/u), members: expect.arrayContaining([{ accountId: "ana", displayName: "Ana", login: "ana" }]) });
  });

  it("stamps a peer's replying only when that peer's own presence advanced", async () => {
    const context = await started("owner");
    const peer = (seq: number) => ({ deviceId: "d-ana", accountId: "ana", name: "Ana", fileId: null, anchor: null, head: null, activity: { kind: "reply", threadId: "t1" }, seq });
    const other = (seq: number) => ({ deviceId: "d-bo", accountId: "bo", name: "Bo", fileId: null, anchor: null, head: null, activity: null, seq });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    context.server.current.emit({ t: "presence", peers: [peer(1), other(1)] });
    now.mockReturnValue(5_000);
    context.server.current.emit({ t: "presence", peers: [peer(1), other(2)] });
    expect(useWeb.getState().activityAt["d-ana"]).toBe(1_000);
    now.mockReturnValue(6_000);
    context.server.current.emit({ t: "presence", peers: [peer(2), other(2)] });
    expect(useWeb.getState().activityAt["d-ana"]).toBe(6_000);
    now.mockRestore();
  });

  it("keeps the typing peer and the activity stamps as they were when only someone else's cursor moved", async () => {
    const context = await started("owner");
    const peer = (seq: number) => ({ deviceId: "d-ana", accountId: "ana", name: "Ana", fileId: null, anchor: null, head: null, activity: { kind: "reply", threadId: "t1" }, seq });
    const other = (seq: number) => ({ deviceId: "d-bo", accountId: "bo", name: "Bo", fileId: "f-main", anchor: seq, head: seq, activity: null, seq });
    context.server.current.emit({ t: "presence", peers: [peer(1), other(1)] });
    const { peers, activityAt } = useWeb.getState();
    context.server.current.emit({ t: "presence", peers: [peer(1), other(2)] });
    expect(useWeb.getState().activityAt).toBe(activityAt);
    expect(useWeb.getState().peers[0]).toBe(peers[0]);
    expect(useWeb.getState().peers[1]).not.toBe(peers[1]);
    const moved = useWeb.getState().peers;
    context.server.current.emit({ t: "presence", peers: [peer(1), other(2)] });
    expect(useWeb.getState().peers).toBe(moved);
  });
});

async function answerUntilSent(answer: () => void) {
  for (let round = 0; round < 30 && useWeb.getState().outbox.some((item) => item.state === "waiting"); round += 1) {
    answer();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function placedAfter(text: string, from: number, quote: string, edited: string, reload = false) {
  const first = await started("commenter");
  await openMain(first, text, 3);
  useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from, to: from + quote.length, quote } });
  first.server.current.drop();
  await first.controller.createComment("Which one?");
  let context = first;
  if (reload) {
    first.controller.stop();
    context = await started("commenter");
  } else {
    first.timers.runNext();
    first.server.current.emit(hello("commenter"));
  }
  await flush();
  const answer = revChecking(context, 0);
  const begun = performance.now();
  context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: edited });
  await answerUntilSent(answer);
  return { sent: context.server.current.frames("comment"), ms: performance.now() - begun };
}

async function sentAfter(text: string, from: number, quote: string, edited: string, reload = false) {
  return (await placedAfter(text, from, quote, edited, reload)).sent;
}

describe("outbox placement after the second review", () => {
  beforeEach(() => sessionStorage.clear());

  it.each([false, true])("keeps a queued comment on its own copy of a repeated quote when a co-author edits right beside it (after a reload: %s)", async (reload) => {
    const text = "Intro: we test the model here. Body: we test the model there.";
    const sent = await sentAfter(text, 45, "the", text.replace("Body: we test", "Body: we check"), reload);
    expect(sent).toEqual([expect.objectContaining({ action: "create", from: 46, to: 49, rev: 0 })]);
  });

  const LINE = "We test the model on the data here.\n";
  const PARAGRAPH = "We test the model on the data that we collected in the field last year.\n";

  it.each([
    [false, "We test the model. Results are in the appendix.", 8, "the", "Results are in the appendix."],
    [true, "We test the model. Results are in the appendix.", 8, "the", "Results are in the appendix."],
    [false, "We test the model.\nResults: we test the model.", 8, "the", "We test a model.\nResults: we test the model."],
    [false, "We train the model. We test the model.", 9, "the", "We train a model. We test the model!"],
    [true, "We train the model. We test the model.", 9, "the", "We train a model. We test the model!"],
    [false, "We train the model.\nWe test the model.", 9, "the", "We train a model.\nWe test the model!"],
    [false, "See the plot. See the plot.", 4, "the", "See a plot. See the plot!"],
    [false, LINE.repeat(3), 12, "model", LINE.repeat(3).replace("the model", "the method")],
    [true, "We fit the model to the data. Then we fit the model to more data.", 7, "the", "We fit a model to the data. Then we fit the model to more data."],
    [true, PARAGRAPH.repeat(2), PARAGRAPH.length + 12, "model", PARAGRAPH.repeat(3)],
  ])("asks for a new selection instead of moving a queued comment to another copy when its own copy was replaced (after a reload: %s, %j)", async (reload, text, from, quote, edited) => {
    expect(await sentAfter(text, from, quote, edited, reload)).toEqual([]);
    expect(useWeb.getState().outbox).toEqual([
      expect.objectContaining({ state: "failed", reason: "comment_selection_changed", retry: false }),
    ]);
  });

  it("anchors a queued comment beside the person's own offline typing, not on the copy the server had", async () => {
    const context = await started("owner");
    await openMain(context, "Use the cat. Use the cat.", 0);
    context.server.current.drop();
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 13, to: 16, insert: "Pet" }], session.version());
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 17, to: 20, quote: "the" } });
    await context.controller.createComment("Which cat?");
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await flush();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Use the cat. Use the cat." });
    await flush();
    expect(context.server.current.frames("change")).toHaveLength(1);
    context.server.current.emit({ t: "ack", fileId: "f-main", rev: 1 });
    await answerUntilSent(revChecking(context, 1));
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 17, to: 20, rev: 1 })]);
  });

  it("takes a reloaded comment's surroundings from the text as typed, so it stays beside the person's own typing", async () => {
    const before = await started("owner");
    await openMain(before, "Use the cat. Use the cat.", 0);
    before.server.current.drop();
    const session = before.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 13, to: 16, insert: "Pet" }], session.version());
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 17, to: 20, quote: "the" } });
    await before.controller.createComment("Which cat?");
    before.controller.flushUnsent();
    before.controller.stop();
    const after = await started("owner");
    await flush();
    after.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Use the cat. Use the cat." });
    await flush();
    after.server.current.emit({ t: "ack", fileId: "f-main", rev: 1 });
    await answerUntilSent(revChecking(after, 1));
    expect(after.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 17, to: 20, rev: 1 })]);
  });

  it("waits for a held file to reopen before sending a comment written right after a reconnect", async () => {
    const context = await started("owner");
    await openMain(context, "Hello world", 0);
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 0, to: 0, insert: "Draft: " }], session.version());
    context.server.current.drop();
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await flush();
    expect(useWeb.getState().connection).toBe("online");
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 13, to: 18, quote: "world" } });
    const answer = answered(context);
    const work = context.controller.createComment("Which world?");
    for (let round = 0; round < 5; round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(context.server.current.frames("comment")).toEqual([]);
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 1, text: "Draft: Hello world", resumed: true });
    await settle(work, answer);
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 13, to: 18, rev: 1 })]);
  });

  it("waits for a reopening file before sending, instead of sending raw offsets with no revision", async () => {
    const context = await started("owner");
    await openMain(context, "Hello world", 3);
    context.server.current.drop();
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await flush();
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
    const answer = answered(context);
    const work = context.controller.createComment("Which world?");
    for (let round = 0; round < 5; round += 1) {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(context.server.current.frames("comment")).toEqual([]);
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Oh, Hello world" });
    await settle(work, answer);
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 10, to: 15, rev: 0 })]);
  });

  it("keeps queued comments waiting in order while their file is slow to reopen, lets the chat go first, then sends them without a Retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const context = await started("commenter");
      await openMain(context, "Hello world", 3);
      context.server.current.drop();
      for (const [from, quote] of [[0, "Hello"], [6, "world"]] as const) {
        useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from, to: from + quote.length, quote } });
        await context.controller.createComment(`About ${quote}`);
      }
      await context.controller.sendChat("See my comments");
      context.timers.runNext();
      context.server.current.emit(hello("commenter"));
      const answer = answered(context);
      for (let round = 0; round < 40; round += 1) {
        answer();
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(context.server.current.frames("chat")).toEqual([expect.objectContaining({ body: "See my comments" })]);
      expect(useWeb.getState().outbox.map((item) => [item.body, item.state, item.reason, item.retry])).toEqual([
        ["About Hello", "waiting", null, false],
        ["About world", "waiting", null, false],
      ]);
      context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Hello world" });
      for (let round = 0; round < 30 && useWeb.getState().outbox.length > 0; round += 1) {
        answer();
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(useWeb.getState().outbox).toEqual([]);
      expect(context.server.current.frames("comment")).toEqual([
        expect.objectContaining({ action: "create", from: 0, to: 5, rev: 0, body: "About Hello" }),
        expect.objectContaining({ action: "create", from: 6, to: 11, rev: 0, body: "About world" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("brings back the comments and suggestions of a file restored from the trash", async () => {
    const context = await started("owner");
    const thread = { id: "t1", fileId: "f-refs", anchor: { quote: "x", range: null }, createdBy: "ana", createdAt: 1, resolved: null, messages: [], verified: true };
    const suggestion = { id: "s1", kind: "insert", author: "ana", createdAt: 1, from: 0, to: 1, text: "x", verified: true };
    context.server.current.emit({ t: "threads", fileId: "f-refs", rev: null, threads: [thread] });
    context.server.current.emit({ t: "suggestions", fileId: "f-refs", rev: null, suggestions: [suggestion] });
    context.server.current.emit({ t: "tree", files: [TEST_FILES[0], TEST_FILES[2]] });
    expect(useWeb.getState().threads).not.toHaveProperty("f-refs");
    expect(useWeb.getState().suggestions).not.toHaveProperty("f-refs");
    context.server.current.emit({ t: "tree", files: TEST_FILES });
    expect(useWeb.getState().threads["f-refs"]).toEqual([thread]);
    expect(useWeb.getState().suggestions["f-refs"]).toEqual([expect.objectContaining(suggestion)]);
  });

  it("restores a returning file's comments from the newest frame, not the one it had when it left", async () => {
    const context = await started("owner");
    const thread = (id: string) => ({ id, fileId: "f-refs", anchor: { quote: "x", range: null }, createdBy: "ana", createdAt: 1, resolved: null, messages: [], verified: true });
    const suggestion = { id: "s1", kind: "insert", author: "ana", createdAt: 1, from: 0, to: 1, text: "x", verified: true };
    context.server.current.emit({ t: "threads", fileId: "f-refs", rev: null, threads: [thread("old")] });
    context.server.current.emit({ t: "tree", files: [TEST_FILES[0]] });
    context.server.current.emit({ t: "threads", fileId: "f-refs", rev: null, threads: [thread("new")] });
    context.server.current.emit({ t: "suggestions", fileId: "f-refs", rev: null, suggestions: [suggestion] });
    expect(useWeb.getState().threads).not.toHaveProperty("f-refs");
    expect(useWeb.getState().suggestions).not.toHaveProperty("f-refs");
    context.server.current.emit({ t: "tree", files: TEST_FILES });
    expect(useWeb.getState().threads["f-refs"]).toEqual([thread("new")]);
    expect(useWeb.getState().suggestions["f-refs"]).toEqual([expect.objectContaining(suggestion)]);
  });

  it.each([
    ["Hello big world", 6, "big", "Oh, Hello big world!", 10],
    ["We test the model on the data that we collected here.", 12, "model", "Now We test the model on the data that we collected there.", 16],
    ["Alpha\nHello big world", 12, "big", "Xlpha\nHello big world!", 12],
  ])("sends a same-tab queued comment on its intact quote when edits on both sides of it merge into one change (%s)", async (text, from, quote, edited, moved) => {
    const sent = await sentAfter(text, from, quote, edited);
    expect(useWeb.getState().outbox).toEqual([]);
    expect(sent).toEqual([expect.objectContaining({ action: "create", from: moved, to: moved + quote.length, rev: 0 })]);
  });

  it("sends a queued comment beside the person's own typing on both sides of its quote", async () => {
    const context = await started("owner");
    await openMain(context, "Hello big world", 0);
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 9, quote: "big" } });
    context.server.current.drop();
    await context.controller.createComment("Which one?");
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 0, to: 0, insert: "Oh, " }, { from: 15, to: 15, insert: "!" }], session.version());
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await flush();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Hello big world" });
    await flush();
    expect(context.server.current.frames("change")).toHaveLength(1);
    context.server.current.emit({ t: "ack", fileId: "f-main", rev: 1 });
    await answerUntilSent(revChecking(context, 1));
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 10, to: 13, rev: 1 })]);
  });

  it("places a direct comment at the text it was written on, not at a selection started while it waits", async () => {
    const context = await started("owner");
    await openMain(context, "Hello world", 3);
    context.server.current.drop();
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await flush();
    const select = (from: number, to: number) => {
      setEditorView({ state: EditorState.create({ doc: "Hello world", selection: EditorSelection.single(from, to) }) } as never);
      context.controller.startComment();
    };
    try {
      select(6, 11);
      const answer = answered(context);
      const work = context.controller.createComment("About world");
      await flush();
      select(0, 5);
      context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Hello world" });
      await settle(work, answer);
    } finally {
      setEditorView(null);
    }
    expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 6, to: 11, body: "About world" })]);
    expect(useWeb.getState().draft).toMatchObject({ from: 0, to: 5, quote: "Hello" });
  });

  it("says the file is gone when a comment queued offline is on a file removed meanwhile", async () => {
    const context = await started("commenter");
    await openMain(context, "Hello world", 3);
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
    context.server.current.drop();
    await context.controller.createComment("Which world?");
    context.timers.runNext();
    context.server.current.emit(hello("commenter", { files: TEST_FILES.slice(1) }));
    await answerUntilSent(answered(context));
    expect(context.server.current.frames("comment")).toEqual([]);
    expect(useWeb.getState().outbox).toEqual([
      expect.objectContaining({ state: "failed", reason: "comment_file_removed", retry: false }),
    ]);
  });

  it.each([5_000, 16_000])("fails a queued comment whose file is removed while it waits for that file, so it can be discarded (%i ms)", async (wait) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const context = await started("commenter");
      await openMain(context, "Hello world", 3);
      useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
      context.server.current.drop();
      await context.controller.createComment("Which world?");
      context.timers.runNext();
      context.server.current.emit(hello("commenter"));
      await vi.advanceTimersByTimeAsync(wait);
      expect(useWeb.getState().outbox).toEqual([expect.objectContaining({ state: "waiting" })]);
      context.server.current.emit({ t: "tree", files: TEST_FILES.slice(1) });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(context.server.current.frames("comment")).toEqual([]);
      expect(useWeb.getState().outbox).toEqual([
        expect.objectContaining({ state: "failed", reason: "comment_file_removed", retry: false }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["Hello ", "Hello there!"])("asks for a new selection, without sending, when a direct comment's text is deleted or replaced while it waits (%j)", async (reopened) => {
    const context = await started("owner");
    await openMain(context, "Hello world", 3);
    context.server.current.drop();
    context.timers.runNext();
    context.server.current.emit(hello("owner"));
    await flush();
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
    const answer = answered(context);
    const work = context.controller.createComment("Which world?");
    await flush();
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: reopened });
    await expect(settle(work, answer)).rejects.toMatchObject({ code: "comment_selection_changed" });
    expect(context.server.current.frames("comment")).toEqual([]);
    expect(useWeb.getState().draft).toMatchObject({ from: 6, to: 11, quote: "world" });
  });

  it("never sends an empty range, even for a comment on typing the server hasn't confirmed yet", async () => {
    const context = await started("owner");
    await openMain(context, "Hello ");
    const session = context.controller.sessionFor("main.tex");
    session?.applyLocal([{ from: 6, to: 6, insert: "world" }], session.version());
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
    await expect(settle(context.controller.createComment("Which world?"), answered(context))).rejects.toMatchObject({
      code: "comment_selection_changed",
    });
    expect(context.server.current.frames("comment")).toEqual([]);
  });
});

const WORDS =
  "we fit a model to the data and test it on images that were collected in the field last year so each sample was measured twice with one protocol while results stay close to prior work in our study of how groups change over time".split(
    " ",
  );

function seeded(start: number): () => number {
  let seed = start;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function prose(length: number): string {
  const next = seeded(7);
  const parts: string[] = [];
  for (let size = 0; size < length; ) {
    const word = WORDS[Math.floor(next() * WORDS.length)];
    const end = next() < 0.07 ? ".\n" : " ";
    parts.push(word, end);
    size += word.length + end.length;
  }
  return parts.join("").slice(0, length);
}

function refusedHere() {
  expect(useWeb.getState().outbox).toEqual([expect.objectContaining({ state: "failed", reason: "comment_selection_changed", retry: false })]);
}

describe("outbox placement after the third review", () => {
  beforeEach(() => sessionStorage.clear());

  const RULE = `${"-".repeat(16)}\nSection two starts right below the rule.`;
  const NEAR_COPIES = [
    ["We fit a model to a dataset of images collected last year.", 18, "a"],
    ["We know this is a good result for the whole group of people here.", 13, "is"],
    ["The count was 1000000 in total across the two sites.", 15, "000"],
    [RULE, 12, "----"],
  ] as const;

  it.each(NEAR_COPIES.flatMap(([text, from, quote]) => [true, false].map((reload) => [reload, text, from, quote] as const)))(
    "sends a queued comment on unchanged text at its own place when a copy of the quote sits a few characters away (after a reload: %s, %j)",
    async (reload, text, from, quote) => {
      expect(await sentAfter(text, from, quote, text, reload)).toEqual([
        expect.objectContaining({ action: "create", from, to: from + quote.length, rev: 0 }),
      ]);
      expect(useWeb.getState().outbox).toEqual([]);
    },
  );

  it("sends a same-tab queued comment on its intact quote when far edits on both sides merge into one change and a copy sits a few characters away", async () => {
    const text = "Intro: these opening words are only here as filler text. We fit a model to a dataset of images collected last year in the field, and these closing words are filler too.";
    const edited = text.replace("Intro", "Intra").replace(/\.$/u, "!");
    expect(await sentAfter(text, 75, "a", edited)).toEqual([expect.objectContaining({ action: "create", from: 75, to: 76, rev: 0 })]);
  });

  it.each([true, false])("lands on its own copy when a co-author changed one character of its context and a copy sits a few characters away (after a reload: %s)", async (reload) => {
    const text = "We fit a model to a dataset of images collected last year.";
    expect(await sentAfter(text, 18, "a", text.replace("images", "imagery"), reload)).toEqual([
      expect.objectContaining({ action: "create", from: 18, to: 19, rev: 0 }),
    ]);
  });

  it("still asks for a new selection after a reload when another copy has exactly the same surroundings, and sends it in the same tab", async () => {
    const text = "AB the CD. ".repeat(10);
    expect(await sentAfter(text, 47, "the", text, true)).toEqual([]);
    expect(useWeb.getState().outbox).toEqual([
      expect.objectContaining({ state: "failed", reason: "comment_selection_changed", retry: false }),
    ]);
    sessionStorage.clear();
    expect(await sentAfter(text, 47, "the", text)).toEqual([expect.objectContaining({ action: "create", from: 47, to: 50, rev: 0 })]);
  });

  it.each([
    [300_000, false],
    [300_000, true],
    [2_000_000, false],
    [2_000_000, true],
  ])("places a reloaded one-letter quote in %i characters of prose without freezing the tab (context edited: %s)", async (size, edited) => {
    const text = prose(size);
    const from = text.indexOf(" a ", size / 2) + 1;
    const reopened = edited ? `${text.slice(0, from + 30)}#${text.slice(from + 31)}` : text;
    const { sent, ms } = await placedAfter(text, from, "a", reopened, true);
    expect(sent).toEqual([expect.objectContaining({ action: "create", from, to: from + 1, rev: 0 })]);
    expect(ms).toBeLessThan(1_000);
  });

  it.each([
    ["at its stored place", 0, [{ from: 1_000_000, to: 1_000_001 }]],
    ["moved one character by an edit before it", 1, []],
  ])("decides quickly on a one-letter quote with an edited context in 2 MB of text where similar copies are everywhere, when it is %s", async (_, shift, expected) => {
    const next = seeded(11);
    const text = Array.from({ length: 2_000_000 }, () => (next() < 0.5 ? "a" : "b")).join("").replace(/^(.{1000000})./su, "$1a");
    const edited = `${text.slice(0, 1_000_010)}#${text.slice(1_000_011)}`;
    const reopened = `${"#".repeat(shift)}${edited}`;
    const { sent, ms } = await placedAfter(text, 1_000_000, "a", reopened, true);
    expect(sent).toEqual(expected.map((range) => expect.objectContaining(range)));
    if (expected.length === 0) refusedHere();
    expect(ms).toBeLessThan(1_000);
  });
});

describe("queued comments on a file that leaves and comes back", () => {
  beforeEach(() => sessionStorage.clear());

  async function waitingComment() {
    const context = await started("commenter");
    await openMain(context, "Hello world", 3);
    useWeb.setState({ draft: { fileId: "f-main", path: "main.tex", from: 6, to: 11, quote: "world" } });
    context.server.current.drop();
    await context.controller.createComment("Which world?");
    context.timers.runNext();
    return context;
  }

  async function sentOnceOpened(context: Awaited<ReturnType<typeof started>>) {
    const answer = answered(context);
    context.server.current.emit({ t: "opened", fileId: "f-main", rev: 0, text: "Hello world" });
    for (let round = 0; round < 30 && useWeb.getState().outbox.length > 0; round += 1) {
      answer();
      await vi.advanceTimersByTimeAsync(20);
    }
  }

  it("sends a queued comment once its file is restored from the trash with the same id", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const context = await waitingComment();
      context.server.current.emit(hello("commenter"));
      await vi.advanceTimersByTimeAsync(5_000);
      context.server.current.emit({ t: "tree", files: TEST_FILES.slice(1) });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(useWeb.getState().outbox).toEqual([expect.objectContaining({ state: "failed", reason: "comment_file_removed", retry: false })]);
      context.server.current.emit({ t: "tree", files: TEST_FILES });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(useWeb.getState().outbox).toEqual([expect.objectContaining({ state: "waiting", reason: null })]);
      await sentOnceOpened(context);
      expect(useWeb.getState().outbox).toEqual([]);
      expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 6, to: 11, rev: 0, body: "Which world?" })]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a comment that failed because its file was gone at reconnect once a later reconnect lists the file again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const context = await waitingComment();
      context.server.current.emit(hello("commenter", { files: TEST_FILES.slice(1) }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(useWeb.getState().outbox).toEqual([expect.objectContaining({ state: "failed", reason: "comment_file_removed" })]);
      context.server.current.drop();
      context.timers.runNext();
      context.server.current.emit(hello("commenter"));
      await vi.advanceTimersByTimeAsync(1_000);
      await sentOnceOpened(context);
      expect(context.server.current.frames("comment")).toEqual([expect.objectContaining({ action: "create", from: 6, to: 11, rev: 0 })]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a queued comment waiting through a rename and sends it at the new path", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const context = await waitingComment();
      context.server.current.emit(hello("commenter"));
      await vi.advanceTimersByTimeAsync(5_000);
      context.server.current.emit({ t: "tree", files: [{ ...TEST_FILES[0], path: "chapters/main.tex" }, ...TEST_FILES.slice(1)] });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(useWeb.getState().outbox).toEqual([expect.objectContaining({ state: "waiting" })]);
      await sentOnceOpened(context);
      expect(context.server.current.frames("comment")).toEqual([
        expect.objectContaining({ action: "create", path: "chapters/main.tex", from: 6, to: 11, rev: 0 }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("outbox placement after the final check", () => {
  beforeEach(() => sessionStorage.clear());

  const TWIN = "We test the model on the data that we collected in the field last year.\n";

  it.each([
    ["a twin's end edited", TWIN.repeat(3), TWIN.repeat(3).replace("year.", "year!")],
    ["its own surroundings edited", TWIN.repeat(3), TWIN.repeat(3).replace(/the data/gu, (match, at: number) => (at > 72 && at < 144 ? "the date" : match))],
    ["the twin pair 50 KB later", TWIN.repeat(2) + prose(50_000) + TWIN.repeat(2), (TWIN.repeat(2) + prose(50_000) + TWIN.repeat(2)).replace("year.", "year!")],
  ])("asks for a new selection after a reload, instead of moving to a twin, when one character changed beside its own copy (%s)", async (_, text, edited) => {
    expect(await sentAfter(text, 84, "model", edited, true)).toEqual([]);
    refusedHere();
  });

  it("sends the same twin case in the same tab at its own copy", async () => {
    const text = TWIN.repeat(3);
    expect(await sentAfter(text, 84, "model", text.replace("year.", "year!"))).toEqual([expect.objectContaining({ action: "create", from: 84, to: 89, rev: 0 })]);
  });

  const DATASET = "We fit a model to a dataset of images collected last year.";
  const MERGED = "Intro: these opening words are only here as filler text. We fit a model to a dataset of images collected last year in the field, and these closing words are filler too.";
  const merged = (text: string) => text.replace("Intro", "Intra").replace(/\.$/u, "!");

  it.each([
    [true, DATASET, 18, "a", DATASET.replace("to a dataset", "to dataset")],
    [true, DATASET, 18, "a", DATASET.replace("to a dataset", "to the dataset")],
    [true, "We know this is his result for the whole group of people.", 13, "is", "We know this his result for the whole group of people."],
    [false, MERGED, 75, "a", merged(MERGED.replace("to a dataset", "to dataset"))],
    [false, MERGED, 75, "a", merged(MERGED.replace("to a dataset", "to the dataset"))],
  ])("sends nothing when its quote was deleted or replaced and copies of the same letters sit beside it (after a reload: %s, %j)", async (reload, text, from, quote, edited) => {
    expect(await sentAfter(text, from, quote, edited, reload)).toEqual([]);
    refusedHere();
  });

  it("tries the stored place first, so an unchanged comment is sent there even when a copy elsewhere differs from it by one character", async () => {
    const text = `${TWIN}${TWIN.replace("year.", "year!")}${TWIN}`;
    expect(await sentAfter(text, 156, "model", text, true)).toEqual([expect.objectContaining({ action: "create", from: 156, to: 161, rev: 0 })]);
  });

  it.each([
    [1_000_000, " "],
    [2_000_000, " "],
    [2_000_000, "the "],
  ])("places a reloaded comment in %i characters on its stored copy of %j when one character of its context changed, even with thousands of similar copies far away", async (size, lead) => {
    const text = prose(size);
    const from = text.indexOf(lead, size / 2) + lead.length - 1;
    const reopened = `${text.slice(0, from + 30)}#${text.slice(from + 31)}`;
    const { sent, ms } = await placedAfter(text, from, " ", reopened, true);
    expect(sent).toEqual([expect.objectContaining({ action: "create", from, to: from + 1, rev: 0 })]);
    expect(ms).toBeLessThan(1_000);
  });
});

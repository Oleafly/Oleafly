import { createFakeEngine } from "@oleafly/compile-port/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type WebApi, type WebProjectDetail } from "./api";
import { OfflineError, ProjectController } from "./controller";
import { resetWebState, useWeb } from "./store";
import { FakeServer, hello, ManualTimers, TEST_FILES } from "./testing/fake-socket";

const DETAIL: WebProjectDetail = {
  project: { projectId: "p1", title: "Thesis", owner: { accountId: "own", name: "Olive", avatarUrl: null, login: null }, role: "owner" },
  role: "owner",
  files: [],
  features: { comments: true, suggestions: true, chat: true },
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
        reqId: "t:r1",
      },
    ]);
    expect(useWeb.getState().draft).toBeNull();
  });

  it("keeps the draft when the server refuses a comment, and tries again when the text moved", async () => {
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
    await expect(settle(context.controller.createComment("Again"), refused)).rejects.toMatchObject({
      code: "comment_off_project",
    });
    expect(useWeb.getState().draft).toEqual(draft);
    expect(useWeb.getState().notice).toBeNull();
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

  it("sends review, comment and chat actions and fails them while offline", async () => {
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
      { t: "chat", action: "send", body: "Hi", reqId: "t:r5" },
      { t: "chat", action: "clear", reqId: "t:r6" },
    ]);
    const pending = context.controller.sendChat("in flight");
    context.server.current.drop();
    await expect(pending).rejects.toBeInstanceOf(OfflineError);
    await expect(context.controller.sendChat("lost")).rejects.toBeInstanceOf(OfflineError);
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


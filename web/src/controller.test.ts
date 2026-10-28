import { describe, expect, it, vi } from "vitest";
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
    blob: vi.fn(),
    output: vi.fn(async () => null),
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
  });
  await controller.start();
  server.current.emit(hello(role));
  return { controller, server, timers, api };
}

async function openMain(context: Awaited<ReturnType<typeof started>>, text = "Hello world", rev = 1) {
  context.server.current.emit({ t: "opened", fileId: "f-main", rev, text });
  await flush();
}

describe("ProjectController", () => {
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
    await context.controller.createComment("Typo here");
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
      },
    ]);
    expect(useWeb.getState().draft).toBeNull();
  });

  it("sends review, comment and chat actions and fails them while offline", async () => {
    const context = await started("owner");
    await context.controller.acceptSuggestions(["s1"]);
    await context.controller.rejectFile("f-main");
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
    await context.controller.resolveThread(thread);
    await context.controller.replyComment(thread, "Done");
    await context.controller.sendChat("Hi");
    await context.controller.clearChat();
    expect(context.server.current.frames("suggestion")).toEqual([
      { t: "suggestion", action: "accept", ids: ["s1"] },
      { t: "suggestion", action: "reject_file", fileId: "f-main" },
    ]);
    expect(context.server.current.frames("comment").map((frame) => frame.action)).toEqual(["resolve", "reply"]);
    expect(context.server.current.frames("chat")).toEqual([
      { t: "chat", action: "send", body: "Hi" },
      { t: "chat", action: "clear" },
    ]);
    context.server.current.drop();
    await expect(context.controller.sendChat("lost")).rejects.toBeInstanceOf(OfflineError);
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
    expect(context.server.current.frames("change")).toEqual([{ t: "change", fileId: "f-main", rev: 4, op: [3, "!"] }]);
    expect(useWeb.getState().connection).toBe("online");
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
});

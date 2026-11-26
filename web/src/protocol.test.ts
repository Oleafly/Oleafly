import { describe, expect, it } from "vitest";
import { parseMe, parseProjectDetail, parseProjects, socketUrl } from "./api";
import { buildTree } from "./components/FileTree";
import { parseFeatures, parseRole, parseServerFrame, presenceFrame } from "./protocol";
import { abilitiesFor, canWithdraw, effectiveMode } from "./roles";

const ALL = { comments: true, suggestions: true, chat: true, reactions: false };

describe("parseServerFrame", () => {
  it("reads hello with roles, features, files, people and compile settings", () => {
    expect(
      parseServerFrame(
        JSON.stringify({
          t: "hello",
          role: "reviewer",
          features: { chat: false },
          files: [
            { fileId: "a", path: "main.tex", kind: "text" },
            { fileId: "b", path: "img.png", kind: "blob", blob: "h1" },
            { fileId: "c", path: "sec", kind: "dir" },
            { path: "no-id.tex" },
          ],
          people: [{ account_id: "u1", display_name: "Ana" }],
          compile: { main_doc: "a", engine: "latex", typst_reproducible: true },
        }),
      ),
    ).toEqual({
      t: "hello",
      role: "reviewer",
      features: { comments: true, suggestions: true, chat: false, reactions: false },
      files: [
        { fileId: "a", path: "main.tex", kind: "text", blob: null },
        { fileId: "b", path: "img.png", kind: "blob", blob: "h1" },
        { fileId: "c", path: "sec", kind: "dir", blob: null },
      ],
      people: [{ accountId: "u1", name: "Ana", avatarUrl: null, login: null }],
      compile: { main_doc: "a", engine: "latex" },
    });
  });

  it("reads compile settings frames and an older hello without them", () => {
    expect(parseServerFrame('{"t":"compile","settings":{"engine":"typst","main_doc":"m"}}')).toEqual({
      t: "compile",
      settings: { engine: "typst", main_doc: "m" },
    });
    expect(parseServerFrame('{"t":"compile","settings":[]}')).toEqual({ t: "compile", settings: {} });
    expect(parseServerFrame('{"t":"hello","role":"viewer","files":[]}')).toMatchObject({ t: "hello", compile: {} });
  });

  it("reads the document frames and drops malformed ones", () => {
    expect(parseServerFrame('{"t":"opened","fileId":"a","rev":3,"text":"x"}')).toEqual({
      t: "opened",
      fileId: "a",
      rev: 3,
      text: "x",
      resumed: null,
    });
    expect(parseServerFrame('{"t":"opened","fileId":"a","rev":0,"text":"x","resumed":true}')).toMatchObject({
      resumed: true,
    });
    expect(parseServerFrame('{"t":"done","reqId":"r1"}')).toEqual({ t: "done", reqId: "r1" });
    expect(parseServerFrame('{"t":"done"}')).toBeNull();
    expect(parseServerFrame('{"t":"error","code":"chat_role","message":"No","reqId":"r2"}')).toEqual({
      t: "error",
      code: "chat_role",
      message: "No",
      reqId: "r2",
    });
    expect(parseServerFrame('{"t":"error","code":"x"}')).toMatchObject({ reqId: null });
    expect(parseServerFrame('{"t":"ack","fileId":"a","rev":4}')).toEqual({ t: "ack", fileId: "a", rev: 4, length: null });
    expect(parseServerFrame('{"t":"remote","fileId":"a","rev":5,"op":[1,"x",-2],"length":7}')).toEqual({
      t: "remote",
      fileId: "a",
      rev: 5,
      op: [1, "x", -2],
      length: 7,
    });
    expect(parseServerFrame('{"t":"remote","fileId":"a","rev":5,"op":[1.5],"length":7}')).toBeNull();
    expect(parseServerFrame('{"t":"reset","fileId":"a","rev":-1,"text":""}')).toBeNull();
    expect(parseServerFrame('{"t":"opened","rev":1,"text":""}')).toBeNull();
    expect(parseServerFrame("[]")).toBeNull();
    expect(parseServerFrame("{")).toBeNull();
  });

  it("reads suggestions, threads, chat and output with the frame's file as fallback", () => {
    expect(
      parseServerFrame(
        JSON.stringify({
          t: "suggestions",
          fileId: "a",
          rev: 2,
          suggestions: [
            { id: "s", kind: "delete", author: "u", createdAt: 9, from: 4, to: 8, text: "gone", threadId: "t", verified: true },
            { id: "bad", kind: "move", from: 0, to: 1 },
          ],
        }),
      ),
    ).toEqual({
      t: "suggestions",
      fileId: "a",
      rev: 2,
      suggestions: [
        { id: "s", fileId: "a", kind: "delete", author: "u", createdAt: 9, from: 4, to: 4, text: "gone", threadId: "t", verified: true },
      ],
    });
    const threads = parseServerFrame(
      JSON.stringify({
        t: "threads",
        fileId: "a",
        rev: null,
        threads: [{ id: "t", anchor: { quote: "q", range: { from: 5, to: 2 } }, resolved: { by: "u", at: 3 } }],
      }),
    );
    expect(threads).toMatchObject({
      t: "threads",
      rev: null,
      threads: [{ id: "t", fileId: "a", anchor: { quote: "q", range: null }, resolved: { by: "u", at: 3, verified: false } }],
    });
    expect(parseServerFrame('{"t":"output","items":[{"kind":"pdf","size":3,"compiledBy":"u","compiledAt":5,"mainFile":"m.tex"},{"kind":"zip"}]}')).toEqual({
      t: "output",
      items: [{ kind: "pdf", size: 3, compiledBy: "u", compiledAt: 5, mainFile: "m.tex" }],
    });
    expect(
      parseServerFrame('{"t":"chat","messages":[{"id":"m","author":"u","at":1,"body":"hi"},{"id":"e","at":2,"body":"fixed","editedAt":3}]}'),
    ).toEqual({
      t: "chat",
      messages: [
        { id: "m", author: "u", at: 1, body: "hi", editedAt: null, deleted: false, verified: false, reactions: [], pending: false, mentions: [] },
        { id: "e", author: "", at: 2, body: "fixed", editedAt: 3, deleted: false, verified: false, reactions: [], pending: false, mentions: [] },
      ],
    });
  });

  it("reads reactions on comments and chat and drops ones that are not emoji with people", () => {
    const reactions = [
      { emoji: "👍", by: ["u1", 7, "u2"] },
      { emoji: "", by: ["u1"] },
      { emoji: 3, by: ["u1"] },
      { emoji: "🎉", by: [] },
      { emoji: "👀" },
      "👍",
    ];
    const threads = parseServerFrame(
      JSON.stringify({
        t: "threads",
        fileId: "a",
        rev: 1,
        threads: [{ id: "t", messages: [{ id: "m1", reactions }, { id: "m2" }] }],
      }),
    );
    expect(threads).toMatchObject({
      threads: [{ messages: [{ id: "m1", reactions: [{ emoji: "👍", by: ["u1", "u2"] }] }, { id: "m2", reactions: [] }] }],
    });
    expect(parseServerFrame(JSON.stringify({ t: "chat", messages: [{ id: "c", reactions }, { id: "d", reactions: "no" }] }))).toMatchObject({
      messages: [{ id: "c", reactions: [{ emoji: "👍", by: ["u1", "u2"] }] }, { id: "d", reactions: [] }],
    });
  });

  it("reads activity, people roles, removed and waiting comments, and encodes presence", () => {
    const presence = parseServerFrame(
      JSON.stringify({
        t: "presence",
        peers: [
          { deviceId: "d1", accountId: "u1", activity: { kind: "reply", threadId: "t1" } },
          { deviceId: "d2", accountId: "u2", activity: { kind: "chat" } },
          { deviceId: "d3", accountId: "u3", activity: { kind: "drawing" } },
          { deviceId: "d4", accountId: "u4" },
        ],
      }),
    );
    expect(presence).toMatchObject({
      peers: [
        { deviceId: "d1", activity: { kind: "reply", threadId: "t1" } },
        { deviceId: "d2", activity: { kind: "chat", threadId: null } },
        { deviceId: "d3", activity: null },
        { deviceId: "d4", activity: null },
      ],
    });
    const seqs = parseServerFrame(
      JSON.stringify({ t: "presence", peers: [{ deviceId: "a", accountId: "u", seq: 7 }, { deviceId: "b", accountId: "v", seq: -1 }] }),
    );
    expect(seqs).toMatchObject({ peers: [{ seq: 7 }, { seq: 0 }] });
    expect(
      parseServerFrame(JSON.stringify({ t: "chat", messages: [{ id: "c", mentions: ["u1", 3, "u2"] }, { id: "d" }] })),
    ).toMatchObject({ messages: [{ mentions: ["u1", "u2"] }, { mentions: [] }] });
    const hello = parseServerFrame(
      JSON.stringify({
        t: "hello",
        members: [
          { accountId: "o", displayName: "Olive", role: "owner" },
          { accountId: "c", displayName: "Cora", role: "commenter" },
          { accountId: "x", displayName: "Xavi", role: "admin" },
        ],
      }),
    );
    expect(hello).toMatchObject({ people: [{ role: "owner" }, { role: "commenter" }, { accountId: "x" }] });
    expect(hello?.t === "hello" && hello.people[2]?.role).toBeUndefined();
    const threads = parseServerFrame(
      JSON.stringify({ t: "threads", fileId: "a", threads: [{ id: "t", messages: [{ id: "m", removed: true, deleted: true, pending: true }] }] }),
    );
    expect(threads).toMatchObject({ threads: [{ messages: [{ removed: true, deleted: true, pending: true }] }] });
    expect(presenceFrame("f", 1, 2)).toEqual({ t: "presence", fileId: "f", anchor: 1, head: 2 });
    expect(presenceFrame(null, null, null, { kind: "chat", threadId: null })).toEqual({
      t: "presence",
      fileId: null,
      anchor: null,
      head: null,
      activity: { kind: "chat", threadId: null },
    });
    expect(presenceFrame("f", 1, 2, null)).toMatchObject({ activity: null });
  });

  it("maps unknown roles to unknown and keeps features on unless turned off", () => {
    expect(parseRole("admin")).toBe("unknown");
    expect(parseRole("commenter")).toBe("commenter");
    expect(parseFeatures(undefined)).toEqual(ALL);
    expect(parseFeatures({ suggestions: false })).toEqual({ ...ALL, suggestions: false });
    expect(parseFeatures({ reactions: true })).toEqual({ ...ALL, reactions: true });
    expect(parseFeatures({ reactions: "yes" })).toEqual(ALL);
  });
});

describe("roles", () => {
  it("follows the role matrix", () => {
    expect(abilitiesFor("owner", ALL)).toEqual({
      edit: true,
      chooseMode: true,
      alwaysSuggest: false,
      comment: true,
      resolve: true,
      chat: true,
      clearChat: true,
      share: true,
    });
    expect(abilitiesFor("editor", ALL)).toMatchObject({
      edit: true,
      chooseMode: true,
      resolve: true,
      clearChat: false,
      share: true,
    });
    expect(abilitiesFor("reviewer", ALL)).toMatchObject({
      edit: true,
      chooseMode: false,
      alwaysSuggest: true,
      comment: true,
      resolve: false,
      chat: true,
      share: false,
    });
    expect(abilitiesFor("commenter", ALL)).toMatchObject({ edit: false, comment: true, resolve: false, chat: true, share: false });
    expect(abilitiesFor("viewer", ALL)).toMatchObject({ edit: false, comment: false, chat: false, share: false });
    expect(abilitiesFor("unknown", ALL)).toMatchObject({ edit: false, comment: false, chat: false, share: false });
  });

  it("turns abilities off with the server features", () => {
    const off = { comments: false, suggestions: false, chat: false, reactions: false };
    expect(abilitiesFor("reviewer", off)).toMatchObject({ edit: false, comment: false, chat: false });
    expect(abilitiesFor("owner", off)).toMatchObject({
      edit: true,
      chooseMode: false,
      resolve: false,
      clearChat: false,
      share: true,
    });
  });

  it("works out the mode each role edits in", () => {
    expect(effectiveMode("reviewer", "editing", ALL)).toBe("suggesting");
    expect(effectiveMode("editor", "suggesting", ALL)).toBe("suggesting");
    expect(effectiveMode("editor", "suggesting", { ...ALL, suggestions: false })).toBe("editing");
    expect(effectiveMode("viewer", "suggesting", ALL)).toBe("editing");
  });

  it("lets only the author withdraw", () => {
    expect(canWithdraw("reviewer", "me", "me")).toBe(true);
    expect(canWithdraw("reviewer", "you", "me")).toBe(false);
    expect(canWithdraw("commenter", "me", "me")).toBe(false);
    expect(canWithdraw("reviewer", "me", null)).toBe(false);
  });
});

describe("web api parsing", () => {
  it("reads the signed-in account in several shapes", () => {
    expect(parseMe({ account: { account_id: "u", display_name: "Ana", email: "a@x" } })).toEqual({
      accountId: "u",
      name: "Ana",
      avatarUrl: null,
      login: null,
      email: "a@x",
    });
    expect(parseMe({ accountId: "u", displayName: "Ana" })?.accountId).toBe("u");
    expect(parseMe({})).toBeNull();
  });

  it("reads project lists and project details", () => {
    expect(
      parseProjects({ projects: [{ project_id: "p", title: "T", role: "viewer", owner: { account_id: "o", display_name: "O" } }] }),
    ).toEqual([{ projectId: "p", title: "T", role: "viewer", owner: { accountId: "o", name: "O", avatarUrl: null, login: null } }]);
    const detail = parseProjectDetail(
      { project: { project_id: "p", title: "T" }, role: "commenter", files: [{ fileId: "a", path: "x.tex", kind: "text" }] },
      "p",
    );
    expect(detail.role).toBe("commenter");
    expect(detail.project.role).toBe("commenter");
    expect(detail.files).toHaveLength(1);
    expect(detail.features).toEqual(ALL);
    expect(parseProjectDetail(null, "p").project.projectId).toBe("p");
  });

  it("builds the socket address on the same origin", () => {
    expect(socketUrl("a b", { protocol: "https:", host: "collab.test" })).toBe("wss://collab.test/web/ws?project=a%20b");
    expect(socketUrl("p", { protocol: "http:", host: "localhost:1430" })).toBe("ws://localhost:1430/web/ws?project=p");
  });
});

describe("buildTree", () => {
  it("nests files under folders with folders first", () => {
    const tree = buildTree([
      { fileId: "1", path: "main.tex", kind: "text", blob: null },
      { fileId: "2", path: "sections/b.tex", kind: "text", blob: null },
      { fileId: "3", path: "sections/a.tex", kind: "text", blob: null },
      { fileId: "4", path: "empty", kind: "dir", blob: null },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["empty", "sections", "main.tex"]);
    expect(tree[1].children.map((node) => node.name)).toEqual(["a.tex", "b.tex"]);
  });
});

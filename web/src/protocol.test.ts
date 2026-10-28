import { describe, expect, it } from "vitest";
import { parseMe, parseProjectDetail, parseProjects, socketUrl } from "./api";
import { buildTree } from "./components/FileTree";
import { parseFeatures, parseRole, parseServerFrame } from "./protocol";
import { abilitiesFor, canWithdraw, effectiveMode } from "./roles";

const ALL = { comments: true, suggestions: true, chat: true };

describe("parseServerFrame", () => {
  it("reads hello with roles, features, files and people", () => {
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
        }),
      ),
    ).toEqual({
      t: "hello",
      role: "reviewer",
      features: { comments: true, suggestions: true, chat: false },
      files: [
        { fileId: "a", path: "main.tex", kind: "text", blob: null },
        { fileId: "b", path: "img.png", kind: "blob", blob: "h1" },
        { fileId: "c", path: "sec", kind: "dir", blob: null },
      ],
      people: [{ accountId: "u1", name: "Ana", avatarUrl: null, login: null }],
    });
  });

  it("reads the document frames and drops malformed ones", () => {
    expect(parseServerFrame('{"t":"opened","fileId":"a","rev":3,"text":"x"}')).toEqual({
      t: "opened",
      fileId: "a",
      rev: 3,
      text: "x",
    });
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
    expect(parseServerFrame('{"t":"chat","messages":[{"id":"m","author":"u","at":1,"body":"hi"}]}')).toEqual({
      t: "chat",
      messages: [{ id: "m", author: "u", at: 1, body: "hi", deleted: false, verified: false }],
    });
  });

  it("maps unknown roles to unknown and keeps features on unless turned off", () => {
    expect(parseRole("admin")).toBe("unknown");
    expect(parseRole("commenter")).toBe("commenter");
    expect(parseFeatures(undefined)).toEqual(ALL);
    expect(parseFeatures({ suggestions: false })).toEqual({ ...ALL, suggestions: false });
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
    });
    expect(abilitiesFor("editor", ALL)).toMatchObject({ edit: true, chooseMode: true, resolve: true, clearChat: false });
    expect(abilitiesFor("reviewer", ALL)).toMatchObject({
      edit: true,
      chooseMode: false,
      alwaysSuggest: true,
      comment: true,
      resolve: false,
      chat: true,
    });
    expect(abilitiesFor("commenter", ALL)).toMatchObject({ edit: false, comment: true, resolve: false, chat: true });
    expect(abilitiesFor("viewer", ALL)).toMatchObject({ edit: false, comment: false, chat: false });
    expect(abilitiesFor("unknown", ALL)).toMatchObject({ edit: false, comment: false, chat: false });
  });

  it("turns abilities off with the server features", () => {
    const off = { comments: false, suggestions: false, chat: false };
    expect(abilitiesFor("reviewer", off)).toMatchObject({ edit: false, comment: false, chat: false });
    expect(abilitiesFor("owner", off)).toMatchObject({ edit: true, chooseMode: false, resolve: false, clearChat: false });
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

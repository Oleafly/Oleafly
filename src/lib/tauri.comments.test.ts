import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CollabCommentMember,
  CollabCommentsChanged,
  CollabCommentsNotSent,
  CollabCommentsStatusChanged,
} from "./tauri";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import * as tauri from "./tauri";

const FILE = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f70";
const THREAD = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f71";
const MESSAGE = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f72";
const members: CollabCommentMember[] = [
  { accountId: "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f73", displayName: "Alice Chen", login: "alice" },
];

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.listen.mockReset().mockResolvedValue(mocks.unlisten);
});

describe("comment IPC contract", () => {
  it.each([
    ["collabCommentsStatus", () => tauri.collabCommentsStatus("p"), "collab_comments_status", { projectId: "p" }],
    [
      "collabCommentsSetEnabled",
      () => tauri.collabCommentsSetEnabled("p", false),
      "collab_comments_set_enabled",
      { projectId: "p", enabled: false },
    ],
    [
      "collabCommentThreadList",
      () => tauri.collabCommentThreadList("p", "chapters/intro.tex"),
      "collab_comment_thread_list",
      { projectId: "p", path: "chapters/intro.tex" },
    ],
    ["collabCommentCounts", () => tauri.collabCommentCounts("p"), "collab_comment_counts", { projectId: "p" }],
    [
      "collabCommentFilePath",
      () => tauri.collabCommentFilePath("p", FILE),
      "collab_comment_file_path",
      { projectId: "p", fileId: FILE },
    ],
    [
      "collabCommentCreate",
      () => tauri.collabCommentCreate("p", "main.tex", 4, 9, 7, "Why?", members),
      "collab_comment_create",
      { projectId: "p", path: "main.tex", from: 4, to: 9, rev: 7, body: "Why?", members },
    ],
    [
      "collabCommentReply",
      () => tauri.collabCommentReply("p", FILE, THREAD, "Because", members),
      "collab_comment_reply",
      { projectId: "p", fileId: FILE, threadId: THREAD, body: "Because", members },
    ],
    [
      "collabCommentEdit",
      () => tauri.collabCommentEdit("p", FILE, THREAD, MESSAGE, "Because of this", members),
      "collab_comment_edit",
      { projectId: "p", fileId: FILE, threadId: THREAD, messageId: MESSAGE, body: "Because of this", members },
    ],
    [
      "collabCommentDelete",
      () => tauri.collabCommentDelete("p", FILE, THREAD, MESSAGE),
      "collab_comment_delete",
      { projectId: "p", fileId: FILE, threadId: THREAD, messageId: MESSAGE },
    ],
    [
      "collabCommentResolve",
      () => tauri.collabCommentResolve("p", FILE, THREAD),
      "collab_comment_resolve",
      { projectId: "p", fileId: FILE, threadId: THREAD },
    ],
    [
      "collabCommentReopen",
      () => tauri.collabCommentReopen("p", FILE, THREAD),
      "collab_comment_reopen",
      { projectId: "p", fileId: FILE, threadId: THREAD },
    ],
    [
      "collabCommentThreadDelete",
      () => tauri.collabCommentThreadDelete("p", FILE, THREAD),
      "collab_comment_thread_delete",
      { projectId: "p", fileId: FILE, threadId: THREAD },
    ],
  ] as const)("sends %s", async (_label, call, command, args) => {
    await call();
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });
});

describe("comment events", () => {
  it("forwards comment changes", async () => {
    const seen: CollabCommentsChanged[] = [];
    const unlisten = await tauri.onCollabCommentsChanged((payload) => seen.push(payload));
    expect(tauri.COLLAB_COMMENTS_CHANGED_EVENT).toBe("collab-comments-changed");
    expect(mocks.listen).toHaveBeenCalledWith("collab-comments-changed", expect.any(Function));
    const payload: CollabCommentsChanged = {
      projectId: "p",
      fileIds: [FILE],
      paths: ["main.tex"],
      mentioned: [{ fileId: FILE, path: "main.tex", threadId: THREAD, messageId: MESSAGE, author: members[0].accountId }],
      local: false,
    };
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: CollabCommentsChanged }) => void;
    handler({ payload });
    expect(seen).toEqual([payload]);
    expect(unlisten).toBe(mocks.unlisten);
  });

  it("forwards comment status changes", async () => {
    const seen: CollabCommentsStatusChanged[] = [];
    await tauri.onCollabCommentsStatus((payload) => seen.push(payload));
    expect(tauri.COLLAB_COMMENTS_STATUS_EVENT).toBe("collab-comments-status");
    const payload: CollabCommentsStatusChanged = {
      projectId: "p",
      status: { serverAllowed: true, projectEnabled: false, canComment: false },
    };
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: CollabCommentsStatusChanged }) => void;
    handler({ payload });
    expect(seen).toEqual([payload]);
  });
});

describe("comments the server would not take", () => {
  it("forwards the comments that were not sent with their text", async () => {
    const seen: CollabCommentsNotSent[] = [];
    await tauri.onCollabCommentsNotSent((payload) => seen.push(payload));
    expect(tauri.COLLAB_COMMENTS_NOT_SENT_EVENT).toBe("collab-comments-not-sent");
    expect(mocks.listen).toHaveBeenCalledWith("collab-comments-not-sent", expect.any(Function));
    const payload: CollabCommentsNotSent = {
      projectId: "p",
      comments: [{ fileId: FILE, path: "main.tex", threadId: THREAD, quote: "quick", body: "written while off" }],
    };
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: CollabCommentsNotSent }) => void;
    handler({ payload });
    expect(seen).toEqual([payload]);
  });
});

describe("comment refusals", () => {
  it("recognises every comment refusal code and nothing else", () => {
    const codes = [
      "comment_not_live",
      "comment_not_yours",
      "comment_off_server",
      "comment_off_project",
      "comment_viewer",
      "comment_someone_replied",
      "comment_message_deleted",
      "comment_selection_changed",
      "comment_too_long",
      "comment_empty",
    ];
    for (const code of codes) expect(tauri.isCollabCommentError({ code, message: "" })).toBe(true);
    expect(tauri.isCollabCommentError({ code: "forbidden", message: "" })).toBe(false);
    expect(tauri.isCollabCommentError({ code: "comment_empty" })).toBe(false);
    expect(tauri.isCollabCommentError("comment_empty")).toBe(false);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("names each refusal the desktop layer can send", () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    const rust = read("../../src-tauri/src/collab/comments.rs");
    const sent = [...rust.matchAll(/=> "(comment_[a-z_]+)"/g)].map((match) => match[1]).sort();
    expect(sent.length).toBeGreaterThan(0);
    for (const code of sent) expect(tauri.isCollabCommentError({ code, message: "" })).toBe(true);
  });
});

describe("comment command drift", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const registered = [...read("../../src-tauri/src/lib.rs").matchAll(/collab::comments::(collab_[a-z_]+)/g)].map(
    (match) => match[1],
  );
  const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

  it("gives every comment command a wrapper and a contract entry", () => {
    expect(registered).toHaveLength(12);
    const wrappers = read("./tauri.ts");
    const contract = read("../../packages/backend-port/src/index.ts");
    for (const name of registered) {
      expect(wrappers).toContain(`"${name}"`);
      expect(contract).toContain(`${camel(name)}:`);
    }
  });
});

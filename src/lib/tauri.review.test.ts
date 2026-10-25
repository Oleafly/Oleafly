import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabChatChanged, CollabCommentMember, CollabSuggestionsChanged } from "./tauri";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import * as tauri from "./tauri-collab";

const members: CollabCommentMember[] = [{ accountId: "a1", displayName: "Alice Chen", login: "alice" }];

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.listen.mockReset().mockResolvedValue(mocks.unlisten);
});

describe("review, chat and history IPC contract", () => {
  it.each([
    ["collabEditModeGet", () => tauri.collabEditModeGet("p"), "collab_edit_mode_get", { projectId: "p" }],
    [
      "collabEditModeSet",
      () => tauri.collabEditModeSet("p", "suggesting"),
      "collab_edit_mode_set",
      { projectId: "p", mode: "suggesting" },
    ],
    [
      "collabSuggestionList",
      () => tauri.collabSuggestionList("p", "main.tex"),
      "collab_suggestion_list",
      { projectId: "p", path: "main.tex" },
    ],
    ["collabSuggestionCounts", () => tauri.collabSuggestionCounts("p"), "collab_suggestion_counts", { projectId: "p" }],
    [
      "collabSuggestionAccept",
      () => tauri.collabSuggestionAccept("p", ["s1", "s2"]),
      "collab_suggestion_accept",
      { projectId: "p", ids: ["s1", "s2"] },
    ],
    [
      "collabSuggestionReject",
      () => tauri.collabSuggestionReject("p", ["s1"]),
      "collab_suggestion_reject",
      { projectId: "p", ids: ["s1"] },
    ],
    [
      "collabSuggestionWithdraw",
      () => tauri.collabSuggestionWithdraw("p", ["s1"]),
      "collab_suggestion_withdraw",
      { projectId: "p", ids: ["s1"] },
    ],
    [
      "collabSuggestionAcceptFile",
      () => tauri.collabSuggestionAcceptFile("p", "main.tex"),
      "collab_suggestion_accept_file",
      { projectId: "p", path: "main.tex" },
    ],
    [
      "collabSuggestionRejectFile",
      () => tauri.collabSuggestionRejectFile("p", "main.tex"),
      "collab_suggestion_reject_file",
      { projectId: "p", path: "main.tex" },
    ],
    [
      "collabSuggestionReply",
      () => tauri.collabSuggestionReply("p", "s1", "Why?", members),
      "collab_suggestion_reply",
      { projectId: "p", id: "s1", body: "Why?", members },
    ],
    [
      "collabChatList",
      () => tauri.collabChatList("p", "c1", 50),
      "collab_chat_list",
      { projectId: "p", before: "c1", limit: 50 },
    ],
    ["collabChatSend", () => tauri.collabChatSend("p", "Hi"), "collab_chat_send", { projectId: "p", body: "Hi" }],
    ["collabChatDelete", () => tauri.collabChatDelete("p", "c1"), "collab_chat_delete", { projectId: "p", id: "c1" }],
    ["collabChatClear", () => tauri.collabChatClear("p"), "collab_chat_clear", { projectId: "p" }],
    [
      "collabHistoryList",
      () => tauri.collabHistoryList("p", null, 50),
      "collab_history_list",
      { projectId: "p", before: null, limit: 50 },
    ],
    [
      "collabHistoryFile",
      () => tauri.collabHistoryFile("p", "v1", "main.tex"),
      "collab_history_file",
      { projectId: "p", versionId: "v1", path: "main.tex" },
    ],
    [
      "collabHistoryChangedFiles",
      () => tauri.collabHistoryChangedFiles("p", "v1", "v2"),
      "collab_history_changed_files",
      { projectId: "p", fromVersion: "v1", toVersion: "v2" },
    ],
    [
      "collabHistoryRestore",
      () => tauri.collabHistoryRestore("p", "v1", null),
      "collab_history_restore",
      { projectId: "p", versionId: "v1", paths: null },
    ],
    [
      "collabVersionName",
      () => tauri.collabVersionName("p", "v1", "Sent"),
      "collab_version_name",
      { projectId: "p", versionId: "v1", name: "Sent" },
    ],
    [
      "collabVersionUnname",
      () => tauri.collabVersionUnname("p", "v1"),
      "collab_version_unname",
      { projectId: "p", versionId: "v1" },
    ],
    ["collabOutputInfo", () => tauri.collabOutputInfo("p"), "collab_output_info", { projectId: "p" }],
  ] as const)("sends %s", async (_label, call, command, args) => {
    await call();
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });

  it("treats the new refusal codes as collaboration errors", () => {
    for (const code of [
      "suggestion_not_found",
      "suggestion_not_yours",
      "suggestion_role",
      "chat_role",
      "history_unavailable",
      "account_storage_full",
      "too_many_projects",
      "too_many_uploads",
    ]) {
      expect(tauri.isCollabCommandError({ code, message: "" })).toBe(true);
    }
  });
});

describe("review and chat events", () => {
  it("forwards suggestion changes", async () => {
    const seen: CollabSuggestionsChanged[] = [];
    const unlisten = await tauri.onCollabSuggestionsChanged((payload) => seen.push(payload));
    expect(mocks.listen).toHaveBeenCalledWith("collab://suggestions-changed", expect.any(Function));
    const payload: CollabSuggestionsChanged = { projectId: "p", paths: ["main.tex"], local: true };
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: CollabSuggestionsChanged }) => void;
    handler({ payload });
    expect(seen).toEqual([payload]);
    expect(unlisten).toBe(mocks.unlisten);
  });

  it("forwards chat changes", async () => {
    const seen: CollabChatChanged[] = [];
    await tauri.onCollabChatChanged((payload) => seen.push(payload));
    expect(mocks.listen).toHaveBeenCalledWith("collab://chat-changed", expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: CollabChatChanged }) => void;
    handler({ payload: { projectId: "p", local: false } });
    expect(seen).toEqual([{ projectId: "p", local: false }]);
  });
});

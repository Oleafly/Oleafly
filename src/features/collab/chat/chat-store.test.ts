// @vitest-environment jsdom

import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatRail } from "@/components/collab/chat-rail";
import type { CollabChatMessage, CollabLiveSyncState, CollabProjectRole } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, collabError, deferred, projectMember, shareInfo } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabChatList: vi.fn(),
  collabChatSend: vi.fn(),
  collabChatDelete: vi.fn(),
  collabChatClear: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabChatList: mocks.collabChatList,
  collabChatSend: mocks.collabChatSend,
  collabChatDelete: mocks.collabChatDelete,
  collabChatClear: mocks.collabChatClear,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

import { CHAT_PAGE, clearChat, deleteChat, loadChat, loadOlderChat, sendChat, startChat, useChat } from "./chat-store";

const AT = 1_760_000_000_000;

function message(id: string, body: string, at = AT, author = BOB_ID): CollabChatMessage {
  return { id, author, at, body, deleted: false, verified: true };
}

const hello = message("c1", "Draft is ready");
const reply = message("c2", "Reading it now", AT + 60_000, ALICE_ID);
const elsewhere = message("o1", "Thesis notes");
const fullPage = Array.from({ length: CHAT_PAGE }, (_, index) => message(`p${index}`, `Message ${index}`, AT + index * 1_000));

let stop: (() => void) | null = null;

function share(
  projectId: string,
  role: CollabProjectRole | null = "editor",
  status: CollabLiveSyncState | null = { state: "online" },
) {
  useCollabLiveStore.setState({
    projectId,
    role,
    status,
    members: [],
    share: shareInfo({ project_id: projectId, role: role ?? "editor", account_id: ALICE_ID }),
  });
}

function emit(projectId: string, local = false) {
  mocks.listeners.get("collab://chat-changed")?.({ payload: { projectId, local } });
}

async function begin(projectId = "paper") {
  share(projectId);
  stop = startChat();
  await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
}

function ids(): string[] {
  return useChat.getState().messages.map((entry) => entry.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.collabChatList.mockResolvedValue([reply, hello]);
  mocks.collabChatDelete.mockResolvedValue(undefined);
  mocks.collabChatClear.mockResolvedValue(undefined);
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useChatRail.setState({ visible: false, unread: false });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  useCollabLiveStore.setState({ projectId: null, role: null, status: null, share: null, members: [] });
});

describe("chat without a shared project", () => {
  it("asks the server for nothing and refuses to post, delete or clear", async () => {
    await loadChat();
    await loadOlderChat();
    expect(mocks.collabChatList).not.toHaveBeenCalled();
    await expect(sendChat("Hello")).rejects.toThrow("This project is not shared.");
    await expect(deleteChat("c1")).rejects.toThrow("This project is not shared.");
    await expect(clearChat()).rejects.toThrow("This project is not shared.");
    expect(mocks.collabChatSend).not.toHaveBeenCalled();
    expect(mocks.collabChatDelete).not.toHaveBeenCalled();
    expect(mocks.collabChatClear).not.toHaveBeenCalled();
  });
});

describe("loading the chat", () => {
  it("treats a chat the server has no record of as an empty one", async () => {
    mocks.collabChatList.mockRejectedValueOnce(collabError("not_found"));
    await begin();
    expect(useChat.getState()).toMatchObject({ messages: [], phase: "ready", error: null, hasOlder: false });
  });

  it("keeps the reason when the chat can't load, then loads it on a retry", async () => {
    mocks.collabChatList.mockRejectedValueOnce(collabError("unreachable"));
    share("paper");
    stop = startChat();
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("failed"));
    expect(useChat.getState().error).toBe("unreachable");

    const retry = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockReturnValueOnce(retry.promise);
    const loading = loadChat();
    expect(useChat.getState()).toMatchObject({ phase: "loading", error: null });
    retry.resolve([reply, hello]);
    await loading;
    expect(useChat.getState()).toMatchObject({ phase: "ready", error: null, hasOlder: false });
    expect(ids()).toEqual(["c1", "c2"]);
  });

  it("keeps showing the messages during a reload and keeps the same list when nothing changed", async () => {
    await begin();
    const shown = useChat.getState().messages;
    const reload = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockReturnValueOnce(reload.promise);
    const loading = loadChat();
    expect(useChat.getState().phase).toBe("ready");
    reload.resolve([hello, reply]);
    await loading;
    expect(useChat.getState().messages).toBe(shown);
  });
});

describe("replies that arrive after the chat moved on", () => {
  it("drops a page for the project the chat has left", async () => {
    const slow = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([elsewhere]);
    share("paper");
    stop = startChat();
    share("thesis");
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    slow.resolve([hello]);
    await slow.promise;
    expect(useChat.getState().projectId).toBe("thesis");
    expect(ids()).toEqual(["o1"]);
    expect(mocks.collabChatList).toHaveBeenLastCalledWith("thesis", null, CHAT_PAGE);
  });

  it("drops a failure for the project the chat has left", async () => {
    const slow = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([elsewhere]);
    share("paper");
    stop = startChat();
    share("thesis");
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    slow.reject(collabError("unreachable"));
    await slow.promise.catch(() => undefined);
    expect(useChat.getState()).toMatchObject({ projectId: "thesis", phase: "ready", error: null });
    expect(ids()).toEqual(["o1"]);
  });

  it("drops older messages that arrive after switching projects", async () => {
    mocks.collabChatList.mockResolvedValueOnce(fullPage);
    await begin();
    expect(useChat.getState().hasOlder).toBe(true);
    const older = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockReturnValueOnce(older.promise).mockResolvedValueOnce([elsewhere]);
    const loading = loadOlderChat();
    expect(useChat.getState().loadingOlder).toBe(true);
    share("thesis");
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    older.resolve([message("old", "First ever", AT - 5_000)]);
    await loading;
    expect(ids()).toEqual(["o1"]);
    expect(useChat.getState()).toMatchObject({ projectId: "thesis", loadingOlder: false, hasOlder: false });
  });

  it("drops a sent message, a deletion and a clear that finish after switching projects", async () => {
    mocks.collabChatList.mockResolvedValueOnce([hello]).mockResolvedValue([elsewhere]);
    await begin();
    const sent = deferred<CollabChatMessage>();
    const removed = deferred<void>();
    const cleared = deferred<void>();
    mocks.collabChatSend.mockReturnValueOnce(sent.promise);
    mocks.collabChatDelete.mockReturnValueOnce(removed.promise);
    mocks.collabChatClear.mockReturnValueOnce(cleared.promise);
    const work = Promise.all([sendChat("Late reply"), deleteChat("c1"), clearChat()]);
    share("thesis");
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    sent.resolve(message("c9", "Late reply"));
    removed.resolve();
    cleared.resolve();
    await work;
    expect(mocks.collabChatSend).toHaveBeenCalledWith("paper", "Late reply");
    expect(mocks.collabChatDelete).toHaveBeenCalledWith("paper", "c1");
    expect(mocks.collabChatClear).toHaveBeenCalledWith("paper");
    expect(useChat.getState().messages).toEqual([elsewhere]);
  });
});

describe("older messages", () => {
  it("asks for one older page at a time and stops at the first message", async () => {
    mocks.collabChatList.mockResolvedValueOnce(fullPage);
    await begin();
    const older = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockReturnValueOnce(older.promise);
    const first = loadOlderChat();
    await loadOlderChat();
    expect(mocks.collabChatList).toHaveBeenCalledTimes(2);
    expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", "p0", CHAT_PAGE);
    older.resolve([message("old", "First ever", AT - 5_000)]);
    await first;
    expect(useChat.getState()).toMatchObject({ hasOlder: false, loadingOlder: false });
    expect(ids()[0]).toBe("old");
    await loadOlderChat();
    expect(mocks.collabChatList).toHaveBeenCalledTimes(2);
  });

  it("passes on a failed older page and lets it be tried again", async () => {
    mocks.collabChatList.mockResolvedValueOnce(fullPage);
    await begin();
    mocks.collabChatList.mockRejectedValueOnce(collabError("unreachable"));
    await expect(loadOlderChat()).rejects.toMatchObject({ code: "unreachable" });
    expect(useChat.getState()).toMatchObject({ loadingOlder: false, hasOlder: true });
    mocks.collabChatList.mockResolvedValueOnce([message("old", "First ever", AT - 5_000)]);
    await loadOlderChat();
    expect(ids()[0]).toBe("old");
    expect(ids()).toHaveLength(CHAT_PAGE + 1);
  });

  it("keeps the older pages and the way back to them when a new message arrives", async () => {
    mocks.collabChatList.mockResolvedValueOnce(fullPage);
    await begin();
    const olderPage = Array.from({ length: CHAT_PAGE }, (_, index) =>
      message(`o${index}`, `Older ${index}`, AT - (CHAT_PAGE - index) * 1_000),
    );
    mocks.collabChatList.mockResolvedValueOnce(olderPage);
    await loadOlderChat();
    expect(ids()).toHaveLength(2 * CHAT_PAGE);
    const latest = message("new", "Just sent", AT + CHAT_PAGE * 1_000);
    mocks.collabChatList.mockResolvedValueOnce([...fullPage.slice(1), latest]);
    await loadChat();
    expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", null, CHAT_PAGE);
    expect(ids()).toHaveLength(2 * CHAT_PAGE + 1);
    expect(ids()[0]).toBe("o0");
    expect(ids().at(-1)).toBe("new");
    expect(useChat.getState().hasOlder).toBe(true);
  });

  it("starts over from the newest page when it no longer meets the loaded messages", async () => {
    await begin();
    const later = Array.from({ length: CHAT_PAGE }, (_, index) => message(`n${index}`, `Later ${index}`, AT + (index + 1) * 120_000));
    mocks.collabChatList.mockResolvedValueOnce(later);
    await loadChat();
    expect(ids()).toEqual(later.map((entry) => entry.id));
    expect(useChat.getState().hasOlder).toBe(true);
  });
});

describe("following the live project", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("waits for a burst of changes to settle, then reloads once", async () => {
    await begin();
    mocks.collabChatList.mockClear();
    emit("paper");
    await vi.advanceTimersByTimeAsync(100);
    emit("paper");
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.collabChatList).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.collabChatList).toHaveBeenCalledTimes(1);
  });

  it("ignores changes in another project", async () => {
    await begin();
    mocks.collabChatList.mockClear();
    emit("thesis");
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.collabChatList).not.toHaveBeenCalled();
    expect(useChatRail.getState().unread).toBe(false);
  });

  it("marks the rail only for someone else's message while the chat is out of view", async () => {
    await begin();
    emit("paper", true);
    expect(useChatRail.getState().unread).toBe(false);
    useSettingsStore.setState({ railTab: "chat", showTree: true });
    emit("paper");
    expect(useChatRail.getState().unread).toBe(false);
    useSettingsStore.setState({ showTree: false });
    emit("paper");
    expect(useChatRail.getState().unread).toBe(true);
  });

  it("clears the unread mark only once the chat is actually in view", async () => {
    await begin();
    emit("paper");
    expect(useChatRail.getState().unread).toBe(true);
    useSettingsStore.setState({ editorFontSize: 15 });
    expect(useChatRail.getState().unread).toBe(true);
    useSettingsStore.setState({ railTab: "chat", showTree: false });
    expect(useChatRail.getState().unread).toBe(true);
    useSettingsStore.setState({ showTree: true });
    expect(useChatRail.getState().unread).toBe(false);
    useSettingsStore.setState({ editorFontSize: 13 });
  });

  it("hides the chat and drops a pending reload when the project stops being shared", async () => {
    await begin();
    emit("paper");
    mocks.collabChatList.mockClear();
    useCollabLiveStore.setState({ share: null });
    expect(useChatRail.getState()).toMatchObject({ visible: false, unread: false });
    expect(useChat.getState()).toMatchObject({ projectId: null, messages: [], phase: "idle" });
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.collabChatList).not.toHaveBeenCalled();
  });

  it("keeps the chat as it is when the share details change but the project doesn't", async () => {
    await begin();
    const shown = useChat.getState().messages;
    mocks.collabChatList.mockClear();
    useCollabLiveStore.setState({
      share: shareInfo({ project_id: "paper", role: "editor", account_id: ALICE_ID, server_name: "Renamed Lab" }),
    });
    expect(useChat.getState().messages).toBe(shown);
    expect(useChatRail.getState().visible).toBe(true);
    expect(mocks.collabChatList).not.toHaveBeenCalled();
  });

  it("waits for a role before loading, and stops reloading once the role is gone", async () => {
    share("paper", null);
    stop = startChat();
    expect(useChatRail.getState().visible).toBe(true);
    expect(useChat.getState()).toMatchObject({ projectId: "paper", phase: "idle" });
    expect(mocks.collabChatList).not.toHaveBeenCalled();
    useCollabLiveStore.setState({ role: "viewer" });
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    expect(mocks.collabChatList).toHaveBeenCalledWith("paper", null, CHAT_PAGE);
    useCollabLiveStore.setState({ role: null });
    expect(mocks.collabChatList).toHaveBeenCalledTimes(1);
  });

  it("reloads when the project comes back online, not on other live changes", async () => {
    await begin();
    mocks.collabChatList.mockClear();
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } });
    useCollabLiveStore.setState({ members: [projectMember(BOB, "owner")] });
    expect(mocks.collabChatList).not.toHaveBeenCalled();
    useCollabLiveStore.setState({ status: { state: "online" } });
    await vi.waitFor(() => expect(mocks.collabChatList).toHaveBeenCalledTimes(1));
    useCollabLiveStore.setState({ status: { state: "online" } });
    expect(mocks.collabChatList).toHaveBeenCalledTimes(1);
  });

  it("still loads the chat when updates can't be listened for", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("no event bridge"));
    await begin();
    expect(ids()).toEqual(["c1", "c2"]);
    stop?.();
    stop = null;
    await vi.advanceTimersByTimeAsync(0);
    expect(useChatRail.getState()).toMatchObject({ visible: false, unread: false });
    expect(useChat.getState().projectId).toBeNull();
  });
});

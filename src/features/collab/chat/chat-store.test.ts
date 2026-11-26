// @vitest-environment jsdom

import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openChatMessage, useChatRail } from "@/components/collab/chat-rail";
import type { CollabChatMessage, CollabLiveSyncState, CollabProjectRole } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabActivity } from "../sharing/activity-store";
import { CHAT_AT as AT, chatMessage, chatStatus } from "../tests/chat-fixtures";
import {
  collabError,
  deferred,
  LIVE_SEEDS,
  liveReset,
  OVERLEAF_SEED,
  overleafLink,
  projectMember,
  SERVER_SEED,
  shareInfo,
} from "../tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabChatList: vi.fn(),
  collabChatSend: vi.fn(),
  collabChatEdit: vi.fn(),
  collabChatDelete: vi.fn(),
  collabChatClear: vi.fn(),
  collabChatStatus: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabChatList: mocks.collabChatList,
  collabChatSend: mocks.collabChatSend,
  collabChatEdit: mocks.collabChatEdit,
  collabChatDelete: mocks.collabChatDelete,
  collabChatClear: mocks.collabChatClear,
  collabChatStatus: mocks.collabChatStatus,
}));

const logs = vi.hoisted(() => ({ logError: vi.fn(async () => undefined), logWarning: vi.fn(async () => undefined) }));

vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: logs.logError,
  logWarning: logs.logWarning,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

import {
  CHAT_PAGE,
  clearChat,
  deleteChat,
  editChat,
  loadChat,
  loadOlderChat,
  sendChat,
  startChat,
  useChat,
} from "./chat-store";

let stop: (() => void) | null = null;

function emit(projectId: string, local = false) {
  mocks.listeners.get("collab://chat-changed")?.({ payload: { projectId, local } });
}

function ids(): string[] {
  return useChat.getState().messages.map((entry) => entry.id);
}

function serverList(list: readonly CollabChatMessage[], answers = Number.POSITIVE_INFINITY) {
  let asked = 0;
  mocks.collabChatList.mockImplementation(async (_project: string, before: string | null, limit: number) => {
    asked += 1;
    if (asked > answers) return [];
    const found = before === null ? -1 : list.findIndex((entry) => entry.id === before);
    const end = found < 0 ? list.length : found;
    return list.slice(Math.max(0, end - limit), end);
  });
}

beforeEach(() => {
  for (const mock of [
    mocks.collabChatList,
    mocks.collabChatSend,
    mocks.collabChatEdit,
    mocks.collabChatDelete,
    mocks.collabChatClear,
    mocks.collabChatStatus,
    vi.mocked(listen),
  ]) {
    mock.mockReset();
  }
  mocks.listeners.clear();
  logs.logError.mockClear();
  logs.logWarning.mockClear();
  mocks.collabChatDelete.mockResolvedValue(undefined);
  mocks.collabChatClear.mockResolvedValue(undefined);
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useChatRail.setState({ visible: false, unread: false, reveal: null });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  useCollabLiveStore.setState(liveReset());
});

describe("chat without a live project", () => {
  it("asks the backend for nothing and refuses to post, edit, delete or clear", async () => {
    await loadChat();
    await loadOlderChat();
    expect(mocks.collabChatList).not.toHaveBeenCalled();
    await expect(sendChat("Hello")).rejects.toThrow("This project is not shared.");
    await expect(editChat("c1", "Hello")).rejects.toThrow("This project is not shared.");
    await expect(deleteChat("c1")).rejects.toThrow("This project is not shared.");
    await expect(clearChat()).rejects.toThrow("This project is not shared.");
    expect(mocks.collabChatSend).not.toHaveBeenCalled();
    expect(mocks.collabChatEdit).not.toHaveBeenCalled();
    expect(mocks.collabChatDelete).not.toHaveBeenCalled();
    expect(mocks.collabChatClear).not.toHaveBeenCalled();
  });
});

describe.each(LIVE_SEEDS)("chat on the $name backend", (seed) => {
  const ALICE = seed.alice.account_id;
  const BOB = seed.bob.account_id;
  const message = (id: string, body: string, at = AT, author = BOB, overrides: Partial<CollabChatMessage> = {}) =>
    chatMessage(id, author, body, at, overrides);
  const hello = message("c1", "Draft is ready");
  const reply = message("c2", "Reading it now", AT + 60_000, ALICE);
  const elsewhere = message("o1", "Thesis notes");
  const fullPage = Array.from({ length: CHAT_PAGE }, (_, index) => message(`p${index}`, `Message ${index}`, AT + index * 1_000));

  function share(
    projectId: string,
    role: CollabProjectRole | null = "editor",
    status: CollabLiveSyncState | null = { state: "online" },
  ) {
    useCollabLiveStore.setState({ ...seed.live(projectId, role ?? "editor"), role, status, members: [] });
  }

  async function begin(projectId = "paper") {
    share(projectId);
    stop = startChat();
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
  }

  beforeEach(() => {
    mocks.collabChatList.mockResolvedValue([hello, reply]);
    mocks.collabChatStatus.mockResolvedValue(chatStatus(seed));
  });

  describe("loading the chat", () => {
    it("asks for the chat's status first, then shows the rail tab and the newest page", async () => {
      await begin();
      expect(mocks.collabChatStatus).toHaveBeenCalledWith("paper");
      expect(mocks.collabChatList).toHaveBeenCalledWith("paper", null, CHAT_PAGE);
      expect(useChat.getState().status).toEqual(chatStatus(seed));
      expect(useChatRail.getState().visible).toBe(true);
      expect(ids()).toEqual(["c1", "c2"]);
    });

    it("keeps the chat hidden and asks for no messages where the backend has no chat", async () => {
      vi.useFakeTimers();
      mocks.collabChatStatus.mockResolvedValue(chatStatus(seed, { available: false, post: false }));
      share("paper");
      stop = startChat();
      await vi.waitFor(() => expect(useChat.getState().status?.available).toBe(false));
      emit("paper");
      await vi.advanceTimersByTimeAsync(500);
      await loadChat();
      expect(useChatRail.getState().visible).toBe(false);
      expect(mocks.collabChatList).not.toHaveBeenCalled();
      expect(useChat.getState().phase).toBe("idle");
    });

    it("reads the status again when a chat change arrives while the chat is off, and loads it once the server has it", async () => {
      mocks.collabChatStatus.mockResolvedValueOnce(chatStatus(seed, { available: false, post: false }));
      share("paper");
      stop = startChat();
      await vi.waitFor(() => expect(useChat.getState().status?.available).toBe(false));
      expect(mocks.collabChatList).not.toHaveBeenCalled();
      emit("paper");
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      expect(mocks.collabChatStatus).toHaveBeenCalledTimes(2);
      expect(useChatRail.getState().visible).toBe(true);
      expect(ids()).toEqual(["c1", "c2"]);
    });

    it("drops the messages when the chat goes away and loads them again when it comes back", async () => {
      await begin();
      mocks.collabChatStatus.mockResolvedValueOnce(chatStatus(seed, { available: false, post: false }));
      mocks.listeners.get("collab-comments-status")?.({ payload: { projectId: "paper", status: {} } });
      await vi.waitFor(() => expect(useChatRail.getState().visible).toBe(false));
      expect(useChat.getState()).toMatchObject({ projectId: "paper", messages: [], phase: "idle" });
      mocks.collabChatList.mockClear();
      mocks.listeners.get("collab-comments-status")?.({ payload: { projectId: "paper", status: {} } });
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      expect(useChatRail.getState().visible).toBe(true);
      expect(mocks.collabChatList).toHaveBeenCalledTimes(1);
      expect(ids()).toEqual(["c1", "c2"]);
    });

    it("reads the status again when the project's switches change, and keeps the same status when nothing did", async () => {
      await begin();
      const shown = useChat.getState().status;
      mocks.listeners.get("collab-comments-status")?.({ payload: { projectId: "elsewhere", status: {} } });
      mocks.listeners.get("collab-comments-status")?.({ payload: { projectId: "paper", status: {} } });
      await vi.waitFor(() => expect(mocks.collabChatStatus).toHaveBeenCalledTimes(2));
      expect(useChat.getState().status).toBe(shown);
      mocks.collabChatStatus.mockResolvedValueOnce(chatStatus(seed, { reactions: false, clear: false }));
      mocks.listeners.get("collab-comments-status")?.({ payload: { projectId: "paper", status: {} } });
      await vi.waitFor(() => expect(useChat.getState().status).toMatchObject({ reactions: false, clear: false }));
    });

    it("keeps the chat hidden when its status can't be read, and logs why", async () => {
      mocks.collabChatStatus.mockRejectedValueOnce(collabError("internal"));
      share("paper");
      stop = startChat();
      await vi.waitFor(() => expect(logs.logError).toHaveBeenCalledWith("collab chat status", expect.anything()));
      expect(useChatRail.getState().visible).toBe(false);
      expect(mocks.collabChatList).not.toHaveBeenCalled();
    });

    it("treats a chat the backend has no record of as an empty one", async () => {
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
      retry.resolve([hello, reply]);
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
      await vi.waitFor(() => expect(mocks.collabChatList).toHaveBeenCalledTimes(1));
      share("thesis");
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      slow.resolve([hello]);
      await slow.promise;
      expect(useChat.getState().projectId).toBe("thesis");
      expect(ids()).toEqual(["o1"]);
      expect(mocks.collabChatList).toHaveBeenLastCalledWith("thesis", null, CHAT_PAGE);
    });

    it("drops a status for the project the chat has left", async () => {
      const slow = deferred<ReturnType<typeof chatStatus>>();
      mocks.collabChatStatus.mockReturnValueOnce(slow.promise);
      mocks.collabChatList.mockResolvedValue([elsewhere]);
      share("paper");
      stop = startChat();
      share("thesis");
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      slow.resolve(chatStatus(seed, { available: false, post: false }));
      await slow.promise;
      expect(useChat.getState()).toMatchObject({ projectId: "thesis", status: chatStatus(seed) });
      expect(useChatRail.getState().visible).toBe(true);
    });

    it("drops a failure for the project the chat has left", async () => {
      const slow = deferred<CollabChatMessage[]>();
      mocks.collabChatList.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([elsewhere]);
      share("paper");
      stop = startChat();
      await vi.waitFor(() => expect(mocks.collabChatList).toHaveBeenCalledTimes(1));
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

    it("drops a failed older page for the project the chat has left", async () => {
      mocks.collabChatList.mockResolvedValueOnce(fullPage);
      await begin();
      const older = deferred<CollabChatMessage[]>();
      mocks.collabChatList.mockReturnValueOnce(older.promise).mockResolvedValueOnce([elsewhere]);
      const loading = loadOlderChat();
      share("thesis");
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      older.reject(collabError("unreachable"));
      await expect(loading).resolves.toBeUndefined();
      expect(ids()).toEqual(["o1"]);
    });

    it("drops a sent message, an edit, a deletion and a clear that finish after switching projects", async () => {
      mocks.collabChatList.mockResolvedValueOnce([hello]).mockResolvedValue([elsewhere]);
      await begin();
      const sent = deferred<CollabChatMessage>();
      const edited = deferred<CollabChatMessage>();
      const removed = deferred<void>();
      const cleared = deferred<void>();
      mocks.collabChatSend.mockReturnValueOnce(sent.promise);
      mocks.collabChatEdit.mockReturnValueOnce(edited.promise);
      mocks.collabChatDelete.mockReturnValueOnce(removed.promise);
      mocks.collabChatClear.mockReturnValueOnce(cleared.promise);
      const work = Promise.all([sendChat("Late reply"), editChat("c1", "Later"), deleteChat("c1"), clearChat()]);
      share("thesis");
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      const listed = mocks.collabChatList.mock.calls.length;
      sent.resolve(message("c9", "Late reply"));
      edited.resolve(message("c1", "Later"));
      removed.resolve();
      cleared.resolve();
      await work;
      expect(mocks.collabChatSend).toHaveBeenCalledWith("paper", "Late reply", []);
      expect(mocks.collabChatEdit).toHaveBeenCalledWith("paper", "c1", "Later", []);
      expect(mocks.collabChatDelete).toHaveBeenCalledWith("paper", "c1");
      expect(mocks.collabChatClear).toHaveBeenCalledWith("paper");
      expect(mocks.collabChatList).toHaveBeenCalledTimes(listed);
      expect(useChat.getState().messages).toEqual([elsewhere]);
    });
  });

  describe("writing", () => {
    it("shows an edit with the time it was made", async () => {
      await begin();
      useCollabLiveStore.setState({ members: [projectMember(seed.bob, "editor")] });
      const edited = message("c2", "Reading it again", AT + 60_000, ALICE, { editedAt: AT + 90_000 });
      mocks.collabChatEdit.mockResolvedValue(edited);
      await editChat("c2", "Reading it again");
      expect(mocks.collabChatEdit).toHaveBeenCalledWith("paper", "c2", "Reading it again", [
        expect.objectContaining({ accountId: BOB, displayName: "Bob Smith" }),
      ]);
      expect(useChat.getState().messages.find((entry) => entry.id === "c2")).toEqual(edited);
    });

    it("passes on a refused edit and keeps the message as it was", async () => {
      await begin();
      mocks.collabChatEdit.mockRejectedValue(collabError("chat_edit_off"));
      await expect(editChat("c2", "Reading it again")).rejects.toMatchObject({ code: "chat_edit_off" });
      expect(useChat.getState().messages.find((entry) => entry.id === "c2")?.body).toBe("Reading it now");
    });

    it("takes your deletion from the backend's list", async () => {
      await begin();
      const kept = seed.name === "server" ? [hello, { ...reply, body: "", deleted: true }] : [hello];
      mocks.collabChatList.mockResolvedValue(kept);
      await deleteChat("c2");
      expect(useChat.getState().messages).toEqual(kept);
    });

    it("still marks your deletion when the list can't be read afterwards", async () => {
      await begin();
      mocks.collabChatList.mockRejectedValue(collabError("unreachable"));
      await deleteChat("c2");
      expect(useChat.getState().messages.find((entry) => entry.id === "c2")).toMatchObject({ body: "", deleted: true });
    });

    it("sends the members with a message so the backend can resolve its mentions", async () => {
      await begin();
      useCollabLiveStore.setState({ members: [projectMember(seed.bob, "editor")] });
      mocks.collabChatSend.mockResolvedValue(message("c9", "Hi @Bob Smith"));
      await sendChat("Hi @Bob Smith");
      expect(mocks.collabChatSend).toHaveBeenCalledWith("paper", "Hi @Bob Smith", [
        expect.objectContaining({ accountId: BOB, displayName: "Bob Smith" }),
      ]);
    });

    it("leaves invited people and people who left out of the mention list", async () => {
      await begin();
      useCollabLiveStore.setState({
        members: [
          projectMember(seed.bob, "editor"),
          { ...projectMember(seed.carol, "viewer"), standing: "invited" },
          { ...projectMember(seed.alice, "editor"), standing: "former" },
        ],
      });
      mocks.collabChatSend.mockResolvedValue(message("c9", "Hi"));
      await sendChat("Hi");
      expect(mocks.collabChatSend).toHaveBeenCalledWith("paper", "Hi", [expect.objectContaining({ accountId: BOB })]);
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

    it("reloads instead of failing when the backend no longer knows the oldest message shown", async () => {
      mocks.collabChatList.mockResolvedValueOnce(fullPage);
      await begin();
      mocks.collabChatList.mockRejectedValueOnce(collabError("not_found")).mockResolvedValueOnce(fullPage.slice(1));
      await expect(loadOlderChat()).resolves.toBeUndefined();
      expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", null, 2 * CHAT_PAGE);
      expect(logs.logError).not.toHaveBeenCalled();
      expect(useChat.getState()).toMatchObject({ loadingOlder: false, cursor: "p1" });
      expect(ids()[0]).toBe("p1");
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
      serverList([message("first", "First ever", AT - 3_600_000), ...olderPage, ...fullPage, latest]);
      await loadChat();
      expect(mocks.collabChatList).toHaveBeenCalledWith("paper", null, 3 * CHAT_PAGE);
      expect(ids()).toHaveLength(2 * CHAT_PAGE + 1);
      expect(ids()[0]).toBe("o0");
      expect(ids().at(-1)).toBe("new");
      expect(useChat.getState().hasOlder).toBe(true);
    });

    it("shows a reaction, a deletion and a clear on messages in the older pages someone has opened", async () => {
      const list = Array.from({ length: 3 * CHAT_PAGE }, (_, index) => message(`m${index}`, `Message ${index}`, AT + index * 1_000));
      serverList(list);
      await begin();
      await loadOlderChat();
      expect(ids()).toHaveLength(2 * CHAT_PAGE);
      const oldest = ids()[0];
      const changed = list.map((entry, index) => {
        if (entry.id === oldest) return { ...entry, reactions: [{ emoji: "👍", by: [BOB] }] };
        if (index === CHAT_PAGE + 3) return { ...entry, body: "", deleted: true };
        return entry;
      });
      serverList([...changed, message("late", "Just sent", AT + 10_000_000)]);
      await loadChat();
      const shown = useChat.getState().messages;
      expect(shown).toHaveLength(2 * CHAT_PAGE + 1);
      expect(shown[0].reactions).toEqual([{ emoji: "👍", by: [BOB] }]);
      expect(shown.find((entry) => entry.id === `m${CHAT_PAGE + 3}`)?.deleted).toBe(true);
      serverList(changed.map((entry) => ({ ...entry, body: "", deleted: true })));
      await loadChat();
      expect(useChat.getState().messages.filter((entry) => entry.id !== "late").every((entry) => entry.deleted)).toBe(true);
      expect(useChat.getState()).toMatchObject({ hasOlder: true, cursor: oldest });
    });

    it("drops a message that is gone from the pages it walked back through, and keeps the way back", async () => {
      const list = Array.from({ length: 6 * CHAT_PAGE }, (_, index) => message(`m${index}`, `Message ${index}`, AT + index * 1_000));
      serverList(list);
      await begin();
      for (let page = 0; page < 4; page += 1) await loadOlderChat();
      const oldest = ids()[0];
      serverList(list.filter((entry) => entry.id !== `m${2 * CHAT_PAGE}` && entry.id !== oldest));
      await loadChat();
      expect(ids()).toHaveLength(5 * CHAT_PAGE - 2);
      expect(ids()).not.toContain(`m${2 * CHAT_PAGE}`);
      expect(useChat.getState().cursor).toBe(ids()[0]);
      expect(ids()[0]).toBe(`m${CHAT_PAGE + 1}`);
    });

    it("keeps every message when the older pages can't be read again", async () => {
      const list = Array.from({ length: 6 * CHAT_PAGE }, (_, index) => message(`m${index}`, `Message ${index}`, AT + index * 1_000));
      serverList(list);
      await begin();
      for (let page = 0; page < 4; page += 1) await loadOlderChat();
      const shown = ids();
      const newest = list.filter((entry) => entry.id !== `m${2 * CHAT_PAGE}`).slice(-200);
      mocks.collabChatList.mockReset();
      mocks.collabChatList.mockResolvedValueOnce(newest).mockRejectedValueOnce(collabError("unreachable"));
      await loadChat();
      expect(ids()).toEqual(shown);
    });

    it("walks back to the oldest opened page when one request can't bring every opened message", async () => {
      const list = Array.from({ length: 6 * CHAT_PAGE }, (_, index) => message(`m${index}`, `Message ${index}`, AT + index * 1_000));
      serverList(list);
      await begin();
      for (let page = 0; page < 4; page += 1) await loadOlderChat();
      expect(ids()).toHaveLength(5 * CHAT_PAGE);
      const oldest = ids()[0];
      serverList(list.map((entry) => (entry.id === oldest ? { ...entry, body: "Edited" } : entry)));
      await loadChat();
      expect(useChat.getState().messages[0].body).toBe("Edited");
      expect(ids()).toHaveLength(5 * CHAT_PAGE);
      expect(useChat.getState().cursor).toBe(oldest);
    });

    it("starts over from the newest page when it no longer meets the loaded messages", async () => {
      await begin();
      const later = Array.from({ length: CHAT_PAGE }, (_, index) => message(`n${index}`, `Later ${index}`, AT + (index + 1) * 120_000));
      mocks.collabChatList.mockResolvedValueOnce(later);
      await loadChat();
      expect(ids()).toEqual(later.map((entry) => entry.id));
      expect(useChat.getState().hasOlder).toBe(true);
    });

    it("pages by place in the list, so a message with an early time can't hold the cursor still", async () => {
      const list = [
        ...Array.from({ length: 119 }, (_, index) => message(`m${index}`, `Message ${index}`, AT + index * 1_000)),
        message("offline", "Written offline", AT - 3_600_000),
      ];
      serverList(list, 10);
      await begin();
      await loadOlderChat();
      expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", "m70", CHAT_PAGE);
      await loadOlderChat();
      await loadOlderChat();
      expect(ids()).toHaveLength(120);
      expect(useChat.getState().hasOlder).toBe(false);
    });

    it("stops asking for older pages once a page brings nothing new", async () => {
      mocks.collabChatList.mockResolvedValue(fullPage);
      await begin();
      await loadOlderChat();
      expect(useChat.getState().hasOlder).toBe(false);
    });
  });

  describe("a pending 'Show message'", () => {
    it("is dropped when the project changes or stops being live", async () => {
      await begin();
      useChatRail.setState({ reveal: "c1" });
      share("thesis");
      expect(useChatRail.getState().reveal).toBeNull();
      useChatRail.setState({ reveal: "o1" });
      useCollabLiveStore.setState(seed.unlive());
      expect(useChatRail.getState().reveal).toBeNull();
    });

    it("is dropped when the reader leaves the chat, but not while the chat is being opened for it", async () => {
      await begin();
      useSettingsStore.setState({ railTab: "files", showTree: false });
      openChatMessage("c1");
      expect(useSettingsStore.getState()).toMatchObject({ railTab: "chat", showTree: true });
      expect(useChatRail.getState().reveal).toBe("c1");
      useSettingsStore.getState().setRailTab("files");
      expect(useChatRail.getState().reveal).toBeNull();
    });
  });

  describe("following the live project", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    const thanks = message("c4", "Thanks", AT + 100_000);

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

    it("marks the rail for a new message from someone else while the chat is out of view", async () => {
      await begin();
      mocks.collabChatList.mockResolvedValue([hello, reply, thanks]);
      emit("paper");
      await vi.advanceTimersByTimeAsync(200);
      expect(ids()).toContain("c4");
      expect(useChatRail.getState().unread).toBe(true);
    });

    it("leaves the rail alone for your own message, even one from another device, an edit and a deletion", async () => {
      await begin();
      const own = message("c5", "Sent from my phone", AT + 100_000, ALICE);
      const edited = { ...hello, body: "Draft is ready now", editedAt: AT + 110_000 };
      mocks.collabChatList.mockResolvedValue([edited, reply, own]);
      emit("paper");
      await vi.advanceTimersByTimeAsync(200);
      expect(ids()).toEqual(["c1", "c2", "c5"]);
      mocks.collabChatList.mockResolvedValue([reply, own]);
      emit("paper");
      await vi.advanceTimersByTimeAsync(200);
      expect(useChatRail.getState().unread).toBe(false);
    });

    it("leaves the rail alone for the messages that were there when the chat first loaded", async () => {
      share("paper");
      stop = startChat();
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      expect(useChatRail.getState().unread).toBe(false);
    });

    it("leaves the rail alone while the chat is in view", async () => {
      await begin();
      useSettingsStore.setState({ railTab: "chat", showTree: true });
      mocks.collabChatList.mockResolvedValue([hello, reply, thanks]);
      emit("paper");
      await vi.advanceTimersByTimeAsync(200);
      expect(ids()).toContain("c4");
      expect(useChatRail.getState().unread).toBe(false);
    });

    it("clears the unread mark only once the chat is actually in view", async () => {
      await begin();
      mocks.collabChatList.mockResolvedValue([hello, reply, thanks]);
      emit("paper");
      await vi.advanceTimersByTimeAsync(200);
      expect(useChatRail.getState().unread).toBe(true);
      useSettingsStore.setState({ editorFontSize: 15 });
      expect(useChatRail.getState().unread).toBe(true);
      useSettingsStore.setState({ railTab: "chat", showTree: false });
      expect(useChatRail.getState().unread).toBe(true);
      useSettingsStore.setState({ showTree: true });
      expect(useChatRail.getState().unread).toBe(false);
      useSettingsStore.setState({ editorFontSize: 13 });
    });

    it("hides the chat and drops a pending reload when the project stops being live", async () => {
      await begin();
      emit("paper");
      mocks.collabChatList.mockClear();
      useCollabLiveStore.setState(seed.unlive());
      expect(useChatRail.getState()).toMatchObject({ visible: false, unread: false });
      expect(useChat.getState()).toMatchObject({ projectId: null, messages: [], phase: "idle" });
      await vi.advanceTimersByTimeAsync(500);
      expect(mocks.collabChatList).not.toHaveBeenCalled();
    });

    it("keeps the chat closed until the session has a role, and closes it again once the role is gone", async () => {
      share("paper", null);
      stop = startChat();
      await vi.advanceTimersByTimeAsync(0);
      expect(useChatRail.getState().visible).toBe(false);
      expect(useChat.getState()).toMatchObject({ projectId: null, phase: "idle" });
      expect(mocks.collabChatStatus).not.toHaveBeenCalled();
      expect(mocks.collabChatList).not.toHaveBeenCalled();
      useCollabLiveStore.setState({ role: "viewer" });
      await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
      expect(useChatRail.getState().visible).toBe(true);
      expect(mocks.collabChatList).toHaveBeenCalledWith("paper", null, CHAT_PAGE);
      useCollabLiveStore.setState({ role: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(useChatRail.getState().visible).toBe(false);
      expect(useChat.getState().projectId).toBeNull();
      expect(mocks.collabChatList).toHaveBeenCalledTimes(1);
    });

    it("reloads and reads the status again when the project comes back online, not on other live changes", async () => {
      await begin();
      mocks.collabChatList.mockClear();
      mocks.collabChatStatus.mockClear();
      useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } });
      useCollabLiveStore.setState({ members: [projectMember(seed.bob, "owner")] });
      expect(mocks.collabChatList).not.toHaveBeenCalled();
      useCollabLiveStore.setState({ status: { state: "online" } });
      await vi.waitFor(() => expect(mocks.collabChatList).toHaveBeenCalledTimes(1));
      expect(mocks.collabChatStatus).toHaveBeenCalledTimes(1);
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
});

describe("chat on a project shared on a server", () => {
  const seed = SERVER_SEED;

  beforeEach(() => {
    mocks.collabChatList.mockResolvedValue([chatMessage("c1", seed.bob.account_id, "Draft is ready")]);
    mocks.collabChatStatus.mockResolvedValue(chatStatus(seed));
  });

  it("keeps the chat as it is when the share details change but the project doesn't", async () => {
    useCollabLiveStore.setState({ ...seed.live("paper", "editor"), status: { state: "online" } });
    stop = startChat();
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    const shown = useChat.getState().messages;
    mocks.collabChatList.mockClear();
    useCollabLiveStore.setState({
      share: shareInfo({ project_id: "paper", role: "editor", account_id: seed.alice.account_id, server_name: "Renamed Lab" }),
    });
    expect(useChat.getState().messages).toBe(shown);
    expect(useChatRail.getState().visible).toBe(true);
    expect(mocks.collabChatList).not.toHaveBeenCalled();
  });

  it("notes a chat mention of you in the activity feed once", async () => {
    useCollabLiveStore.setState({ ...seed.live("paper", "editor"), status: { state: "online" } });
    stop = startChat();
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    useCollabActivity.getState().open("paper");
    const payload = { projectId: "paper", local: false, mentioned: [{ messageId: "c7", author: seed.bob.account_id }] };
    mocks.listeners.get("collab://chat-changed")?.({ payload });
    mocks.listeners.get("collab://chat-changed")?.({ payload });
    const entries = useCollabActivity.getState().entries.filter((entry) => entry.kind === "chatMentioned");
    expect(entries).toHaveLength(1);
  });
});

describe("chat on a project live on Overleaf", () => {
  const seed = OVERLEAF_SEED;
  const hello = chatMessage("64f1c2a3b4c5d6e7f80901aa", seed.bob.account_id, "Draft is ready");
  const reply = chatMessage("64f1c2a3b4c5d6e7f80901ab", seed.alice.account_id, "Reading it now", AT + 60_000);

  beforeEach(() => {
    mocks.collabChatList.mockResolvedValue([hello, reply]);
    mocks.collabChatStatus.mockResolvedValue(chatStatus(seed));
  });

  function goLive(restricted = false) {
    useCollabLiveStore.setState({ ...seed.live("paper", "viewer"), restricted, status: { state: "online" } });
    stop = startChat();
  }

  it("keeps the Chat tab hidden while the Overleaf session hasn't started, as when another window holds it", async () => {
    useCollabLiveStore.setState({ ...seed.live("paper", "viewer"), role: null, selfId: null, status: null, refused: "live_elsewhere" });
    stop = startChat();
    mocks.listeners.get("collab-comments-status")?.({ payload: { projectId: "paper", status: {} } });
    await vi.waitFor(() => expect(useChat.getState().projectId).toBeNull());
    expect(useChatRail.getState().visible).toBe(false);
    expect(mocks.collabChatStatus).not.toHaveBeenCalled();
    useCollabLiveStore.setState({ role: "viewer" });
    expect(useChatRail.getState().visible).toBe(false);
    useCollabLiveStore.setState({ selfId: seed.alice.account_id, status: { state: "online" } });
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    expect(useChatRail.getState().visible).toBe(true);
    expect(mocks.collabChatStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps the chat as it is when the link changes but the project doesn't", async () => {
    goLive();
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    const shown = useChat.getState().messages;
    mocks.collabChatList.mockClear();
    useCollabLiveStore.setState({ overleaf: overleafLink({ signedIn: false }) });
    expect(useChat.getState().messages).toBe(shown);
    expect(useChatRail.getState().visible).toBe(true);
    expect(mocks.collabChatList).not.toHaveBeenCalled();
  });

  it("hides the chat from a link user Overleaf restricts, and shows it once the restriction lifts", async () => {
    goLive(true);
    await vi.waitFor(() => expect(useChat.getState().status).toMatchObject({ available: false, post: false }));
    expect(useChatRail.getState().visible).toBe(false);
    expect(mocks.collabChatList).not.toHaveBeenCalled();
    useCollabLiveStore.setState({ restricted: false });
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    expect(useChatRail.getState().visible).toBe(true);
    expect(useChat.getState().status).toEqual(chatStatus(seed));
    useCollabLiveStore.setState({ restricted: true });
    expect(useChatRail.getState().visible).toBe(false);
    expect(useChat.getState().messages).toEqual([]);
  });

  it("drops a message once someone deletes it, since Overleaf deletes it for good", async () => {
    vi.useFakeTimers();
    goLive();
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    mocks.collabChatList.mockResolvedValue([reply]);
    emit("paper");
    await vi.advanceTimersByTimeAsync(200);
    expect(ids()).toEqual([reply.id]);
    expect(useChatRail.getState().unread).toBe(false);
  });

  it("keeps a message sent while a reload was on its way, though that reload doesn't list it", async () => {
    goLive();
    await vi.waitFor(() => expect(useChat.getState().phase).toBe("ready"));
    const slow = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockReturnValueOnce(slow.promise);
    const loading = loadChat();
    const sent = chatMessage("64f1c2a3b4c5d6e7f80901ac", seed.alice.account_id, "On my way", AT + 70_000);
    mocks.collabChatSend.mockResolvedValue(sent);
    await sendChat("On my way");
    slow.resolve([hello, reply]);
    await loading;
    expect(ids()).toEqual([hello.id, reply.id, sent.id]);
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { useChatRail } from "@/components/collab/chat-rail";
import { loadNamespace } from "@/i18n";
import type { CollabChatMessage, CollabProjectRole } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, person, projectMember, shareInfo } from "../tests/fixtures";

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

import { CHAT_PAGE, startChat, useChat } from "./chat-store";
import { ChatPane } from "./ChatPane";

const copy = enCollab.chat;
const AT = 1_760_000_000_000;
const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];

function message(id: string, author: string, body: string, at = AT, overrides: Partial<CollabChatMessage> = {}) {
  return { id, author, at, body, deleted: false, verified: true, ...overrides };
}

const hello = message("c1", BOB_ID, "Draft is ready", AT);
const reply = message("c2", ALICE_ID, "Reading it now", AT + 60_000);

let stop: (() => void) | null = null;

function live(role: CollabProjectRole) {
  useCollabLiveStore.setState({
    projectId: "paper",
    role,
    status: { state: "online" },
    members: MEMBERS,
    share: shareInfo({ project_id: "paper", role, account_id: ALICE_ID }),
  });
}

async function open(role: CollabProjectRole = "editor") {
  live(role);
  stop = startChat();
  render(<ChatPane />);
  await screen.findByText("Reading it now");
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  vi.spyOn(Date, "now").mockReturnValue(AT + 120_000);
  mocks.collabChatList.mockResolvedValue([reply, hello]);
  mocks.collabChatDelete.mockResolvedValue(undefined);
  mocks.collabChatClear.mockResolvedValue(undefined);
  useSettingsStore.setState({ railTab: "files", showTree: true });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.restoreAllMocks();
  useCollabLiveStore.setState({ projectId: null, role: null, status: null, share: null, members: [] });
});

describe("project chat", () => {
  it("shows the messages oldest first with who wrote them and turns the rail tab on", async () => {
    await open();
    expect(mocks.collabChatList).toHaveBeenCalledWith("paper", null, CHAT_PAGE);
    const list = screen.getByRole("list", { name: copy.list });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Bob Smith"),
      expect.stringContaining("Alice Chen"),
    ]);
    expect(rows[0]).toHaveTextContent("Draft is ready");
    expect(useChatRail.getState().visible).toBe(true);
  });

  it("sends a message and shows it straight away", async () => {
    const user = userEvent.setup();
    mocks.collabChatSend.mockResolvedValue(message("c3", ALICE_ID, "Done", AT + 90_000));
    await open();
    await user.type(screen.getByRole("textbox", { name: copy.label }), "Done");
    await user.click(screen.getByRole("button", { name: copy.send }));
    await waitFor(() => expect(mocks.collabChatSend).toHaveBeenCalledWith("paper", "Done"));
    expect(await screen.findByText("Done")).toBeInTheDocument();
  });

  it("lets people delete only their own messages, after asking", async () => {
    await open();
    const rows = within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem");
    expect(within(rows[0]).queryByRole("button", { name: copy.delete })).toBeNull();
    fireEvent.click(within(rows[1]).getByRole("button", { name: copy.delete }));
    const dialog = await screen.findByRole("alertdialog", { name: copy.deleteConfirm.title });
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.delete }));
    await waitFor(() => expect(mocks.collabChatDelete).toHaveBeenCalledWith("paper", "c2"));
    expect(await screen.findByText(copy.deleted)).toBeInTheDocument();
  });

  it("offers Clear chat to the owner only, behind a confirmation", async () => {
    await open("owner");
    fireEvent.click(screen.getByRole("button", { name: copy.clear }));
    const dialog = await screen.findByRole("alertdialog", { name: copy.clearConfirm.title });
    fireEvent.click(within(dialog).getByRole("button", { name: copy.clearConfirm.confirm }));
    await waitFor(() => expect(mocks.collabChatClear).toHaveBeenCalledWith("paper"));
    await waitFor(() => expect(screen.getAllByText(copy.deleted)).toHaveLength(2));
  });

  it("keeps Clear chat from editors", async () => {
    await open("editor");
    expect(screen.queryByRole("button", { name: copy.clear })).toBeNull();
  });

  it("lets viewers read but not post", async () => {
    await open("viewer");
    expect(screen.queryByRole("textbox", { name: copy.label })).toBeNull();
    expect(screen.getByText(copy.readOnly)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.delete })).toBeNull();
  });

  it("lets commenters and reviewers post", async () => {
    await open("commenter");
    expect(screen.getByRole("textbox", { name: copy.label })).toBeInTheDocument();
  });

  it("reloads and marks the rail when someone else writes while the chat is closed", async () => {
    await open();
    mocks.collabChatList.mockResolvedValue([hello, reply, message("c4", BOB_ID, "Thanks", AT + 100_000)]);
    act(() => mocks.listeners.get("collab://chat-changed")?.({ payload: { projectId: "paper", local: false } }));
    expect(useChatRail.getState().unread).toBe(true);
    expect(await screen.findByText("Thanks")).toBeInTheDocument();
    act(() => useSettingsStore.setState({ railTab: "chat" }));
    expect(useChatRail.getState().unread).toBe(false);
  });

  it("loads older messages before the oldest one shown", async () => {
    const page = Array.from({ length: CHAT_PAGE }, (_, index) =>
      message(`p${index}`, BOB_ID, `Message ${index}`, AT + index * 1_000),
    );
    mocks.collabChatList.mockResolvedValueOnce(page).mockResolvedValueOnce([message("old", BOB_ID, "First ever", AT - 5_000)]);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    fireEvent.click(await screen.findByRole("button", { name: copy.loadOlder }));
    expect(await screen.findByText("First ever")).toBeInTheDocument();
    expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", "p0", CHAT_PAGE);
    expect(useChat.getState().messages[0].id).toBe("old");
    expect(screen.queryByRole("button", { name: copy.loadOlder })).toBeNull();
  });
});

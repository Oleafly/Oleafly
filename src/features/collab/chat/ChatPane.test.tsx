// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useChatRail } from "@/components/collab/chat-rail";
import { loadNamespace } from "@/i18n";
import type { CollabChatMessage, CollabProjectMember, CollabProjectRole } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { useComments } from "../comments/comments-store";
import { useCollabLiveStore } from "../live/live-store";
import { CHAT_AT as AT, chatMessage, chatStatusFor } from "../tests/chat-fixtures";
import { commentsStatus } from "../tests/comment-fixtures";
import {
  collabError,
  deferred,
  LIVE_SEEDS,
  type LiveSeed,
  liveReset,
  OVERLEAF_SEED,
  projectMember,
  SERVER_SEED,
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

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

import { CHAT_PAGE, loadChat, startChat, useChat } from "./chat-store";
import { ChatPane } from "./ChatPane";

const copy = enCollab.chat;

let stop: (() => void) | null = null;

beforeAll(async () => {
  await loadNamespace("collab");
  await loadNamespace("editor");
});

function resetMocks() {
  for (const mock of [
    mocks.collabChatList,
    mocks.collabChatSend,
    mocks.collabChatEdit,
    mocks.collabChatDelete,
    mocks.collabChatClear,
    mocks.collabChatStatus,
  ]) {
    mock.mockReset();
  }
}

beforeEach(() => {
  resetMocks();
  mocks.listeners.clear();
  vi.spyOn(Date, "now").mockReturnValue(AT + 120_000);
  mocks.collabChatDelete.mockResolvedValue(undefined);
  mocks.collabChatClear.mockResolvedValue(undefined);
  useSettingsStore.setState({ railTab: "files", showTree: true });
});

afterEach(() => {
  stop?.();
  stop = null;
  useChatRail.setState({ reveal: null });
  vi.restoreAllMocks();
  useComments.setState({ status: null });
  useCollabLiveStore.setState(liveReset());
});

function changed(projectId = "paper", local = false) {
  act(() => mocks.listeners.get("collab://chat-changed")?.({ payload: { projectId, local } }));
}

async function openDelete(row: HTMLElement) {
  fireEvent.keyDown(within(row).getByRole("button", { name: copy.messageActions }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: enCommon.actions.delete }));
}

function chatOn(seed: LiveSeed) {
  const ALICE = seed.alice.account_id;
  const BOB = seed.bob.account_id;
  const members = [projectMember(seed.alice, "editor"), projectMember(seed.bob, "owner")];
  const message = (id: string, author: string, body: string, at = AT, overrides: Partial<CollabChatMessage> = {}) =>
    chatMessage(id, author, body, at, overrides);
  const hello = message("c1", BOB, "Draft is ready", AT);
  const reply = message("c2", ALICE, "Reading it now", AT + 60_000);
  const page = () => Array.from({ length: CHAT_PAGE }, (_, index) => message(`p${index}`, BOB, `Message ${index}`, AT + index * 1_000));

  function live(role: CollabProjectRole, projectId = "paper", people: CollabProjectMember[] = members) {
    useCollabLiveStore.setState({ ...seed.live(projectId, role), status: { state: "online" }, members: people });
  }

  function switchTo(projectId: string, role: CollabProjectRole = "editor") {
    act(() => useCollabLiveStore.setState(seed.live(projectId, role)));
  }

  async function open(role: CollabProjectRole = "editor") {
    live(role);
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Reading it now");
  }

  function prepare() {
    mocks.collabChatList.mockResolvedValue([hello, reply]);
    mocks.collabChatStatus.mockImplementation(async () => chatStatusFor(seed, useCollabLiveStore.getState().role));
  }

  async function backToPaper() {
    mocks.collabChatList.mockResolvedValue([hello, reply]);
    switchTo("paper");
    expect(await screen.findByText("Reading it now")).toBeInTheDocument();
    return screen.getByRole("textbox", { name: copy.label });
  }

  async function sendingThenAway(user: ReturnType<typeof userEvent.setup>) {
    const sending = deferred<CollabChatMessage>();
    mocks.collabChatSend.mockReturnValueOnce(sending.promise);
    await open();
    await user.type(screen.getByRole("textbox", { name: copy.label }), "Important note");
    await user.click(screen.getByRole("button", { name: copy.send }));
    await waitFor(() => expect(mocks.collabChatSend).toHaveBeenCalledWith("paper", "Important note", expect.any(Array)));
    mocks.collabChatList.mockResolvedValue([message("o1", BOB, "Thesis notes")]);
    switchTo("thesis");
    expect(await screen.findByText("Thesis notes")).toBeInTheDocument();
    return sending;
  }

  return { ALICE, BOB, members, message, hello, reply, page, live, switchTo, open, prepare, backToPaper, sendingThenAway };
}

describe.each(LIVE_SEEDS)("project chat on the $name backend", (seed) => {
  const chat = chatOn(seed);
  const { ALICE, BOB, message, hello, reply, live, open } = chat;

  beforeEach(() => {
    chat.prepare();
  });

  it("shows the messages oldest first, names other people, keeps yours on the right, and turns the rail tab on", async () => {
    await open();
    expect(mocks.collabChatStatus).toHaveBeenCalledWith("paper");
    expect(mocks.collabChatList).toHaveBeenCalledWith("paper", null, CHAT_PAGE);
    const list = screen.getByRole("list", { name: copy.list });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Bob Smith");
    expect(rows[0]).toHaveTextContent("Draft is ready");
    expect(rows[0]).not.toHaveAttribute("data-own");
    expect(rows[1]).toHaveTextContent("Reading it now");
    expect(rows[1]).toHaveAttribute("data-own");
    expect(rows[1]).not.toHaveTextContent("Alice Chen");
    expect(useChatRail.getState().visible).toBe(true);
  });

  it("groups a quick follow-up from the same person under one name", async () => {
    mocks.collabChatList.mockResolvedValue([hello, message("c3", BOB, "And the tables", AT + 30_000), reply]);
    await open();
    const tables = screen.getByText("And the tables").closest("[data-comment-entry]") as HTMLElement;
    expect(tables).toHaveClass("mt-1");
    expect(tables).not.toHaveTextContent("Bob Smith");
    expect(tables.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(screen.getAllByText("Bob Smith")).toHaveLength(1);
    expect(screen.getByText("Reading it now").closest("[data-comment-entry]")).toHaveClass("mt-3");
  });

  it("sends a message and shows it straight away", async () => {
    const user = userEvent.setup();
    mocks.collabChatSend.mockResolvedValue(message("c3", ALICE, "Done", AT + 90_000));
    await open();
    await user.type(screen.getByRole("textbox", { name: copy.label }), "Done");
    await user.click(screen.getByRole("button", { name: copy.send }));
    await waitFor(() => expect(mocks.collabChatSend).toHaveBeenCalledWith("paper", "Done", expect.any(Array)));
    expect(await screen.findByText("Done")).toBeInTheDocument();
  });

  it("lets people delete only their own messages, after asking, and shows what the backend kept", async () => {
    await open();
    const rows = within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem");
    expect(within(rows[0]).queryByRole("button", { name: copy.messageActions })).toBeNull();
    await openDelete(rows[1]);
    const dialog = await screen.findByRole("alertdialog", { name: copy.deleteConfirm.title });
    mocks.collabChatList.mockResolvedValue(seed.name === "server" ? [hello, { ...reply, body: "", deleted: true }] : [hello]);
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.delete }));
    await waitFor(() => expect(mocks.collabChatDelete).toHaveBeenCalledWith("paper", "c2"));
    await waitFor(() => expect(screen.queryByText("Reading it now")).toBeNull());
    if (seed.name === "server") expect(screen.getByText(copy.deleted)).toBeInTheDocument();
    else expect(within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("reloads and marks the rail when someone else writes while the chat is closed", async () => {
    await open();
    mocks.collabChatList.mockResolvedValue([hello, reply, message("c4", BOB, "Thanks", AT + 100_000)]);
    changed();
    expect(await screen.findByText("Thanks")).toBeInTheDocument();
    await waitFor(() => expect(useChatRail.getState().unread).toBe(true));
    act(() => useSettingsStore.setState({ railTab: "chat" }));
    expect(useChatRail.getState().unread).toBe(false);
  });

  it("marks a new message New when the pane runs under StrictMode, as the app does", async () => {
    live("editor");
    stop = startChat();
    render(
      <StrictMode>
        <ChatPane />
      </StrictMode>,
    );
    await screen.findByText("Reading it now");
    mocks.collabChatList.mockResolvedValue([hello, reply, message("c4", BOB, "Thanks", AT + 100_000)]);
    changed();
    expect((await screen.findByText("Thanks")).closest("[data-comment-entry]")).toHaveAttribute("data-fresh");
    expect(screen.getByText("Reading it now").closest("[data-comment-entry]")).not.toHaveAttribute("data-fresh");
  });

  it("marks a message New when it only claims to be from you, and highlights a mention of you", async () => {
    await open();
    mocks.collabChatList.mockResolvedValue([
      hello,
      reply,
      message("c5", ALICE, "Sent in your name", AT + 100_000, { verified: false }),
      message("c6", BOB, "@Alice Chen look at this", AT + 110_000, { mentions: [ALICE] }),
    ]);
    changed();
    const forged = (await screen.findByText("Sent in your name")).closest("[data-comment-entry]") as HTMLElement;
    expect(forged).not.toHaveAttribute("data-own");
    expect(forged).toHaveAttribute("data-fresh");
    const mention = screen.getByText("@Alice Chen");
    expect(mention).toHaveAttribute("data-mention");
    expect(mention.closest("[data-comment-bubble]")).not.toBeNull();
  });

  it("doesn't bring back a message that was still sending when you switched projects", async () => {
    const user = userEvent.setup();
    const sending = await chat.sendingThenAway(user);
    await act(async () => sending.resolve(message("c3", ALICE, "Important note", AT + 90_000)));
    expect(await chat.backToPaper()).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("brings a message back as Not sent when its send fails after you switched projects, and sends it again only on Retry", async () => {
    const user = userEvent.setup();
    const sending = await chat.sendingThenAway(user);
    await act(async () => sending.reject(collabError("unreachable")));
    expect(screen.queryByRole("alert")).toBeNull();
    const field = await chat.backToPaper();
    expect(field).toHaveValue("Important note");
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.comments.notSentShort);
    expect(screen.getByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(mocks.collabChatSend).toHaveBeenCalledTimes(1);
    mocks.collabChatSend.mockResolvedValueOnce(message("c3", ALICE, "Important note", AT + 90_000));
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(mocks.collabChatSend).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a message that is still sending when you come back to its project, and says so when it then fails", async () => {
    const user = userEvent.setup();
    const sending = await chat.sendingThenAway(user);
    const field = await chat.backToPaper();
    expect(field).toHaveValue("Important note");
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByText(enCollab.comments.sending)).toBeInTheDocument();
    await act(async () => sending.reject(collabError("unreachable")));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(field).toHaveValue("Important note");
    expect(field).not.toHaveAttribute("readonly");
    expect(mocks.collabChatSend).toHaveBeenCalledTimes(1);
  });

  it("clears a message that was still sending when you came back once it is sent", async () => {
    const user = userEvent.setup();
    const sending = await chat.sendingThenAway(user);
    const field = await chat.backToPaper();
    await act(async () => sending.resolve(message("c3", ALICE, "Important note", AT + 90_000)));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(screen.getByText("Important note")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.collabChatSend).toHaveBeenCalledTimes(1);
  });

  it("brings a message back as Not sent when its send fails after the chat was closed", async () => {
    const user = userEvent.setup();
    const sending = deferred<CollabChatMessage>();
    mocks.collabChatSend.mockReturnValueOnce(sending.promise);
    live("editor");
    stop = startChat();
    const view = render(<ChatPane />);
    await screen.findByText("Reading it now");
    await user.type(screen.getByRole("textbox", { name: copy.label }), "Important note");
    await user.click(screen.getByRole("button", { name: copy.send }));
    await waitFor(() => expect(mocks.collabChatSend).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => sending.reject(collabError("unreachable")));
    render(<ChatPane />);
    expect(await screen.findByRole("textbox", { name: copy.label })).toHaveValue("Important note");
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
  });

  it("loads older messages before the oldest one shown", async () => {
    mocks.collabChatList.mockResolvedValueOnce(chat.page()).mockResolvedValueOnce([message("old", BOB, "First ever", AT - 5_000)]);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    fireEvent.click(await screen.findByRole("button", { name: copy.loadOlder }));
    expect(await screen.findByText("First ever")).toBeInTheDocument();
    expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", "p0", CHAT_PAGE);
    expect(useChat.getState().messages[0].id).toBe("old");
    expect(screen.queryByRole("button", { name: copy.loadOlder })).toBeNull();
  });

  it("says why the chat couldn't load and loads it again on Retry", async () => {
    mocks.collabChatList.mockRejectedValueOnce(collabError("unreachable"));
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unreachable)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("Reading it now")).toBeInTheDocument();
    expect(screen.queryByText(copy.loadFailed)).toBeNull();
  });

  it("says when nobody has written yet", async () => {
    mocks.collabChatList.mockResolvedValueOnce([]);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: copy.list })).toBeNull();
  });

  it("calls people it has no name for Someone and flags messages it couldn't verify", async () => {
    mocks.collabChatList.mockResolvedValueOnce([
      message("c5", seed.carol.account_id, "No name for me", AT),
      message("c6", ALICE, "Not really Alice", AT + 1_000, { verified: false }),
    ]);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    const list = await screen.findByRole("list", { name: copy.list });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(enCollab.toolbar.unknownPerson);
    expect(rows[0]).toHaveTextContent("No name for me");
    expect(rows[1]).toHaveTextContent(enCollab.comments.unverifiedAuthor);
    expect(rows[1]).not.toHaveTextContent("Alice Chen");
    expect(within(rows[1]).queryByRole("button", { name: copy.messageActions })).toBeNull();
  });

  it("names someone who left the project or is only invited, and keeps them out of the @ list", async () => {
    const user = userEvent.setup();
    const left = { ...projectMember(seed.carol, "editor"), standing: "former" as const };
    const invitee = projectMember({ ...seed.carol, account_id: "invite-1", display_name: "dana@uni.edu" }, "viewer");
    live("editor", "paper", [...chat.members, left, { ...invitee, standing: "invited" }]);
    mocks.collabChatList.mockResolvedValue([
      message("c5", seed.carol.account_id, "I wrote the methods", AT),
      message("c6", "invite-1", "Odd but possible", AT + 30_000),
      reply,
    ]);
    stop = startChat();
    render(<ChatPane />);
    const rows = within(await screen.findByRole("list", { name: copy.list })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(`Carol Diaz${enCollab.people.former}`);
    expect(within(rows[0]).getByText(enCollab.people.former)).toBeInTheDocument();
    expect(within(rows[1]).getByText(enCollab.people.invited)).toBeInTheDocument();
    expect(rows[2]).not.toHaveTextContent(enCollab.people.former);
    await user.type(screen.getByRole("textbox", { name: copy.label }), "@");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining("Bob Smith")]);
  });

  it("keeps a message when the deletion is cancelled", async () => {
    await open();
    const rows = within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem");
    await openDelete(rows[1]);
    const dialog = await screen.findByRole("alertdialog", { name: copy.deleteConfirm.title });
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.collabChatDelete).not.toHaveBeenCalled();
    expect(rows[1]).toHaveTextContent("Reading it now");
  });

  it("keeps the message and says why when deleting it fails", async () => {
    mocks.collabChatDelete.mockRejectedValueOnce({ code: "comment_not_live", message: "" });
    await open();
    const rows = within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem");
    await openDelete(rows[1]);
    const dialog = await screen.findByRole("alertdialog", { name: copy.deleteConfirm.title });
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.delete }));
    expect(await within(rows[1]).findByRole("alert")).toHaveTextContent(enCollab.comments.refusals.notLive);
    expect(rows[1]).toHaveTextContent("Reading it now");
    expect(screen.queryByText(copy.deleted)).toBeNull();
  });

  it("says why older messages couldn't load and lets you ask again", async () => {
    mocks.collabChatList.mockResolvedValueOnce(chat.page()).mockRejectedValueOnce(collabError("unreachable"));
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    fireEvent.click(await screen.findByRole("button", { name: copy.loadOlder }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    await waitFor(() => expect(screen.getByRole("button", { name: copy.loadOlder })).toBeEnabled());
    mocks.collabChatList.mockResolvedValueOnce([message("old", BOB, "First ever", AT - 5_000)]);
    fireEvent.click(screen.getByRole("button", { name: copy.loadOlder }));
    expect(await screen.findByText("First ever")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says posting waits for the connection once the live session has ended", async () => {
    live("owner");
    useCollabLiveStore.setState({ status: { state: "ended", reason: "server_removed" } });
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Reading it now");
    expect(screen.getByText(copy.offline)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: copy.label })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.messageActions })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.clear })).toBeNull();
  });
});

describe("chat test isolation", () => {
  const chat = chatOn(SERVER_SEED);

  it("starts each test without a chat page the one before left unused", async () => {
    mocks.collabChatList.mockResolvedValueOnce([chat.message("x1", chat.BOB, "Left over")]);
    resetMocks();
    chat.prepare();
    await chat.open();
    expect(screen.queryByText("Left over")).toBeNull();
  });
});

describe("chat on a project shared on a server", () => {
  const chat = chatOn(SERVER_SEED);
  const { BOB, message, hello, reply, live, open } = chat;

  beforeEach(() => {
    chat.prepare();
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
    expect(screen.queryByRole("button", { name: copy.messageActions })).toBeNull();
  });

  it("lets commenters and reviewers post", async () => {
    await open("commenter");
    expect(screen.getByRole("textbox", { name: copy.label })).toBeInTheDocument();
  });

  it("offers reactions but no Edit, since the server can't edit chat messages", async () => {
    await open();
    const rows = within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem");
    expect(within(rows[0]).getByRole("button", { name: enCollab.comments.addReaction })).toBeInTheDocument();
    fireEvent.keyDown(within(rows[1]).getByRole("button", { name: copy.messageActions }), { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: enCommon.actions.delete })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: enCommon.actions.edit })).toBeNull();
  });

  it("keeps a half-written message for each project and brings it back on return, while Clear chat starts fresh", async () => {
    const user = userEvent.setup();
    await open("owner");
    await user.type(screen.getByRole("textbox", { name: copy.label }), "Half-written note for paper");
    fireEvent.click(screen.getByRole("button", { name: copy.clear }));
    await screen.findByRole("alertdialog", { name: copy.clearConfirm.title });
    mocks.collabChatList.mockResolvedValue([message("o1", BOB, "Thesis notes")]);
    chat.switchTo("thesis", "owner");
    expect(await screen.findByText("Thesis notes")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: copy.label })).toHaveValue("");
    mocks.collabChatList.mockResolvedValue([hello, reply]);
    chat.switchTo("paper", "owner");
    expect(await screen.findByText("Reading it now")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: copy.label })).toHaveValue("Half-written note for paper");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the chat when clearing is cancelled", async () => {
    await open("owner");
    fireEvent.click(screen.getByRole("button", { name: copy.clear }));
    const dialog = await screen.findByRole("alertdialog", { name: copy.clearConfirm.title });
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.collabChatClear).not.toHaveBeenCalled();
    expect(screen.getByText("Draft is ready")).toBeInTheDocument();
  });

  it("says why clearing the chat failed and keeps the messages", async () => {
    mocks.collabChatClear.mockRejectedValueOnce(collabError("chat_role"));
    await open("owner");
    fireEvent.click(screen.getByRole("button", { name: copy.clear }));
    const dialog = await screen.findByRole("alertdialog", { name: copy.clearConfirm.title });
    fireEvent.click(within(dialog).getByRole("button", { name: copy.clearConfirm.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.chat_role);
    expect(screen.getByText("Draft is ready")).toBeInTheDocument();
    expect(screen.queryByText(copy.deleted)).toBeNull();
  });

  it("says who is typing in the chat", async () => {
    useComments.setState({ status: commentsStatus({ typing: true }) });
    await open();
    act(() => {
      useCollabLiveStore.setState({
        peers: {
          d1: {
            deviceId: "d1",
            accountId: BOB,
            person: SERVER_SEED.bob,
            path: null,
            cursor: null,
            anchor: null,
            seenAt: AT + 120_000,
            hue: 20,
            activity: { kind: "chat", threadId: null },
            activityAt: AT + 120_000,
          },
        },
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(copy.typingOne.replace("{{name}}", "Bob Smith"));
    act(() => useCollabLiveStore.setState({ peers: {} }));
    expect(screen.queryByText(/is typing/u)).toBeNull();
  });

  it("offers the project members with their role when you type @ in the chat", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByRole("textbox", { name: copy.label }), "@Bo");
    const option = within(screen.getByRole("listbox")).getByRole("option");
    expect(option).toHaveTextContent("Bob Smith");
    expect(option).toHaveTextContent(enCollab.projectRoles.owner);
  });

  it("scrolls to the message a chat mention opened", async () => {
    await open();
    const reveal = vi.fn();
    const target = screen.getByText("Draft is ready").closest("[data-comment-entry]") as HTMLElement;
    target.scrollIntoView = reveal;
    act(() => useChatRail.setState({ reveal: "c1" }));
    expect(reveal).toHaveBeenCalledWith({ block: "center" });
    expect(useChatRail.getState().reveal).toBeNull();
  });

  it("loads older pages to reach a mentioned message that is no longer in the newest page", async () => {
    mocks.collabChatList.mockResolvedValueOnce(chat.page()).mockResolvedValueOnce([message("old", BOB, "Mentioned you", AT - 5_000)]);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Message 0");
    const reveal = vi.fn();
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = reveal;
    try {
      act(() => useChatRail.setState({ reveal: "old" }));
      await waitFor(() => expect(reveal).toHaveBeenCalledWith({ block: "center" }));
      expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", "p0", CHAT_PAGE);
      expect(useChatRail.getState().reveal).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = scroll;
    }
  });

  it("says a mentioned message can't be found once every page is loaded, until the next one is found", async () => {
    await open();
    act(() => useChatRail.setState({ reveal: "gone" }));
    expect(await screen.findByText(enCollab.errors.not_found)).toBeInTheDocument();
    expect(useChatRail.getState().reveal).toBeNull();
    const target = screen.getByText("Draft is ready").closest("[data-comment-entry]") as HTMLElement;
    target.scrollIntoView = vi.fn();
    act(() => useChatRail.setState({ reveal: "c1" }));
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(screen.queryByText(enCollab.errors.not_found)).toBeNull();
  });

  async function searchingOlder() {
    const older = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockResolvedValueOnce(chat.page()).mockReturnValueOnce(older.promise);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Message 0");
    const reveal = vi.fn();
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = reveal;
    act(() => useChatRail.setState({ reveal: "old" }));
    await waitFor(() => expect(mocks.collabChatList).toHaveBeenCalledTimes(2));
    const list = screen.getByRole("list", { name: copy.list });
    return {
      list,
      scroller: list.closest(".overflow-y-auto") as HTMLElement,
      reveal,
      async finish() {
        try {
          await act(async () => older.resolve([message("old", BOB, "Mentioned you", AT - 5_000)]));
          expect(await screen.findByText("Mentioned you")).toBeInTheDocument();
        } finally {
          Element.prototype.scrollIntoView = scrollIntoView;
        }
      },
    };
  }

  async function expectNoJump(search: Awaited<ReturnType<typeof searchingOlder>>) {
    expect(useChatRail.getState().reveal).toBeNull();
    await search.finish();
    expect(search.reveal).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  }

  it.each([
    ["the wheel", (list: HTMLElement) => fireEvent.wheel(list)],
    ["a touch", (list: HTMLElement) => fireEvent.touchMove(list)],
    ["the scroll bar", (list: HTMLElement) => fireEvent.pointerDown(list.closest(".overflow-y-auto") as HTMLElement)],
  ])("stops looking for a mentioned message, without a jump, once the reader scrolls with %s", async (_, scroll) => {
    const search = await searchingOlder();
    fireEvent.scroll(search.scroller);
    fireEvent.keyDown(search.list, { key: "Enter" });
    fireEvent.pointerDown(search.list);
    expect(useChatRail.getState().reveal).toBe("old");
    scroll(search.list);
    await expectNoJump(search);
  });

  it.each(["{PageDown}", "{PageUp}", "{End}", "{Home}", "{ArrowDown}", " ", "{Shift>} {/Shift}"])(
    "stops looking for a mentioned message, without a jump, when the reader clicks message text and scrolls with %s",
    async (keys) => {
      const user = userEvent.setup();
      const search = await searchingOlder();
      await user.click(screen.getByText("Message 10"));
      expect(document.activeElement).toBe(document.body);
      expect(useChatRail.getState().reveal).toBe("old");
      await user.keyboard(keys);
      await expectNoJump(search);
    },
  );

  it("stops looking for a mentioned message, without a jump, when something other than the app scrolls the list, such as a screen reader", async () => {
    const search = await searchingOlder();
    search.scroller.scrollTop = 240;
    fireEvent.scroll(search.scroller);
    await expectNoJump(search);
  });

  it("keeps looking for a mentioned message when the list scrolls to keep its place after something in it changes size", async () => {
    const watching: { changed: (entries: never[]) => void; targets: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly targets: Element[] = [];
        constructor(changed: (entries: never[]) => void) {
          watching.push({ changed, targets: this.targets });
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        disconnect() {}
      },
    );
    try {
      const search = await searchingOlder();
      search.scroller.scrollTop = 300;
      act(() => {
        for (const watch of watching) if (watch.targets.includes(search.scroller)) watch.changed([]);
      });
      fireEvent.scroll(search.scroller);
      expect(useChatRail.getState().reveal).toBe("old");
      await search.finish();
      expect(search.reveal).toHaveBeenCalledWith({ block: "center" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps looking for a mentioned message when the list scrolls only to keep up with a new message, and ignores keys typed in the composer", async () => {
    const user = userEvent.setup();
    const search = await searchingOlder();
    Object.defineProperty(search.scroller, "scrollHeight", { configurable: true, value: 900 });
    mocks.collabChatList.mockResolvedValue([...chat.page(), message("c9", BOB, "One more", AT + 99_000)]);
    changed();
    expect(await screen.findByText("One more")).toBeInTheDocument();
    expect(search.scroller.scrollTop).toBe(900);
    fireEvent.scroll(search.scroller);
    await user.click(screen.getByText("Message 10"));
    await user.type(screen.getByRole("textbox", { name: copy.label }), "Hi {End} there");
    expect(useChatRail.getState().reveal).toBe("old");
    await search.finish();
    expect(search.reveal).toHaveBeenCalledWith({ block: "center" });
    expect(useChatRail.getState().reveal).toBeNull();
  });

  it("asks for an older page once when it fails while looking for a mentioned message, and again when asked again", async () => {
    mocks.collabChatList.mockResolvedValueOnce(chat.page()).mockRejectedValueOnce(collabError("unreachable"));
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Message 0");
    act(() => useChatRail.setState({ reveal: "old" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(mocks.collabChatList).toHaveBeenCalledTimes(2);
    expect(useChatRail.getState().reveal).toBeNull();
    mocks.collabChatList.mockResolvedValueOnce([message("old", BOB, "Mentioned you", AT - 5_000)]);
    const reveal = vi.fn();
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = reveal;
    try {
      act(() => useChatRail.setState({ reveal: "old" }));
      await waitFor(() => expect(reveal).toHaveBeenCalledWith({ block: "center" }));
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = scroll;
    }
  });

  it("drops the chat's alerts when the project changes", async () => {
    await open();
    act(() => useChatRail.setState({ reveal: "gone" }));
    expect(await screen.findByText(enCollab.errors.not_found)).toBeInTheDocument();
    mocks.collabChatList.mockResolvedValue([message("o1", BOB, "Thesis notes")]);
    chat.switchTo("thesis");
    expect(await screen.findByText("Thesis notes")).toBeInTheDocument();
    expect(screen.queryByText(enCollab.errors.not_found)).toBeNull();
  });

  it("keeps looking for a mentioned message in older pages after a background reload fails", async () => {
    mocks.collabChatList
      .mockResolvedValueOnce(chat.page())
      .mockRejectedValueOnce(collabError("unreachable"))
      .mockResolvedValueOnce([message("old", BOB, "Mentioned you", AT - 5_000)]);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Message 0");
    await act(() => loadChat());
    expect(useChat.getState().phase).toBe("failed");
    const reveal = vi.fn();
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = reveal;
    try {
      act(() => useChatRail.setState({ reveal: "old" }));
      await waitFor(() => expect(reveal).toHaveBeenCalledWith({ block: "center" }));
      expect(mocks.collabChatList).toHaveBeenLastCalledWith("paper", "p0", CHAT_PAGE);
      expect(useChatRail.getState().reveal).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = scroll;
    }
  });

  it("doesn't say it is loading a mentioned message while the chat itself couldn't load", async () => {
    mocks.collabChatList.mockRejectedValueOnce(collabError("unreachable"));
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    act(() => useChatRail.setState({ reveal: "c1" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores the failure of a search that a newer Show message replaced", async () => {
    const older = deferred<CollabChatMessage[]>();
    mocks.collabChatList.mockResolvedValueOnce(chat.page()).mockReturnValueOnce(older.promise);
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Message 0");
    const reveal = vi.fn();
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = reveal;
    try {
      act(() => useChatRail.setState({ reveal: "old" }));
      await waitFor(() => expect(mocks.collabChatList).toHaveBeenCalledTimes(2));
      act(() => useChatRail.setState({ reveal: "p10" }));
      await act(async () => older.reject(collabError("unreachable")));
      await waitFor(() => expect(reveal).toHaveBeenCalledWith({ block: "center" }));
      expect(useChatRail.getState().reveal).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = scroll;
    }
  });

  it("finds a mentioned message by its place in the list when an offline message sorts first by time", async () => {
    const list = [
      ...Array.from({ length: 119 }, (_, index) => message(`m${index}`, BOB, `Message ${index}`, AT + index * 1_000)),
      message("offline", BOB, "Written offline", AT - 3_600_000),
    ];
    let asked = 0;
    mocks.collabChatList.mockImplementation(async (_project: string, before: string | null, limit: number) => {
      asked += 1;
      if (asked > 10) return [];
      const found = before === null ? -1 : list.findIndex((entry) => entry.id === before);
      const end = found < 0 ? list.length : found;
      return list.slice(Math.max(0, end - limit), end);
    });
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Written offline");
    const reveal = vi.fn();
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = reveal;
    try {
      act(() => useChatRail.setState({ reveal: "m5" }));
      await waitFor(() => expect(useChatRail.getState().reveal).toBeNull());
      expect(reveal).toHaveBeenCalledWith({ block: "center" });
      expect(asked).toBeLessThanOrEqual(3);
    } finally {
      Element.prototype.scrollIntoView = scroll;
    }
  });

  it("says it is loading while it looks for a mentioned message in older pages", async () => {
    let answer: (messages: CollabChatMessage[]) => void = () => undefined;
    mocks.collabChatList.mockResolvedValueOnce(chat.page()).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    live("editor");
    stop = startChat();
    render(<ChatPane />);
    await screen.findByText("Message 0");
    act(() => useChatRail.setState({ reveal: "old" }));
    expect(await screen.findByRole("status")).toHaveTextContent(enCommon.state.loading);
    await act(async () => answer([]));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("chat on a project live on Overleaf", () => {
  const chat = chatOn(OVERLEAF_SEED);
  const { BOB, message, reply, live, open } = chat;

  beforeEach(() => {
    chat.prepare();
  });

  it("edits your own message from its menu and marks it edited", async () => {
    const user = userEvent.setup();
    mocks.collabChatEdit.mockResolvedValue({ ...reply, body: "Reading it again", editedAt: AT + 100_000 });
    await open();
    const rows = within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem");
    expect(within(rows[0]).queryByRole("button", { name: copy.messageActions })).toBeNull();
    fireEvent.keyDown(within(rows[1]).getByRole("button", { name: copy.messageActions }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: enCommon.actions.edit }));
    const field = await screen.findByRole("textbox", { name: copy.editLabel });
    expect(field).toHaveValue("Reading it now");
    await user.clear(field);
    await user.type(field, "Reading it again");
    await user.click(screen.getByRole("button", { name: enCommon.actions.save }));
    await waitFor(() => expect(mocks.collabChatEdit).toHaveBeenCalledWith("paper", reply.id, "Reading it again", expect.any(Array)));
    expect(await screen.findByText("Reading it again")).toBeInTheDocument();
    const edited = screen.getByText("Reading it again").closest("[data-comment-entry]") as HTMLElement;
    expect(edited).toHaveTextContent(enCollab.comments.edited);
    expect(screen.queryByRole("textbox", { name: copy.editLabel })).toBeNull();
  });

  it("says why an edit was refused and keeps the message", async () => {
    const user = userEvent.setup();
    mocks.collabChatEdit.mockRejectedValue(collabError("too_large"));
    await open();
    const rows = within(screen.getByRole("list", { name: copy.list })).getAllByRole("listitem");
    fireEvent.keyDown(within(rows[1]).getByRole("button", { name: copy.messageActions }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: enCommon.actions.edit }));
    await user.type(await screen.findByRole("textbox", { name: copy.editLabel }), " again");
    await user.click(screen.getByRole("button", { name: enCommon.actions.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.too_large);
    expect(useChat.getState().messages.find((entry) => entry.id === reply.id)?.body).toBe("Reading it now");
  });

  it("offers no reactions and no Clear chat, even to the owner", async () => {
    await open("owner");
    expect(screen.queryByRole("button", { name: copy.clear })).toBeNull();
    expect(screen.queryByRole("button", { name: enCollab.comments.addReaction })).toBeNull();
  });

  it("lets viewers post, as Overleaf does", async () => {
    await open("viewer");
    expect(screen.getByRole("textbox", { name: copy.label })).toBeInTheDocument();
    expect(screen.queryByText(copy.readOnly)).toBeNull();
  });

  it("drops a message someone deleted on Overleaf", async () => {
    await open();
    mocks.collabChatList.mockResolvedValue([reply]);
    changed();
    await waitFor(() => expect(screen.queryByText("Draft is ready")).toBeNull());
    expect(screen.queryByText(copy.deleted)).toBeNull();
    expect(useChatRail.getState().unread).toBe(false);
  });

  it("shows Markdown marks as Overleaf does, with no format buttons, and takes messages up to Overleaf's limit", async () => {
    mocks.collabChatList.mockResolvedValue([
      message("m1", BOB, "**Bold** and `code` at https://www.overleaf.com/learn\n- not a list", AT),
      reply,
    ]);
    live("editor");
    stop = startChat();
    const { container } = render(<ChatPane />);
    await screen.findByText("Reading it now");
    const written = screen.getByText(/Bold\*\* and/u).closest("[data-comment-body]") as HTMLElement;
    expect(written).toHaveTextContent("**Bold** and `code` at");
    expect(written).toHaveTextContent("- not a list");
    expect(written.querySelector("strong, code, ul")).toBeNull();
    expect(within(written).getByRole("link", { name: "https://www.overleaf.com/learn" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: copy.label })).toHaveAttribute("maxLength", "10240");
    expect(screen.queryByRole("button", { name: enEditor.toolbar.bold })).toBeNull();
    expect(screen.queryByRole("button", { name: enEditor.toolbar.bulletedList })).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("draws math in messages and leaves prices, escapes and broken math as text", async () => {
    mocks.collabChatList.mockResolvedValue([
      message("m1", BOB, "Use $x^2$ and \\(\\alpha\\) here", AT),
      message("m2", BOB, "$$\\int_0^1 f(t)\\,dt$$", AT + 1_000),
      message("m3", BOB, "It costs $5 and $6, or \\$7 with \\[ \\frac{1}{ \\] broken", AT + 2_000),
      reply,
    ]);
    live("editor");
    stop = startChat();
    const { container } = render(<ChatPane />);
    await screen.findByText("Reading it now");
    await waitFor(() => expect(container.querySelectorAll("[data-comment-math]")).toHaveLength(3));
    expect(container.querySelector('[data-comment-math="display"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-comment-math] .katex")).toHaveLength(3);
    const prices = screen.getByText(/It costs/u).closest("[data-comment-body]") as HTMLElement;
    expect(prices).toHaveTextContent("It costs $5 and $6, or $7 with \\[ \\frac{1}{ \\] broken");
    expect(prices.querySelector("[data-comment-math]")).toBeNull();
    expect(prices.querySelector("[data-comment-math-source]")).toHaveTextContent("\\[ \\frac{1}{ \\]");
  });
});

describe("chat on a server project leaves math alone", () => {
  const chat = chatOn(SERVER_SEED);

  beforeEach(() => {
    chat.prepare();
  });

  it("reads Markdown and limits the composer to what the server takes", async () => {
    mocks.collabChatList.mockResolvedValue([chat.message("m1", chat.BOB, "**Bold** idea", AT), chat.reply]);
    chat.live("editor");
    stop = startChat();
    const { container } = render(<ChatPane />);
    await screen.findByText("Reading it now");
    expect(container.querySelector("strong")).toHaveTextContent("Bold");
    expect(screen.getByRole("textbox", { name: copy.label })).toHaveAttribute("maxLength", "4000");
    expect(screen.getByRole("button", { name: enEditor.toolbar.bold })).toBeInTheDocument();
  });

  it("shows math as the text that was written", async () => {
    mocks.collabChatList.mockResolvedValue([chat.message("m1", chat.BOB, "Use $x^2$ here", AT), chat.reply]);
    chat.live("editor");
    stop = startChat();
    const { container } = render(<ChatPane />);
    await screen.findByText("Reading it now");
    expect(screen.getByText("Use $x^2$ here")).toBeInTheDocument();
    expect(container.querySelector("[data-comment-math]")).toBeNull();
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import type { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import { loadNamespace } from "@/i18n";
import type { CollabCommentThread } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { AT, commentMessage, commentsStatus, commentThread, INTRO_FILE, threadList } from "../tests/comment-fixtures";
import { allowRadixSelect } from "../tests/select";

const mocks = vi.hoisted(() => ({
  collabCommentThreadList: vi.fn(),
  collabCommentCreate: vi.fn(),
  collabCommentReply: vi.fn(),
  collabCommentEdit: vi.fn(),
  collabCommentDelete: vi.fn(),
  collabCommentResolve: vi.fn(),
  collabCommentReopen: vi.fn(),
  collabCommentThreadDelete: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { useComments } from "./comments-store";
import { CommentsPane } from "./CommentsPane";

const copy = enCollab.comments;
const actions = enCommon.actions;
const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner"), projectMember(CAROL, "viewer")];
const COMMENT_MEMBERS = [
  { accountId: ALICE_ID, displayName: "Alice Chen", login: "alice-chen" },
  { accountId: BOB_ID, displayName: "Bob Smith", login: "bobsmith" },
  { accountId: CAROL.account_id, displayName: "Carol Diaz", login: "carol" },
];

function show(threads: CollabCommentThread[], overrides: Partial<ReturnType<typeof useComments.getState>> = {}) {
  useComments.setState({
    projectId: "paper",
    status: commentsStatus(),
    path: "chapters/intro.tex",
    threads,
    phase: "ready",
    error: null,
    selectedId: null,
    showResolved: false,
    draft: null,
    ...overrides,
  });
  return render(<CommentsPane />);
}

function viewAs(role: "owner" | "editor" | "viewer") {
  useCollabLiveStore.setState({ role, share: shareInfo({ project_id: "paper", role, account_id: ALICE_ID }) });
}

function card(quote: string) {
  return screen.getByRole("button", { name: quote }).closest("article") as HTMLElement;
}

function openMenu(scope: HTMLElement, name: string) {
  fireEvent.keyDown(within(scope).getByRole("button", { name }), { key: "Enter" });
}

const conversation = commentThread("t-quick", { from: 4, to: 9 }, {
  anchor: { quote: "quick", range: { from: 4, to: 9 } },
  messages: [
    commentMessage("m-bob", BOB_ID, "Is this word right?", { at: AT - 120_000 }),
    commentMessage("m-alice", ALICE_ID, "Yes, I checked @Bob Smith", { mentions: [BOB_ID], editedAt: AT }),
  ],
});
const later = commentThread("t-lazy", { from: 35, to: 39 }, { anchor: { quote: "lazy", range: { from: 35, to: 39 } } });
const resolved = commentThread("t-fox", { from: 16, to: 19 }, {
  anchor: { quote: "fox", range: { from: 16, to: 19 } },
  resolved: { by: BOB_ID, at: AT, verified: true },
});
const detached = commentThread("t-gone", null, { anchor: { quote: "a deleted sentence", range: null } });

beforeAll(async () => {
  await loadNamespace("collab");
  allowRadixSelect();
});

const editorFocus = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  setEditorView({ focus: editorFocus } as unknown as EditorView);
  vi.spyOn(Date, "now").mockReturnValue(AT + 60_000);
  useCollabLiveStore.setState({ projectId: "paper", status: { state: "online" }, members: MEMBERS });
  viewAs("editor");
});

afterEach(() => {
  setEditorView(null);
  vi.restoreAllMocks();
  useComments.setState({ projectId: null, status: null, path: null, threads: [], phase: "idle", draft: null, selectedId: null });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
});

describe("Comments tab", () => {
  it("lists the file's threads in document order, then the detached ones with their quotes", () => {
    show([later, detached, conversation]);
    const list = screen.getByRole("list", { name: "intro.tex" });
    const quotes = within(list)
      .getAllByRole("article")
      .map((article) => within(article).getAllByRole("button")[0].textContent);
    expect(quotes).toEqual(["quick", "lazy"]);
    const first = card("quick");
    expect(first).toHaveTextContent("Bob Smith");
    expect(first).toHaveTextContent("Is this word right?");
    expect(first).toHaveTextContent("3 minutes ago");
    expect(first).toHaveTextContent(copy.edited);
    expect(within(first).getByText("@Bob Smith")).toHaveAttribute("data-mention");
    const gone = screen.getByRole("list", { name: copy.detached });
    expect(gone).toHaveTextContent("a deleted sentence");
    expect(screen.getByText(copy.detachedHint)).toBeInTheDocument();
  });

  it("hides resolved threads until the filter shows them", async () => {
    const user = userEvent.setup();
    show([conversation, resolved]);
    expect(screen.queryByRole("button", { name: "fox" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.showResolved }));
    expect(screen.getByRole("button", { name: copy.hideResolved })).toHaveAttribute("aria-pressed", "true");
    expect(card("fox")).toHaveTextContent(fill(copy.resolvedBy, { name: "Bob Smith" }));
    const order = within(screen.getByRole("list", { name: "intro.tex" }))
      .getAllByRole("article")
      .map((article) => within(article).getAllByRole("button")[0].textContent);
    expect(order).toEqual(["quick", "fox"]);
  });

  it("lets viewers read without any way to write", () => {
    viewAs("viewer");
    show([conversation, resolved], { status: commentsStatus({ canComment: false }), showResolved: true });
    expect(screen.getByText("Is this word right?")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.resolve })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.reopen })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.messageActions })).not.toBeInTheDocument();
  });

  it("offers editing and deleting only on the person's own messages", async () => {
    show([conversation]);
    const thread = card("quick");
    const menus = within(thread).getAllByRole("button", { name: copy.messageActions });
    expect(menus).toHaveLength(1);
    expect(menus[0].closest("li")).toHaveTextContent("Yes, I checked");
  });

  it("replies with the members so mentions resolve, and resolves the thread", async () => {
    const user = userEvent.setup();
    mocks.collabCommentReply.mockResolvedValue(commentMessage("m-new", ALICE_ID, "Thanks"));
    mocks.collabCommentResolve.mockResolvedValue({ ...conversation, resolved: { by: ALICE_ID, at: AT, verified: true } });
    show([conversation]);
    const thread = card("quick");
    await user.type(within(thread).getByRole("textbox", { name: copy.replyLabel }), "Thanks");
    await user.click(within(thread).getByRole("button", { name: copy.reply }));
    expect(mocks.collabCommentReply).toHaveBeenCalledWith("paper", INTRO_FILE, "t-quick", "Thanks", COMMENT_MEMBERS);
    await waitFor(() => expect(card("quick")).toHaveTextContent("Thanks"));
    await user.click(within(card("quick")).getByRole("button", { name: copy.resolve }));
    expect(mocks.collabCommentResolve).toHaveBeenCalledWith("paper", INTRO_FILE, "t-quick");
    await waitFor(() => expect(screen.queryByRole("button", { name: "quick" })).not.toBeInTheDocument());
  });

  it("reopens a resolved thread", async () => {
    const user = userEvent.setup();
    mocks.collabCommentReopen.mockResolvedValue({ ...resolved, resolved: null });
    show([resolved], { showResolved: true });
    await user.click(within(card("fox")).getByRole("button", { name: copy.reopen }));
    expect(mocks.collabCommentReopen).toHaveBeenCalledWith("paper", INTRO_FILE, "t-fox");
    await waitFor(() => expect(within(card("fox")).getByRole("button", { name: copy.resolve })).toBeInTheDocument());
  });

  it("edits and deletes the person's own message", async () => {
    const user = userEvent.setup();
    mocks.collabCommentEdit.mockResolvedValue(
      commentMessage("m-alice", ALICE_ID, "Yes, checked twice", { editedAt: AT + 1 }),
    );
    mocks.collabCommentDelete.mockResolvedValue(undefined);
    show([conversation]);
    openMenu(card("quick"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: actions.edit }));
    const editor = within(card("quick")).getByRole("textbox", { name: copy.editLabel });
    expect(editor).toHaveValue("Yes, I checked @Bob Smith");
    await user.clear(editor);
    await user.type(editor, "Yes, checked twice");
    await user.click(within(card("quick")).getByRole("button", { name: actions.save }));
    expect(mocks.collabCommentEdit).toHaveBeenCalledWith(
      "paper",
      INTRO_FILE,
      "t-quick",
      "m-alice",
      "Yes, checked twice",
      COMMENT_MEMBERS,
    );
    await waitFor(() => expect(card("quick")).toHaveTextContent("Yes, checked twice"));
    openMenu(card("quick"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: actions.delete }));
    expect(mocks.collabCommentDelete).toHaveBeenCalledWith("paper", INTRO_FILE, "t-quick", "m-alice");
    await waitFor(() => expect(card("quick")).toHaveTextContent(copy.deleted));
  });

  it("deletes a thread the person started when nobody else replied", async () => {
    const user = userEvent.setup();
    const mine = commentThread("t-mine", { from: 10, to: 15 }, {
      anchor: { quote: "brown", range: { from: 10, to: 15 } },
      createdBy: ALICE_ID,
      messages: [commentMessage("m1", ALICE_ID, "Mine")],
    });
    mocks.collabCommentThreadDelete.mockResolvedValue(undefined);
    show([mine, conversation]);
    expect(within(card("quick")).queryByRole("button", { name: copy.threadActions })).not.toBeInTheDocument();
    openMenu(card("brown"), copy.threadActions);
    await user.click(await screen.findByRole("menuitem", { name: copy.deleteThread }));
    expect(mocks.collabCommentThreadDelete).toHaveBeenCalledWith("paper", INTRO_FILE, "t-mine");
  });

  it("writes a new comment on the quoted text with the keyboard", async () => {
    const user = userEvent.setup();
    mocks.collabCommentCreate.mockResolvedValue(
      commentThread("t-new", { from: 10, to: 15 }, { anchor: { quote: "brown", range: { from: 10, to: 15 } } }),
    );
    show([], { draft: { path: "chapters/intro.tex", from: 10, to: 15, quote: "brown" } });
    const composer = screen.getByRole("textbox", { name: copy.newLabel });
    expect(composer).toHaveFocus();
    expect(screen.getByRole("region", { name: copy.newLabel })).toHaveTextContent("brown");
    await user.type(composer, "Should this be red?");
    const appShortcut = vi.fn();
    window.addEventListener("keydown", appShortcut);
    await user.keyboard("{Control>}{Enter}{/Control}");
    window.removeEventListener("keydown", appShortcut);
    expect(appShortcut.mock.calls.filter(([event]) => (event as KeyboardEvent).key === "Enter")).toEqual([]);
    expect(mocks.collabCommentCreate).toHaveBeenCalledWith(
      "paper",
      "chapters/intro.tex",
      10,
      15,
      null,
      "Should this be red?",
      COMMENT_MEMBERS,
    );
    await waitFor(() => expect(screen.queryByRole("textbox", { name: copy.newLabel })).not.toBeInTheDocument());
    expect(editorFocus).toHaveBeenCalledTimes(1);
  });

  it("cancels a new comment with Escape and goes back to the text", async () => {
    const user = userEvent.setup();
    show([], { draft: { path: "chapters/intro.tex", from: 10, to: 15, quote: "brown" } });
    await user.keyboard("{Escape}");
    expect(useComments.getState().draft).toBeNull();
    expect(editorFocus).toHaveBeenCalledTimes(1);
  });

  it("moves between threads with the arrow keys and shows one in the editor", async () => {
    const user = userEvent.setup();
    show([conversation, later]);
    screen.getByRole("button", { name: "quick" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "lazy" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "quick" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(useComments.getState().selectedId).toBe("t-quick");
    expect(card("quick")).toHaveAttribute("aria-current", "true");
  });

  it("offers project members while typing @ and picks one with the keyboard", async () => {
    const user = userEvent.setup();
    show([conversation]);
    const reply = within(card("quick")).getByRole("textbox", { name: copy.replyLabel });
    await user.type(reply, "Ask @");
    const people = screen.getByRole("listbox", { name: copy.mentionList });
    expect(within(people).getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("Bob Smith"),
      expect.stringContaining("Carol Diaz"),
    ]);
    expect(reply).toHaveAttribute("aria-controls", people.id);
    await user.keyboard("{ArrowDown}");
    expect(within(people).getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(reply).toHaveAttribute("aria-activedescendant", within(people).getAllByRole("option")[1].id);
    await user.keyboard("{Enter}");
    expect(reply).toHaveValue("Ask @Carol Diaz ");
    expect(screen.queryByRole("listbox", { name: copy.mentionList })).not.toBeInTheDocument();
    await user.type(reply, "and @bo");
    expect(screen.getByRole("listbox", { name: copy.mentionList })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: copy.mentionList })).not.toBeInTheDocument();
    expect(reply).toHaveValue("Ask @Carol Diaz and @bo");
  });

  it("explains a missing file, an empty file and a failed load", async () => {
    const user = userEvent.setup();
    const { unmount } = show([], { path: null });
    expect(screen.getByText(copy.noFile)).toBeInTheDocument();
    unmount();
    const second = show([]);
    expect(screen.getByText(copy.emptyCanWrite)).toBeInTheDocument();
    second.unmount();
    mocks.collabCommentThreadList.mockResolvedValue(threadList([conversation]));
    useFilesStore.setState({ projectId: "paper", activePath: "chapters/intro.tex" });
    show([], { phase: "failed", error: "unreachable" });
    expect(screen.getByText(copy.loadFailed)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: actions.retry }));
    expect(mocks.collabCommentThreadList).toHaveBeenCalledWith("paper", "chapters/intro.tex");
  });

  it("scrolls a thread into view when the editor opens it", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    show([conversation, later]);
    act(() => useComments.setState((state) => ({ selectedId: "t-lazy", focus: state.focus + 1 })));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(card("lazy"));
  });

  it("shows a message it could not verify without the claimed name or any way to change it", () => {
    const forged = commentThread("t-forged", { from: 4, to: 9 }, {
      anchor: { quote: "quick", range: { from: 4, to: 9 } },
      messages: [
        commentMessage("m-bob", BOB_ID, "Real question"),
        commentMessage("m-fake", ALICE_ID, "I agree with everything", { verified: false }),
      ],
    });
    show([forged]);
    const fake = within(card("quick")).getByText("I agree with everything").closest("li") as HTMLElement;
    expect(fake).not.toHaveTextContent("Alice Chen");
    expect(within(fake).queryByRole("button", { name: copy.messageActions })).not.toBeInTheDocument();
    expect(fake).toHaveTextContent(copy.unverifiedAuthor);
    const real = within(card("quick")).getByText("Real question").closest("li") as HTMLElement;
    expect(real).toHaveTextContent("Bob Smith");
  });

  it("never names a creator or resolver it could not verify", () => {
    const doubtful = commentThread("t-doubt", { from: 16, to: 19 }, {
      anchor: { quote: "fox", range: { from: 16, to: 19 } },
      createdBy: ALICE_ID,
      verified: false,
      messages: [commentMessage("m1", ALICE_ID, "Done?", { verified: false })],
      resolved: { by: BOB_ID, at: AT, verified: false },
    });
    show([doubtful], { showResolved: true });
    const article = card("fox");
    expect(article).not.toHaveTextContent("Bob Smith");
    expect(within(article).queryByRole("button", { name: copy.threadActions })).not.toBeInTheDocument();
    expect(article).toHaveTextContent(copy.resolvedUnverified);
    expect(article).toHaveAccessibleName(copy.unverifiedThread);
  });

  it("explains a refusal next to the action that caused it", async () => {
    const user = userEvent.setup();
    const mine = commentThread("t-mine", { from: 10, to: 15 }, {
      anchor: { quote: "brown", range: { from: 10, to: 15 } },
      createdBy: ALICE_ID,
      messages: [commentMessage("m1", ALICE_ID, "Mine")],
    });
    mocks.collabCommentThreadDelete.mockRejectedValue({ code: "comment_someone_replied", message: "" });
    mocks.collabCommentReply.mockRejectedValue({ code: "comment_too_long", message: "" });
    mocks.collabCommentEdit.mockRejectedValue({ code: "comment_message_deleted", message: "" });
    show([mine]);
    openMenu(card("brown"), copy.threadActions);
    await user.click(await screen.findByRole("menuitem", { name: copy.deleteThread }));
    const alerts = () => within(card("brown")).queryAllByRole("alert").map((alert) => alert.textContent);
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]).toBe(copy.refusals.someoneReplied);
    await user.type(within(card("brown")).getByRole("textbox", { name: copy.replyLabel }), "Long");
    await user.click(within(card("brown")).getByRole("button", { name: copy.reply }));
    await waitFor(() => expect(alerts()).toContain(copy.refusals.tooLong));
    openMenu(card("brown"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: actions.edit }));
    await user.click(within(card("brown")).getByRole("button", { name: actions.save }));
    await waitFor(() => expect(alerts()).toContain(copy.refusals.messageDeleted));
  });

  it("explains under its box why a new comment was not posted", async () => {
    const user = userEvent.setup();
    mocks.collabCommentCreate.mockRejectedValue({ code: "comment_off_project", message: "" });
    show([], { draft: { path: "chapters/intro.tex", from: 10, to: 15, quote: "brown" } });
    await user.type(screen.getByRole("textbox", { name: copy.newLabel }), "Red?");
    await user.click(screen.getByRole("button", { name: copy.post }));
    const region = screen.getByRole("region", { name: copy.newLabel });
    await waitFor(() => expect(within(region).getByRole("alert")).toHaveTextContent(copy.refusals.offProject));
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import type { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import { loadNamespace } from "@/i18n";
import { formatDateTime } from "@/lib/intl";
import { useCommentsRail } from "@/components/collab/comments-rail";
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
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

import { useComments } from "./comments-store";
import { CommentsPane } from "./CommentsPane";

const copy = enCollab.comments;
const actions = enCommon.actions;

async function confirmDelete(title: string, confirm: string) {
  const dialog = await screen.findByRole("alertdialog", { name: title });
  fireEvent.click(within(dialog).getByRole("button", { name: confirm }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
}
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
    counts: [],
    elsewhere: {},
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
  useComments.setState({
    projectId: null,
    status: null,
    path: null,
    threads: [],
    phase: "idle",
    draft: null,
    selectedId: null,
    counts: null,
    elsewhere: {},
  });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
  useCommentsRail.setState({ reveal: null });
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

  it("shows exact times and the jump hint in app tooltips, by pointer or keyboard, never in native titles", async () => {
    const user = userEvent.setup();
    const { container } = show([conversation]);
    expect(container.querySelector("[title]")).toBeNull();
    const first = card("quick");
    const times = first.querySelectorAll("time");
    await user.hover(times[0] as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(formatDateTime(AT - 120_000));
    await user.unhover(times[0] as HTMLElement);
    await user.hover(within(first).getByText(copy.edited));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(formatDateTime(AT));
    await user.unhover(within(first).getByText(copy.edited));
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    const quote = screen.getByRole("button", { name: "quick" });
    fireEvent.keyDown(document, { key: "Tab" });
    act(() => quote.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(copy.showInEditor);
    expect(quote).toHaveAccessibleDescription(copy.showInEditor);
  });

  it("moves a thread to Detached as soon as its text is gone from the editor, before the server says so", () => {
    show([later, conversation], { emptied: ["t-quick"] });
    const list = screen.getByRole("list", { name: "intro.tex" });
    expect(within(list).getAllByRole("article")).toHaveLength(1);
    expect(list).toHaveTextContent("lazy");
    const gone = screen.getByRole("list", { name: copy.detached });
    expect(gone).toHaveTextContent("quick");
    expect(screen.getByRole("button", { name: copy.detached })).toHaveTextContent("1");
    act(() => useComments.setState({ emptied: [] }));
    expect(screen.queryByRole("list", { name: copy.detached })).toBeNull();
    expect(within(screen.getByRole("list", { name: "intro.tex" })).getAllByRole("article")).toHaveLength(2);
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

  it("sends Resolve once for a double click", async () => {
    const user = userEvent.setup();
    let finish: (thread: CollabCommentThread) => void = () => undefined;
    mocks.collabCommentResolve.mockReturnValue(
      new Promise<CollabCommentThread>((resolve) => {
        finish = resolve;
      }),
    );
    show([conversation]);
    const button = within(card("quick")).getByRole("button", { name: copy.resolve });
    await user.dblClick(button);
    expect(mocks.collabCommentResolve).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => finish({ ...conversation, resolved: { by: ALICE_ID, at: AT, verified: true } }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "quick" })).not.toBeInTheDocument());
    expect(mocks.collabCommentResolve).toHaveBeenCalledTimes(1);
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
    await confirmDelete(copy.deleteMessageConfirm.title, actions.delete);
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
    const dialog = await screen.findByRole("alertdialog", { name: copy.deleteThreadConfirm.title });
    expect(dialog).toHaveTextContent(copy.deleteThreadConfirm.description);
    expect(mocks.collabCommentThreadDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`^${actions.cancel}`) }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.collabCommentThreadDelete).not.toHaveBeenCalled();
    openMenu(card("brown"), copy.threadActions);
    await user.click(await screen.findByRole("menuitem", { name: copy.deleteThread }));
    await confirmDelete(copy.deleteThreadConfirm.title, copy.deleteThread);
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

  it("explains a project with no comments, with or without a file open, and a failed load", async () => {
    const user = userEvent.setup();
    const { unmount } = show([], { path: null });
    expect(screen.getByText(copy.emptyCanWrite)).toBeInTheDocument();
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
    await confirmDelete(copy.deleteThreadConfirm.title, copy.deleteThread);
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

describe("comments across the project", () => {
  const cite = commentThread("t-cite", { from: 2, to: 6 }, {
    fileId: "file-refs",
    anchor: { quote: "cite", range: { from: 2, to: 6 } },
  });

  function regions(): (string | null)[] {
    return screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
  }

  it("shows one plain message and no file section when the project has no comments", () => {
    expect(copy.emptyCanWrite).toBe(
      "No comments or suggestions yet. Select some text and choose Add comment to start one.",
    );
    show([], { counts: [] });
    expect(screen.getByText(copy.emptyCanWrite)).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toEqual([]);
    expect(screen.queryByRole("button", { name: "intro.tex" })).toBeNull();
  });

  it("tells people who cannot comment only that there are no comments yet", () => {
    expect(copy.empty).toBe("No comments or suggestions yet.");
    viewAs("viewer");
    show([], { status: commentsStatus({ canComment: false }), counts: [] });
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyCanWrite)).toBeNull();
    expect(screen.queryAllByRole("region")).toEqual([]);
  });

  it("says every comment is resolved, with no section, when all of them are hidden as resolved", async () => {
    const user = userEvent.setup();
    expect(copy.allResolved).toBe("All comments are resolved.");
    show([resolved], {
      counts: [
        { path: "chapters/intro.tex", open: 0, resolved: 1 },
        { path: "old.tex", open: 0, resolved: 2 },
      ],
    });
    expect(screen.getByText(copy.allResolved)).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyCanWrite)).toBeNull();
    expect(screen.queryAllByRole("region")).toEqual([]);
    expect(screen.getByRole("button", { name: copy.showResolved })).toHaveTextContent("3");
    await user.click(screen.getByRole("button", { name: copy.showResolved }));
    expect(screen.queryByText(copy.allResolved)).toBeNull();
    expect(regions()).toEqual(["intro.tex", "old.tex"]);
  });

  it("says every comment is resolved to people who cannot comment too, even with no file open", () => {
    viewAs("viewer");
    show([], {
      path: null,
      status: commentsStatus({ canComment: false }),
      counts: [{ path: "old.tex", open: 0, resolved: 1 }],
    });
    expect(screen.getByText(copy.allResolved)).toBeInTheDocument();
    expect(screen.queryByText(copy.empty)).toBeNull();
    expect(screen.queryAllByRole("region")).toEqual([]);
  });

  it("shows no section for the open file without comments and a folded one for another file that has some", async () => {
    show([], { counts: [{ path: "appendix/refs.tex", open: 2, resolved: 0 }] });
    expect(regions()).toEqual(["refs.tex"]);
    const header = screen.getByRole("button", { name: "refs.tex" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("2");
    expect(within(header).getByText("refs.tex")).not.toHaveAttribute("title");
    fireEvent.mouseEnter(within(header).getByText("refs.tex"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("appendix/refs.tex");
    expect(screen.queryByText(copy.emptyCanWrite)).toBeNull();
    expect(mocks.collabCommentThreadList).not.toHaveBeenCalled();
  });

  it("puts the open file first and expanded, and counts resolved threads only while they are shown", async () => {
    const user = userEvent.setup();
    show([conversation, resolved], {
      counts: [
        { path: "abstract.tex", open: 1, resolved: 0 },
        { path: "chapters/intro.tex", open: 1, resolved: 1 },
        { path: "old.tex", open: 0, resolved: 2 },
      ],
    });
    expect(regions()).toEqual(["intro.tex", "abstract.tex"]);
    const intro = screen.getByRole("button", { name: "intro.tex" });
    expect(intro).toHaveAttribute("aria-expanded", "true");
    expect(intro).toHaveTextContent("1");
    expect(within(intro).getByText("intro.tex")).not.toHaveAttribute("title");
    expect(screen.getByRole("button", { name: "abstract.tex" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: copy.showResolved })).toHaveTextContent("3");
    await user.click(screen.getByRole("button", { name: copy.showResolved }));
    expect(regions()).toEqual(["intro.tex", "abstract.tex", "old.tex"]);
    expect(screen.getByRole("button", { name: "intro.tex" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "old.tex" })).toHaveTextContent("2");
  });

  it("lists another file's threads when its section is expanded and opens that file at the chosen comment", async () => {
    const user = userEvent.setup();
    const openFile = vi.fn().mockResolvedValue(undefined);
    const original = useFilesStore.getState().openFile;
    useFilesStore.setState({ projectId: "paper", activePath: "chapters/intro.tex", openFile });
    mocks.collabCommentThreadList.mockResolvedValue(threadList([cite]));
    try {
      show([conversation], {
        counts: [
          { path: "appendix/refs.tex", open: 1, resolved: 0 },
          { path: "chapters/intro.tex", open: 1, resolved: 0 },
        ],
      });
      await user.click(screen.getByRole("button", { name: "refs.tex" }));
      expect(mocks.collabCommentThreadList).toHaveBeenCalledWith("paper", "appendix/refs.tex");
      const list = await screen.findByRole("list", { name: "refs.tex" });
      expect(screen.getByRole("button", { name: "refs.tex" })).toHaveAttribute("aria-expanded", "true");
      await user.click(within(list).getByRole("button", { name: "cite" }));
      expect(openFile).toHaveBeenCalledWith("appendix/refs.tex");
      expect(useCommentsRail.getState().reveal).toEqual({ path: "appendix/refs.tex", threadId: "t-cite" });
      expect(useComments.getState().selectedId).toBeNull();
      await user.click(screen.getByRole("button", { name: "refs.tex" }));
      expect(screen.queryByRole("list", { name: "refs.tex" })).toBeNull();
      expect(useComments.getState().elsewhere).toEqual({});
    } finally {
      useFilesStore.setState({ openFile: original });
    }
  });
});

describe("quoted text", () => {
  function measureQuotes(scroll: number, client: number) {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.quoteText === undefined ? 0 : scroll;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.quoteText === undefined ? 0 : client;
    });
  }

  it("sits in a tinted block with a quote mark instead of a bar on the left", () => {
    show([conversation]);
    const jump = screen.getByRole("button", { name: "quick" });
    const quote = jump.closest('[data-slot="comment-quote"]') as HTMLElement;
    expect(quote).not.toBeNull();
    expect(quote.className).not.toMatch(/border-l/);
    expect(jump.className).not.toMatch(/border-l|italic/);
    expect(quote).toHaveClass("rounded-md");
    expect(quote.querySelector("svg.lucide-quote")).toHaveAttribute("aria-hidden", "true");
    expect(jump.textContent).toBe("quick");
  });

  it("uses the same quote block for the text a new comment is about", () => {
    show([], { draft: { path: "chapters/intro.tex", from: 10, to: 15, quote: "brown" } });
    const region = screen.getByRole("region", { name: copy.newLabel });
    const quote = region.querySelector('[data-slot="comment-quote"]') as HTMLElement;
    expect(quote).toHaveTextContent("brown");
    expect(quote.className).not.toMatch(/border-l/);
    expect(region.querySelector(".border-l-2")).toBeNull();
  });

  it("clamps a long quote to three lines and offers to show all of it", async () => {
    const long = "A sentence that runs on for a long time. ".repeat(12).trim();
    const thread = commentThread("t-long", { from: 0, to: long.length }, {
      anchor: { quote: long, range: { from: 0, to: long.length } },
    });
    measureQuotes(120, 48);
    const user = userEvent.setup();
    show([thread]);
    const text = document.querySelector("[data-quote-text]") as HTMLElement;
    expect(text).toHaveClass("line-clamp-3");
    const more = within(card(long)).getByRole("button", { name: actions.showMore });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(text).not.toHaveClass("line-clamp-3");
    const less = within(card(long)).getByRole("button", { name: actions.showLess });
    expect(less).toHaveAttribute("aria-expanded", "true");
    await user.click(less);
    expect(text).toHaveClass("line-clamp-3");
  });

  it("offers no toggle for a quote that fits", () => {
    measureQuotes(32, 48);
    show([conversation]);
    expect(within(card("quick")).queryByRole("button", { name: actions.showMore })).toBeNull();
  });
});

describe("people who left and loads that failed", () => {
  it("names a writer, creator and resolver who are no longer members as an unknown person", () => {
    const LEFT = "0192a0b0-0000-7000-8000-0000000000ff";
    const orphan = commentThread("t-left", { from: 16, to: 19 }, {
      anchor: { quote: "fox", range: { from: 16, to: 19 } },
      createdBy: LEFT,
      messages: [commentMessage("m-left", LEFT, "Old note")],
      resolved: { by: LEFT, at: AT, verified: true },
    });
    show([orphan], { showResolved: true });
    const article = card("fox");
    expect(article).toHaveTextContent("Old note");
    expect(within(article).getAllByText(enCollab.toolbar.unknownPerson).length).toBeGreaterThan(0);
    expect(article).not.toHaveTextContent("Bob Smith");
  });

  it("explains why the person's own message could not be deleted", async () => {
    const user = userEvent.setup();
    mocks.collabCommentDelete.mockRejectedValue({ code: "comment_message_deleted", message: "" });
    show([conversation]);
    openMenu(card("quick"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: actions.delete }));
    await confirmDelete(copy.deleteMessageConfirm.title, actions.delete);
    await waitFor(() => expect(within(card("quick")).getByRole("alert")).toHaveTextContent(copy.refusals.messageDeleted));
    expect(card("quick")).toHaveTextContent("Yes, I checked @Bob Smith");
  });

  it("shows why another file's comments did not load and loads them again on retry", async () => {
    const user = userEvent.setup();
    mocks.collabCommentThreadList.mockReturnValue(new Promise(() => undefined));
    show([conversation], {
      counts: [
        { path: "appendix/refs.tex", open: 1, resolved: 0 },
        { path: "appendix/notes.tex", open: 2, resolved: 0 },
        { path: "chapters/intro.tex", open: 1, resolved: 0 },
      ],
      elsewhere: {
        "appendix/refs.tex": { phase: "failed", error: "unreachable", threads: [] },
        "appendix/notes.tex": { phase: "failed", error: null, threads: [] },
      },
    });
    expect(screen.getAllByText(copy.loadFailed)).toHaveLength(2);
    expect(screen.getByText(enCollab.errors.unreachable)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.internal)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: actions.retry })[0]);
    expect(mocks.collabCommentThreadList).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(copy.loadFailed)).toHaveLength(1);
  });

  it("says something went wrong when the open file failed to load without a reason", () => {
    show([conversation], { phase: "failed", error: null });
    expect(screen.getByText(copy.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.internal)).toBeInTheDocument();
  });

  it("folds the open file's threads away and back from its header", async () => {
    const user = userEvent.setup();
    show([conversation]);
    const header = screen.getByRole("button", { name: "intro.tex" });
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "intro.tex" })).toBeNull();
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "intro.tex" })).toBeInTheDocument();
  });
});

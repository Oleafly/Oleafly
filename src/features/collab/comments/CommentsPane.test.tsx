// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
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
  collabCommentRemove: vi.fn(),
  collabPresenceActivity: vi.fn(async () => undefined),
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

function show(threads: CollabCommentThread[], overrides: Partial<ReturnType<typeof useComments.getState>> = {}, strict = false) {
  useComments.setState({
    projectId: "paper",
    status: commentsStatus(),
    path: "chapters/intro.tex",
    threads,
    phase: "ready",
    error: null,
    selectedId: null,
    filter: "open",
    refused: [],
    draft: null,
    counts: [],
    elsewhere: {},
    ...overrides,
  });
  return render(strict ? <StrictMode><CommentsPane /></StrictMode> : <CommentsPane />);
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

function entry(id: string) {
  return document.querySelector(`[data-comment-entry="${id}"]`) as HTMLElement;
}

function resolvedCard(quote: string) {
  return screen.getByText(quote).closest("article") as HTMLElement;
}

function filterButton(value: string) {
  return screen.getByRole("button", { name: fill(copy.filter, { value }) });
}

async function pickFilter(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  fireEvent.keyDown(filterButton(from), { key: "Enter" });
  await user.click(await screen.findByRole("menuitemcheckbox", { name: new RegExp(`^${to}`) }));
}

function headerCount() {
  return screen.getByTestId("comments-pane").querySelector("header")?.textContent;
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
    await user.hover(within(first).getByText(`· ${copy.edited}`));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(formatDateTime(AT));
    await user.unhover(within(first).getByText(`· ${copy.edited}`));
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

  it("hides resolved threads until the filter shows them, folded to one line until opened", async () => {
    const user = userEvent.setup();
    show([conversation, resolved]);
    expect(screen.queryByText("fox")).not.toBeInTheDocument();
    await pickFilter(user, copy.filterOpen, copy.filterAll);
    expect(filterButton(copy.filterAll)).toBeInTheDocument();
    const fox = resolvedCard("fox");
    expect(fox).toHaveTextContent(fill(copy.resolvedBy, { name: "Bob Smith" }));
    expect(within(fox).queryByRole("button", { name: "fox" })).toBeNull();
    const order = within(screen.getByRole("list", { name: "intro.tex" }))
      .getAllByRole("article")
      .map((article) => article.dataset.commentThread);
    expect(order).toEqual(["t-quick", "t-fox"]);
    const summary = within(fox).getByRole("button", { name: new RegExp(fill(copy.resolvedBy, { name: "Bob Smith" })) });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(within(fox).getByRole("button", { name: "fox" })).toBeInTheDocument();
    expect(within(fox).queryByRole("button", { name: copy.reply })).toBeNull();
  });

  it("lets viewers read without any way to write, leaving them only the thread link", async () => {
    viewAs("viewer");
    show([conversation, resolved], { status: commentsStatus({ canComment: false }), filter: "all" });
    expect(screen.getByText("Is this word right?")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.resolve })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.reopen })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.reply })).not.toBeInTheDocument();
    const menus = screen.getAllByRole("button", { name: copy.messageActions });
    expect(menus).toHaveLength(1);
    fireEvent.keyDown(menus[0], { key: "Enter" });
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([copy.copyLink]);
  });

  it("offers editing and deleting only on the person's own messages", async () => {
    const user = userEvent.setup();
    show([conversation]);
    openMenu(entry("m-bob"), copy.messageActions);
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([
      copy.copyLink,
      copy.resolve,
    ]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    openMenu(entry("m-alice"), copy.messageActions);
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([
      actions.edit,
      actions.delete,
    ]);
  });

  it("replies with the members so mentions resolve, and resolves the thread", async () => {
    const user = userEvent.setup();
    mocks.collabCommentReply.mockResolvedValue(commentMessage("m-new", ALICE_ID, "Thanks"));
    mocks.collabCommentResolve.mockResolvedValue({ ...conversation, resolved: { by: ALICE_ID, at: AT, verified: true } });
    show([conversation]);
    const thread = card("quick");
    expect(within(thread).queryByRole("textbox")).toBeNull();
    await user.click(within(thread).getAllByRole("button", { name: copy.reply })[0]);
    const reply = within(thread).getByRole("textbox", { name: copy.replyLabel });
    expect(reply).toHaveValue("@Bob Smith ");
    expect(reply).toHaveFocus();
    await user.type(reply, "Thanks");
    await user.click(within(thread).getByRole("button", { name: copy.send }));
    expect(mocks.collabCommentReply).toHaveBeenCalledWith(
      "paper",
      INTRO_FILE,
      "t-quick",
      "@Bob Smith Thanks",
      COMMENT_MEMBERS,
    );
    await waitFor(() => expect(card("quick")).toHaveTextContent("Thanks"));
    await user.click(within(card("quick")).getByRole("button", { name: copy.resolve }));
    expect(mocks.collabCommentResolve).toHaveBeenCalledWith("paper", INTRO_FILE, "t-quick");
    await waitFor(() => expect(screen.queryByRole("button", { name: "quick" })).not.toBeInTheDocument());
  });

  it("reopens a resolved thread", async () => {
    const user = userEvent.setup();
    mocks.collabCommentReopen.mockResolvedValue({ ...resolved, resolved: null });
    show([resolved], { filter: "all" });
    await user.click(within(resolvedCard("fox")).getByRole("button", { name: copy.reopen }));
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
    expect(button).toHaveAttribute("aria-disabled", "true");
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
    openMenu(entry("m-alice"), copy.messageActions);
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
    openMenu(entry("m-alice"), copy.messageActions);
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
    openMenu(entry("m-alice"), copy.messageActions);
    expect(await screen.findByRole("menuitem", { name: actions.edit })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: copy.deleteThread })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    openMenu(card("brown"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: copy.deleteThread }));
    const dialog = await screen.findByRole("alertdialog", { name: copy.deleteThreadConfirm.title });
    expect(dialog).toHaveTextContent(copy.deleteThreadConfirm.description);
    expect(mocks.collabCommentThreadDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`^${actions.cancel}`) }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.collabCommentThreadDelete).not.toHaveBeenCalled();
    openMenu(card("brown"), copy.messageActions);
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
    await user.click(within(card("quick")).getAllByRole("button", { name: copy.reply })[1]);
    const reply = within(card("quick")).getByRole("textbox", { name: copy.replyLabel });
    expect(reply).toHaveValue("");
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
    expect(screen.getByText(copy.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(/choose Add comment, or press/u)).toBeInTheDocument();
    unmount();
    const second = show([]);
    expect(screen.getByText(/choose Add comment, or press/u)).toBeInTheDocument();
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
    show([doubtful], { filter: "all" });
    const article = resolvedCard("fox");
    expect(article).not.toHaveTextContent("Bob Smith");
    expect(within(article).queryByRole("button", { name: copy.messageActions })).not.toBeInTheDocument();
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
    openMenu(card("brown"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: copy.deleteThread }));
    await confirmDelete(copy.deleteThreadConfirm.title, copy.deleteThread);
    const alerts = () => within(card("brown")).queryAllByRole("alert").map((alert) => alert.textContent);
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(alerts()[0]).toBe(copy.refusals.someoneReplied);
    await user.click(within(card("brown")).getByRole("button", { name: copy.reply }));
    await user.type(within(card("brown")).getByRole("textbox", { name: copy.replyLabel }), "Long");
    await user.click(within(card("brown")).getByRole("button", { name: copy.send }));
    await waitFor(() => expect(alerts()).toContain(`${copy.notSentShort}${copy.refusals.tooLong}`));
    openMenu(card("brown"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: actions.edit }));
    await user.click(within(card("brown")).getByRole("button", { name: actions.save }));
    await waitFor(() => expect(alerts()).toContain(`${copy.notSentShort}${copy.refusals.messageDeleted}`));
  });

  it("explains under its box why a new comment it can fix was not posted", async () => {
    const user = userEvent.setup();
    mocks.collabCommentCreate.mockRejectedValue({ code: "comment_too_long", message: "" });
    show([], { draft: { path: "chapters/intro.tex", from: 10, to: 15, quote: "brown" } });
    await user.type(screen.getByRole("textbox", { name: copy.newLabel }), "Red?");
    await user.click(screen.getByRole("button", { name: copy.send }));
    const region = screen.getByRole("region", { name: copy.newLabel });
    await waitFor(() => expect(within(region).getByRole("alert")).toHaveTextContent(copy.refusals.tooLong));
  });

  it("folds two or more replies behind a count and opens them in place", async () => {
    const user = userEvent.setup();
    const busy = commentThread("t-busy", { from: 4, to: 9 }, {
      anchor: { quote: "quick", range: { from: 4, to: 9 } },
      messages: [
        commentMessage("m-1", BOB_ID, "First"),
        commentMessage("m-2", ALICE_ID, "Second"),
        commentMessage("m-3", CAROL.account_id, "Third"),
      ],
    });
    show([busy]);
    const thread = card("quick");
    expect(within(thread).getByText("First")).toBeInTheDocument();
    expect(within(thread).queryByText("Second")).toBeNull();
    const toggle = within(thread).getByRole("button", { name: new RegExp(fill(copy.replies, { number: "2" })) });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(within(thread).getByText("Third")).toBeInTheDocument();
    await user.click(within(thread).getByRole("button", { name: new RegExp(copy.hideReplies) }));
    expect(within(thread).queryByText("Third")).toBeNull();
  });

  it("resolves every open thread in the open file after asking", async () => {
    const user = userEvent.setup();
    mocks.collabCommentResolve.mockImplementation(async (_project: string, _file: string, id: string) => ({
      ...(id === "t-quick" ? conversation : later),
      resolved: { by: ALICE_ID, at: AT, verified: true },
    }));
    show([conversation, later, resolved]);
    expect(headerCount()).toContain("2");
    await user.click(screen.getByRole("button", { name: copy.resolveAll }));
    const dialog = await screen.findByRole("alertdialog", {
      name: fill(copy.resolveAllConfirm.title, { file: "intro.tex" }),
    });
    expect(dialog).toHaveTextContent(fill(copy.resolveAllConfirm.description, { number: "2" }));
    expect(mocks.collabCommentResolve).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`^${copy.resolveAllConfirm.confirm}`) }));
    await waitFor(() => expect(mocks.collabCommentResolve).toHaveBeenCalledTimes(2));
    expect(mocks.collabCommentResolve.mock.calls.map((call) => call[2])).toEqual(["t-quick", "t-lazy"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "quick" })).toBeNull());
  });

  it("offers no resolve all to people who cannot comment", () => {
    viewAs("viewer");
    show([conversation], { status: commentsStatus({ canComment: false }) });
    expect(screen.queryByRole("button", { name: copy.resolveAll })).toBeNull();
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
    expect(copy.emptyTitle).toBe("No comments yet");
    show([], { counts: [] });
    expect(screen.getByText(copy.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(/choose Add comment, or press/u).querySelectorAll("kbd")).toHaveLength(3);
    expect(screen.queryAllByRole("region")).toEqual([]);
    expect(screen.queryByRole("button", { name: "intro.tex" })).toBeNull();
  });

  it("tells people who cannot comment only that there are no comments yet", () => {
    viewAs("viewer");
    show([], { status: commentsStatus({ canComment: false }), counts: [] });
    expect(screen.getByText(copy.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByText(/choose Add comment, or press/u)).toBeNull();
    expect(screen.getByText(copy.readOnlyNote)).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toEqual([]);
  });

  it("says every comment is resolved, with no section, when all of them are hidden as resolved", async () => {
    const user = userEvent.setup();
    expect(copy.allResolved).toBe("All comments are resolved.");
    show([resolved], {
      counts: [
        { path: "chapters/intro.tex", open: 0, resolved: 1, waiting: 0 },
        { path: "old.tex", open: 0, resolved: 2, waiting: 0 },
      ],
    });
    expect(screen.getByText(copy.allResolved)).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyTitle)).toBeNull();
    expect(screen.queryAllByRole("region")).toEqual([]);
    expect(headerCount()).toContain("0");
    fireEvent.keyDown(filterButton(copy.filterOpen), { key: "Enter" });
    expect(await screen.findByRole("menuitemcheckbox", { name: new RegExp(`^${copy.filterAll}`) })).toHaveTextContent("3");
    await user.click(screen.getByRole("menuitemcheckbox", { name: new RegExp(`^${copy.filterAll}`) }));
    expect(screen.queryByText(copy.allResolved)).toBeNull();
    expect(regions()).toEqual(["intro.tex", "old.tex"]);
  });

  it("says every comment is resolved to people who cannot comment too, even with no file open", () => {
    viewAs("viewer");
    show([], {
      path: null,
      status: commentsStatus({ canComment: false }),
      counts: [{ path: "old.tex", open: 0, resolved: 1, waiting: 0 }],
    });
    expect(screen.getByText(copy.allResolved)).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyTitle)).toBeNull();
    expect(screen.queryAllByRole("region")).toEqual([]);
  });

  it("shows no section for the open file without comments and a folded one for another file that has some", async () => {
    show([], { counts: [{ path: "appendix/refs.tex", open: 2, resolved: 0, waiting: 0 }] });
    expect(regions()).toEqual(["refs.tex"]);
    const header = screen.getByRole("button", { name: "refs.tex" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("2");
    expect(within(header).getByText("refs.tex")).not.toHaveAttribute("title");
    fireEvent.mouseEnter(within(header).getByText("refs.tex"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("appendix/refs.tex");
    expect(screen.queryByText(copy.emptyTitle)).toBeNull();
    expect(mocks.collabCommentThreadList).not.toHaveBeenCalled();
  });

  it("puts the open file first and expanded, and counts resolved threads only while they are shown", async () => {
    const user = userEvent.setup();
    show([conversation, resolved], {
      counts: [
        { path: "abstract.tex", open: 1, resolved: 0, waiting: 0 },
        { path: "chapters/intro.tex", open: 1, resolved: 1, waiting: 0 },
        { path: "old.tex", open: 0, resolved: 2, waiting: 0 },
      ],
    });
    expect(regions()).toEqual(["intro.tex", "abstract.tex"]);
    const intro = screen.getByRole("button", { name: "intro.tex" });
    expect(intro).toHaveAttribute("aria-expanded", "true");
    expect(intro).toHaveTextContent("1");
    expect(within(intro).getByText("intro.tex")).not.toHaveAttribute("title");
    expect(screen.getByRole("button", { name: "abstract.tex" })).toHaveAttribute("aria-expanded", "false");
    expect(headerCount()).toContain("2");
    fireEvent.keyDown(filterButton(copy.filterOpen), { key: "Enter" });
    expect(await screen.findByRole("menuitemcheckbox", { name: new RegExp(`^${copy.filterOpen}`) })).toHaveTextContent("2");
    await user.click(await screen.findByRole("menuitemcheckbox", { name: new RegExp(`^${copy.filterAll}`) }));
    expect(headerCount()).toContain("5");
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
          { path: "appendix/refs.tex", open: 1, resolved: 0, waiting: 0 },
          { path: "chapters/intro.tex", open: 1, resolved: 0, waiting: 0 },
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
    expect(text).toHaveClass("line-clamp-2");
    const more = within(card(long)).getByRole("button", { name: actions.showMore });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(text).not.toHaveClass("line-clamp-2");
    const less = within(card(long)).getByRole("button", { name: actions.showLess });
    expect(less).toHaveAttribute("aria-expanded", "true");
    await user.click(less);
    expect(text).toHaveClass("line-clamp-2");
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
    show([orphan], { filter: "all" });
    const article = resolvedCard("fox");
    expect(article).toHaveTextContent("Old note");
    fireEvent.click(within(article).getByRole("button", { expanded: false }));
    expect(within(article).getAllByText(enCollab.toolbar.unknownPerson).length).toBeGreaterThan(0);
    expect(article).not.toHaveTextContent("Bob Smith");
  });

  it("explains why the person's own message could not be deleted", async () => {
    const user = userEvent.setup();
    mocks.collabCommentDelete.mockRejectedValue({ code: "comment_message_deleted", message: "" });
    show([conversation]);
    openMenu(entry("m-alice"), copy.messageActions);
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
        { path: "appendix/refs.tex", open: 1, resolved: 0, waiting: 0 },
        { path: "appendix/notes.tex", open: 2, resolved: 0, waiting: 0 },
        { path: "chapters/intro.tex", open: 1, resolved: 0, waiting: 0 },
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

  it("marks another file's section busy while its comments load, so the list waits for them before it settles", () => {
    show([conversation], {
      counts: [
        { path: "appendix/refs.tex", open: 1, resolved: 0, waiting: 0 },
        { path: "chapters/intro.tex", open: 1, resolved: 0, waiting: 0 },
      ],
      elsewhere: { "appendix/refs.tex": { phase: "loading", error: null, threads: [] } },
    });
    expect(screen.getByRole("region", { name: "refs.tex" })).toHaveAttribute("aria-busy", "true");
    act(() => useComments.setState({ elsewhere: { "appendix/refs.tex": { phase: "ready", error: null, threads: [detached] } } }));
    expect(screen.getByRole("region", { name: "refs.tex" })).not.toHaveAttribute("aria-busy", "true");
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

describe("live comment states", () => {
  it("lets the project owner remove someone else's comment, which then reads as removed by a moderator", async () => {
    const user = userEvent.setup();
    viewAs("owner");
    mocks.collabCommentRemove.mockResolvedValue(undefined);
    show([conversation]);
    openMenu(entry("m-bob"), copy.messageActions);
    await user.click(await screen.findByRole("menuitem", { name: copy.remove }));
    await confirmDelete(copy.removeConfirm.title, copy.removeConfirm.confirm);
    expect(mocks.collabCommentRemove).toHaveBeenCalledWith("paper", INTRO_FILE, "t-quick", "m-bob");
    expect(entry("m-bob")).toHaveTextContent(copy.removed);
    expect(entry("m-alice")).toHaveTextContent("Yes, I checked");
  });

  it("offers no Remove to anyone but the owner", () => {
    show([conversation]);
    openMenu(entry("m-bob"), copy.messageActions);
    expect(screen.queryByRole("menuitem", { name: copy.remove })).toBeNull();
  });

  it("keeps a reply the server refuses in its thread as Not sent, with Discard", async () => {
    const user = userEvent.setup();
    mocks.collabCommentReply.mockRejectedValue({ code: "comment_off_project", message: "" });
    show([conversation]);
    await user.click(within(card("quick")).getAllByRole("button", { name: copy.reply })[0]);
    await user.type(within(card("quick")).getByRole("textbox", { name: copy.replyLabel }), "Figure 2 first?");
    await user.click(within(card("quick")).getByRole("button", { name: copy.send }));
    const row = await within(card("quick")).findByText(/Figure 2 first\?/u);
    const item = row.closest("[data-comment-entry]") as HTMLElement;
    expect(item).toHaveAttribute("data-delivery", "failed");
    expect(item).toHaveTextContent(`${copy.notSentShort} ${copy.refusals.offProject}`);
    expect(within(card("quick")).queryByRole("textbox", { name: copy.replyLabel })).toBeNull();
    await user.click(within(item).getByRole("button", { name: copy.discard }));
    expect(within(card("quick")).queryByText(/Figure 2 first\?/u)).toBeNull();
  });

  it("marks comments the server hasn't acknowledged and counts them while the server can't be reached", () => {
    const waiting = commentThread("t-quick", { from: 4, to: 9 }, {
      anchor: { quote: "quick", range: { from: 4, to: 9 } },
      messages: [commentMessage("m-wait", ALICE_ID, "Keep the y-axis", { pending: true })],
    });
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } });
    show([waiting]);
    expect(entry("m-wait")).toHaveAttribute("data-delivery", "waiting");
    expect(entry("m-wait")).toHaveTextContent(copy.waiting);
    expect(screen.getByTestId("comments-offline-queue")).toHaveTextContent(copy.offlineQueuedOne);
  });

  it("filters to resolved threads only", async () => {
    const user = userEvent.setup();
    show([conversation, resolved]);
    await pickFilter(user, copy.filterOpen, copy.filterResolved);
    expect(screen.queryByRole("button", { name: "quick" })).toBeNull();
    expect(screen.getByText("fox")).toBeInTheDocument();
  });

  it("shows who is replying to a thread from the people here", () => {
    useCollabLiveStore.setState({
      peers: {
        d1: {
          deviceId: "d1",
          accountId: BOB_ID,
          person: BOB,
          path: "chapters/intro.tex",
          cursor: null,
          anchor: null,
          seenAt: AT + 60_000,
          hue: 20,
          activity: { kind: "reply", threadId: "t-quick" },
          activityAt: AT + 60_000,
        },
      },
    });
    show([conversation]);
    expect(within(card("quick")).getByRole("status")).toHaveTextContent(fill(copy.replyingOne, { name: "Bob Smith" }));
    useCollabLiveStore.setState({ peers: {} });
  });

  it("greys and strikes a thread whose text was removed in another file's section", () => {
    show([], {
      counts: [{ path: "appendix/refs.tex", open: 1, resolved: 0, waiting: 0 }],
      elsewhere: { "appendix/refs.tex": { phase: "ready", threads: [detached], error: null } },
    });
    expect(document.querySelector("[data-quote-text]")).toHaveClass("line-through");
    expect(screen.getByText(copy.outdated)).toBeInTheDocument();
  });
});


describe("live comment states after review", () => {
  const notSent = (patch: Record<string, unknown>) => ({
    fileId: INTRO_FILE,
    path: "chapters/intro.tex",
    threadId: "t-lost",
    messageId: "m-lost",
    at: AT,
    newThread: true,
    edit: false,
    editedAt: null,
    quote: "brown",
    body: "Lost root",
    ...patch,
  });

  afterEach(() => {
    useCollabLiveStore.setState({ commentsNotSent: null });
  });

  it("flags a reply that arrives as New when the pane runs under StrictMode, as the app does", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(AT + 40_000);
    show([conversation], {}, true);
    const reply = commentMessage("m-late", BOB_ID, "One more thing", { at: AT + 50_000 });
    act(() => useComments.setState({ threads: [{ ...conversation, messages: [...conversation.messages, reply] }] }));
    expect(screen.getByText("One more thing").closest("[data-comment-entry]")).toHaveAttribute("data-fresh");
    expect(screen.getByText("Is this word right?").closest("[data-comment-entry]")).not.toHaveAttribute("data-fresh");
    clock.mockRestore();
  });

  it("doesn't flag the comments of a file that just opened as New", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(AT + 40_000);
    const first = show([conversation]);
    const other = commentThread("t-other", { from: 1, to: 3 }, {
      anchor: { quote: "ok", range: { from: 1, to: 3 } },
      messages: [commentMessage("m-other", BOB_ID, "Other file", { at: AT + 50_000 })],
    });
    act(() => useComments.setState({ path: "chapters/methods.tex", threads: [other] }));
    expect(document.querySelector("[data-fresh]")).toBeNull();
    first.unmount();
    clock.mockRestore();
  });

  it("says there are no resolved comments when Resolved is empty but open ones exist", async () => {
    const user = userEvent.setup();
    show([conversation]);
    await pickFilter(user, copy.filterOpen, copy.filterResolved);
    expect(screen.getByText(copy.noResolved)).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyTitle)).toBeNull();
  });

  it("keeps a refused new comment in place with Discard and clears the draft", async () => {
    const user = userEvent.setup();
    mocks.collabCommentCreate.mockRejectedValue({ code: "comment_off_project", message: "" });
    show([], { draft: { path: "chapters/intro.tex", from: 10, to: 15, quote: "brown" } });
    await user.type(screen.getByRole("textbox", { name: copy.newLabel }), "Is this right?");
    await user.click(screen.getByRole("button", { name: copy.send }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: copy.newLabel })).toBeNull());
    const row = (await screen.findByText("Is this right?")).closest("[data-comment-entry]") as HTMLElement;
    expect(row).toHaveAttribute("data-delivery", "failed");
    await user.click(within(row).getByRole("button", { name: copy.discard }));
    expect(screen.queryByText("Is this right?")).toBeNull();
  });

  it("offers Delete thread when every other message was deleted", () => {
    const mine = commentThread("t-mine", { from: 10, to: 15 }, {
      anchor: { quote: "brown", range: { from: 10, to: 15 } },
      createdBy: ALICE_ID,
      messages: [commentMessage("m1", ALICE_ID, "Mine"), commentMessage("m2", BOB_ID, "", { deleted: true })],
    });
    show([mine]);
    openMenu(entry("m1"), copy.messageActions);
    expect(screen.getByRole("menuitem", { name: copy.deleteThread })).toBeInTheDocument();
  });

  it("keeps the in-place Not sent items after the project banner is closed", () => {
    useCollabLiveStore.setState({ commentsNotSent: [notSent({})] });
    show([]);
    expect(screen.getByText("Lost root")).toBeInTheDocument();
    act(() => useCollabLiveStore.getState().dismissCommentsNotSent());
    expect(screen.getByText("Lost root")).toBeInTheDocument();
  });

  it("gives the server-wide reason when comments are off on the server", () => {
    useCollabLiveStore.setState({ commentsNotSent: [notSent({})] });
    show([], { status: commentsStatus({ serverAllowed: false }) });
    expect(screen.getByText(copy.refusals.offServer)).toBeInTheDocument();
  });

  it("lists a reply to a lost thread under that thread, and shows a refused edit in place of the message", () => {
    useCollabLiveStore.setState({
      commentsNotSent: [
        notSent({}),
        notSent({ messageId: "m-lost-reply", newThread: false, body: "Lost reply" }),
        notSent({ threadId: "t-quick", messageId: "m-alice", newThread: false, edit: true, body: "Edited text" }),
      ],
    });
    show([conversation], { selectedId: "t-quick" });
    const lost = screen.getByText("Lost root").closest("article") as HTMLElement;
    expect(within(lost).getByText("Lost reply")).toBeInTheDocument();
    expect(lost.closest("ul")).toHaveClass("px-3", "py-3");
    expect(document.querySelectorAll('[data-comment-entry="m-alice"]')).toHaveLength(0);
    const edited = document.querySelector('[data-comment-entry="not-sent-m-alice"]') as HTMLElement;
    expect(edited).toHaveTextContent("Edited text");
    expect(edited).toHaveTextContent(`· ${copy.edited}`);
    const entries = [...(edited.closest("article") as HTMLElement).querySelectorAll("[data-comment-entry]")];
    expect(entries.indexOf(edited)).toBe(conversation.messages.findIndex((message) => message.id === "m-alice"));
  });

  it("keeps the message's reactions and mentions on a refused edit, and dates '· edited' by the edit", async () => {
    const user = userEvent.setup();
    const reacted = commentThread("t-quick", { from: 4, to: 9 }, {
      anchor: { quote: "quick", range: { from: 4, to: 9 } },
      messages: [
        commentMessage("m-bob", BOB_ID, "Is this word right?", { at: AT - 120_000 }),
        commentMessage("m-alice", ALICE_ID, "Yes, I checked @Bob Smith", { mentions: [BOB_ID], reactions: [{ emoji: "👍", by: [BOB_ID] }] }),
      ],
    });
    useCollabLiveStore.setState({
      commentsNotSent: [
        notSent({ threadId: "t-quick", messageId: "m-alice", newThread: false, edit: true, at: AT, editedAt: AT + 60_000, body: "Checked again, @Bob Smith" }),
      ],
    });
    show([reacted], { selectedId: "t-quick" });
    const edited = document.querySelector('[data-comment-entry="not-sent-m-alice"]') as HTMLElement;
    expect(within(edited).getByText("@Bob Smith")).toHaveAttribute("data-mention");
    expect(within(edited).getByText("👍")).toBeInTheDocument();
    await user.hover(within(edited).getByText(`· ${copy.edited}`));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(formatDateTime(AT + 60_000));
  });

  it("shows a refused edit's text even when the server has since deleted or removed the message", () => {
    for (const gone of [{ deleted: true }, { deleted: true, removed: true }]) {
      const thread = commentThread("t-quick", { from: 4, to: 9 }, {
        anchor: { quote: "quick", range: { from: 4, to: 9 } },
        messages: [commentMessage("m-bob", BOB_ID, "Is this word right?", { at: AT - 120_000 }), commentMessage("m-alice", ALICE_ID, "", gone)],
      });
      useCollabLiveStore.setState({
        commentsNotSent: [notSent({ threadId: "t-quick", messageId: "m-alice", newThread: false, edit: true, body: "Edited while offline" })],
      });
      const view = show([thread], { selectedId: "t-quick" });
      const edited = document.querySelector('[data-comment-entry="not-sent-m-alice"]') as HTMLElement;
      expect(edited).toHaveTextContent("Edited while offline");
      expect(edited).not.toHaveTextContent(copy.deleted);
      expect(edited).not.toHaveTextContent(copy.removed);
      view.unmount();
    }
  });

  it("highlights a mention the refused edit added, not only the ones the server's copy had", () => {
    const thread = commentThread("t-quick", { from: 4, to: 9 }, {
      anchor: { quote: "quick", range: { from: 4, to: 9 } },
      messages: [commentMessage("m-bob", BOB_ID, "Is this word right?", { at: AT - 120_000 }), commentMessage("m-alice", ALICE_ID, "Yes, I checked")],
    });
    useCollabLiveStore.setState({
      commentsNotSent: [notSent({ threadId: "t-quick", messageId: "m-alice", newThread: false, edit: true, body: "Yes, checked with @Bob Smith" })],
    });
    show([thread], { selectedId: "t-quick" });
    const edited = document.querySelector('[data-comment-entry="not-sent-m-alice"]') as HTMLElement;
    expect(within(edited).getByText("@Bob Smith")).toHaveAttribute("data-mention");
  });

  it("keeps a refused reply out of the not-sent list while no file is open, and calls a lost reply a reply", () => {
    useCollabLiveStore.setState({
      commentsNotSent: [notSent({ threadId: "t-refs", messageId: "m-refs", newThread: false, path: "appendix/refs.tex", body: "Reply in refs" })],
    });
    const view = show([], { path: null });
    expect(screen.queryByText("Reply in refs")).toBeNull();
    view.unmount();
    useCollabLiveStore.setState({
      commentsNotSent: [notSent({ threadId: "t-gone", messageId: "m-gone", newThread: false, body: "Reply to a deleted thread" })],
    });
    show([]);
    const card = screen.getByText("Reply to a deleted thread").closest("article") as HTMLElement;
    expect(card).toHaveAccessibleName(copy.replyLabel);
  });
});

describe("offline count", () => {
  it("counts the comments waiting in files that aren't loaded too", () => {
    useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1_000 } });
    show([], { counts: [{ path: "appendix/refs.tex", open: 2, resolved: 0, waiting: 3 }] });
    expect(screen.getByTestId("comments-offline-queue")).toHaveTextContent(fill(copy.offlineQueued, { number: "3" }));
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import { loadNamespace } from "@/i18n";
import type { CollabCommentsStatus, CollabCommentThread, CollabProjectRole, CollabSuggestion } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { useSuggestions } from "../suggestions/suggestions-store";
import {
  ALICE_ID,
  BOB,
  BOB_ID,
  fill,
  liveReset,
  OVERLEAF_PROJECT,
  OVERLEAF_SEED,
  OVERLEAF_SERVER,
  person,
  projectMember,
  shareInfo,
} from "../tests/fixtures";
import { AT, commentFixtures, commentMessage, commentsStatus, commentThread } from "../tests/comment-fixtures";
import { suggestion, suggestionFixtures } from "../tests/suggestion-fixtures";
import { allowRadixSelect } from "../tests/select";

const mocks = vi.hoisted(() => ({
  collabSuggestionAccept: vi.fn(),
  collabSuggestionReject: vi.fn(),
  collabSuggestionWithdraw: vi.fn(),
  collabSuggestionAcceptFile: vi.fn(),
  collabSuggestionRejectFile: vi.fn(),
  collabSuggestionCounts: vi.fn(),
  collabSuggestionList: vi.fn(),
  collabCommentThreadList: vi.fn(),
  writeClipboardText: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));
vi.mock("@/lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clipboard")>()),
  writeClipboardText: mocks.writeClipboardText,
}));

import { useComments } from "./comments-store";
import { CommentsPane } from "./CommentsPane";

const copy = enCollab.suggestions;
const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];

const added = suggestion("s-added");
const removed = suggestion("s-removed", { kind: "delete", from: 20, to: 20, text: "lazy ", author: ALICE_ID });

function viewAs(role: CollabProjectRole) {
  useCollabLiveStore.setState({
    role,
    status: { state: "online" },
    members: MEMBERS,
    share: shareInfo({ project_id: "paper", role, account_id: ALICE_ID }),
  });
}

function show(
  suggestions: CollabSuggestion[],
  options: {
    threads?: CollabCommentThread[];
    comments?: boolean;
    counts?: { path: string; pending: number }[];
    status?: CollabCommentsStatus;
    canAccept?: boolean;
  } = {},
) {
  const off = commentsStatus({ projectEnabled: false, canComment: false });
  useComments.setState({
    projectId: "paper",
    status: options.status ?? (options.comments === false ? off : commentsStatus()),
    path: options.comments === false ? null : "chapters/intro.tex",
    threads: options.threads ?? [],
    phase: options.comments === false ? "idle" : "ready",
    counts: options.comments === false ? null : [],
    elsewhere: {},
  });
  useSuggestions.setState({
    projectId: "paper",
    path: "chapters/intro.tex",
    suggestions,
    canAccept: options.canAccept ?? true,
    phase: "ready",
    error: null,
    counts: options.counts ?? [{ path: "chapters/intro.tex", pending: suggestions.length }],
    elsewhere: {},
    selectedId: null,
    hoveredId: null,
  });
  return render(<CommentsPane />);
}

function cardFor(name: string): HTMLElement {
  return screen.getByRole("article", { name: fill(copy.card, { name }) });
}

beforeAll(async () => {
  await loadNamespace("collab");
  await loadNamespace("editor");
  allowRadixSelect();
});

beforeEach(() => {
  vi.clearAllMocks();
  setEditorView({ focus: vi.fn() } as unknown as EditorView);
  vi.spyOn(Date, "now").mockReturnValue(AT + 60_000);
  for (const call of [
    mocks.collabSuggestionAccept,
    mocks.collabSuggestionReject,
    mocks.collabSuggestionWithdraw,
    mocks.collabSuggestionAcceptFile,
    mocks.collabSuggestionRejectFile,
  ]) {
    call.mockResolvedValue(undefined);
  }
  mocks.collabSuggestionCounts.mockResolvedValue([]);
  mocks.collabSuggestionList.mockResolvedValue({ rev: null, suggestions: [], canAccept: true });
  mocks.collabCommentThreadList.mockResolvedValue({ rev: null, threads: [] });
  useCollabLiveStore.setState({ projectId: "paper" });
  viewAs("owner");
});

afterEach(() => {
  setEditorView(null);
  vi.restoreAllMocks();
  useComments.setState({ projectId: null, status: null, path: null, threads: [], phase: "idle", counts: null, elsewhere: {} });
  useSuggestions.setState({
    projectId: null,
    path: null,
    suggestions: [],
    phase: "idle",
    counts: null,
    elsewhere: {},
    selectedId: null,
    hoveredId: null,
    canAccept: true,
  });
  useCollabLiveStore.setState(liveReset());
});

describe("suggestions in the Comments pane", () => {
  it("shows who suggested what and when, with the pending count beside the file", () => {
    show([removed, added]);
    const list = screen.getByRole("list", { name: "intro.tex" });
    const cards = within(list).getAllByRole("article");
    expect(cards.map((entry) => entry.getAttribute("aria-label"))).toEqual([
      fill(copy.card, { name: "Bob Smith" }),
      fill(copy.card, { name: "Alice Chen" }),
    ]);
    expect(within(cards[0]).getByText(copy.added)).toBeInTheDocument();
    expect(within(cards[0]).getByText("quick")).toBeInTheDocument();
    const struck = within(cards[1]).getByText("lazy");
    expect(struck).toHaveClass("line-through");
    expect(screen.getByLabelText(fill(copy.pendingCount, { number: "2" }))).toBeInTheDocument();
  });

  it("lets an owner accept or reject one suggestion", async () => {
    show([added]);
    const bob = cardFor("Bob Smith");
    fireEvent.click(within(bob).getByRole("button", { name: copy.accept }));
    await waitFor(() => expect(mocks.collabSuggestionAccept).toHaveBeenCalledWith("paper", ["s-added"]));
    act(() => useSuggestions.setState({ suggestions: [added] }));
    fireEvent.click(within(cardFor("Bob Smith")).getByRole("button", { name: copy.reject }));
    await waitFor(() => expect(mocks.collabSuggestionReject).toHaveBeenCalledWith("paper", ["s-added"]));
  });

  it("accepts every suggestion in a file at once and asks before rejecting them all", async () => {
    show([added, removed]);
    const actions = screen.getByRole("group", { name: fill(copy.fileActions, { file: "intro.tex" }) });
    fireEvent.click(within(actions).getByRole("button", { name: copy.acceptAll }));
    await waitFor(() => expect(mocks.collabSuggestionAcceptFile).toHaveBeenCalledWith("paper", "chapters/intro.tex"));
    act(() => useSuggestions.setState({ suggestions: [added, removed] }));
    fireEvent.click(
      within(screen.getByRole("group", { name: fill(copy.fileActions, { file: "intro.tex" }) })).getByRole("button", {
        name: copy.rejectAll,
      }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: fill(copy.rejectAllConfirm.title, { file: "intro.tex" }),
    });
    expect(mocks.collabSuggestionRejectFile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.rejectAllConfirm.confirm }));
    await waitFor(() => expect(mocks.collabSuggestionRejectFile).toHaveBeenCalledWith("paper", "chapters/intro.tex"));
  });

  it("lets a reviewer withdraw only their own suggestion and never accept", async () => {
    viewAs("reviewer");
    show([added, removed]);
    expect(screen.queryByRole("button", { name: copy.accept })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.acceptAll })).toBeNull();
    expect(within(cardFor("Bob Smith")).queryByRole("button", { name: copy.withdraw })).toBeNull();
    fireEvent.click(within(cardFor("Alice Chen")).getByRole("button", { name: copy.withdraw }));
    const dialog = await screen.findByRole("alertdialog", { name: copy.withdrawConfirm.title });
    fireEvent.click(within(dialog).getByRole("button", { name: copy.withdrawConfirm.confirm }));
    await waitFor(() => expect(mocks.collabSuggestionWithdraw).toHaveBeenCalledWith("paper", ["s-removed"]));
  });

  it("shows a viewer the suggestions with no way to act on them or reply", () => {
    viewAs("viewer");
    useComments.setState({ status: commentsStatus({ canComment: false }) });
    show([added], { comments: true });
    useComments.setState({ status: commentsStatus({ canComment: false }) });
    const bob = cardFor("Bob Smith");
    expect(within(bob).queryAllByRole("button").map((button) => button.textContent)).toEqual(["Addedquick "]);
    expect(within(bob).queryByRole("textbox")).toBeNull();
  });

  it("puts a suggestion's thread inside its card, not beside it", () => {
    const thread = commentThread("t-why", { from: 4, to: 10 }, {
      messages: [commentMessage("m-why", BOB_ID, "Is this word right?")],
    });
    show([{ ...added, threadId: "t-why" }], { threads: [thread] });
    const list = screen.getByRole("list", { name: "intro.tex" });
    expect(list.children).toHaveLength(1);
    const card = cardFor("Bob Smith");
    expect(card.querySelector('[data-comment-thread="t-why"]')).not.toBeNull();
    expect(within(card).getByText("Is this word right?")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: enCollab.comments.reply }));
    expect(within(card).getByRole("textbox", { name: enCollab.comments.replyLabel })).toBeInTheDocument();
  });

  it("lists suggestions while comments are turned off, without replies or the resolved filter", () => {
    show([added], { comments: false });
    expect(cardFor("Bob Smith")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Comments shown/u })).toBeNull();
    expect(screen.queryByRole("button", { name: enCollab.comments.resolveAll })).toBeNull();
  });

  it("gives another file with suggestions its own section and loads them when it opens", async () => {
    mocks.collabSuggestionList.mockResolvedValue({
      rev: null,
      suggestions: [suggestion("s-methods", { fileId: "file-methods", text: "carefully " })],
      canAccept: true,
    });
    show([], { counts: [{ path: "chapters/methods.tex", pending: 1 }] });
    expect(screen.queryByText(enCollab.comments.emptyTitle)).toBeNull();
    const section = screen.getByRole("button", { name: "methods.tex" });
    expect(screen.getByLabelText(fill(copy.pendingCount, { number: "1" }))).toBeInTheDocument();
    fireEvent.click(section);
    await waitFor(() => expect(mocks.collabSuggestionList).toHaveBeenCalledWith("paper", "chapters/methods.tex"));
    expect(await screen.findByText("carefully")).toBeInTheDocument();
  });

  it("says once that the project has nothing when there are no comments and no suggestions", () => {
    show([], { counts: [] });
    expect(screen.getByText(enCollab.comments.emptyTitle)).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toEqual([]);
  });

  it("shows a replacement by one person as one card and accepts or rejects both changes together", async () => {
    const inserted = suggestion("s-big", { from: 4, to: 7, text: "big" });
    const deleted = suggestion("s-small", { kind: "delete", from: 7, to: 7, text: "small" });
    show([inserted, deleted]);
    const list = screen.getByRole("list", { name: "intro.tex" });
    expect(within(list).getAllByRole("article")).toHaveLength(1);
    const card = cardFor("Bob Smith");
    expect(card).toHaveAttribute("data-suggestion-replaced", "s-small");
    expect(within(card).getByText(copy.replaced)).toBeInTheDocument();
    expect(within(card).getByText("small")).toHaveClass("line-through");
    expect(within(card).getByText("big")).not.toHaveClass("line-through");
    fireEvent.click(within(card).getByRole("button", { name: copy.accept }));
    await waitFor(() => expect(mocks.collabSuggestionAccept).toHaveBeenCalledWith("paper", ["s-big", "s-small"]));
    act(() => useSuggestions.setState({ suggestions: [inserted, deleted] }));
    fireEvent.click(within(cardFor("Bob Smith")).getByRole("button", { name: copy.reject }));
    await waitFor(() => expect(mocks.collabSuggestionReject).toHaveBeenCalledWith("paper", ["s-big", "s-small"]));
  });

  it("shows a replacement of blank space as an addition, still acting on both", async () => {
    const inserted = suggestion("s-word", { from: 4, to: 8, text: "word" });
    const deleted = suggestion("s-space", { kind: "delete", from: 8, to: 8, text: " " });
    show([inserted, deleted]);
    const card = cardFor("Bob Smith");
    expect(within(card).getByText(copy.added)).toBeInTheDocument();
    expect(within(card).queryByText(copy.replaced)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: copy.reject }));
    await waitFor(() => expect(mocks.collabSuggestionReject).toHaveBeenCalledWith("paper", ["s-word", "s-space"]));
  });

  it("keeps Accept off with the reason when this server can't accept the file's changes, and Reject on", async () => {
    const user = userEvent.setup();
    show([added], { canAccept: false });
    const card = cardFor("Bob Smith");
    const accept = within(card).getByRole("button", { name: copy.accept });
    expect(accept).toBeDisabled();
    const actions = screen.getByRole("group", { name: fill(copy.fileActions, { file: "intro.tex" }) });
    expect(within(actions).getByRole("button", { name: copy.acceptAll })).toBeDisabled();
    expect(within(actions).getByRole("button", { name: copy.rejectAll })).toBeEnabled();
    await user.hover(accept.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(copy.acceptOffServer);
    fireEvent.click(within(card).getByRole("button", { name: copy.reject }));
    await waitFor(() => expect(mocks.collabSuggestionReject).toHaveBeenCalledWith("paper", ["s-added"]));
    expect(mocks.collabSuggestionAccept).not.toHaveBeenCalled();
  });

  it("offers no reply on a suggestion where the backend has no threads for them", () => {
    show([added], { status: commentsStatus({ suggestionThreads: false }) });
    expect(within(cardFor("Bob Smith")).queryByRole("textbox")).toBeNull();
  });
});

describe("the Comments pane on Overleaf", () => {
  const { commentThread: overleafThread, commentMessage: overleafMessage, INTRO_FILE: DOC } = commentFixtures(OVERLEAF_SEED);
  const { suggestion: overleafSuggestion } = suggestionFixtures(OVERLEAF_SEED);
  const NO_MODULE = commentsStatus({ serverAllowed: false, canComment: false, typing: false, suggestionThreads: false });

  beforeEach(() => {
    useCollabLiveStore.setState({
      ...OVERLEAF_SEED.live("paper", "owner"),
      status: { state: "online" },
      members: [projectMember(OVERLEAF_SEED.alice, "owner"), projectMember(OVERLEAF_SEED.bob, "editor")],
    });
  });

  it("says this server has no comments, and shows tracked changes with no way to comment", () => {
    show([overleafSuggestion("s-added")], { status: NO_MODULE });
    expect(screen.getByText(enCollab.comments.overleafOff)).toBeInTheDocument();
    expect(cardFor("Bob Smith")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Comments shown/u })).toBeNull();
  });

  it("says there are no tracked changes rather than no comments when there is nothing", () => {
    show([], { status: NO_MODULE, counts: [] });
    expect(screen.getByText(enCollab.comments.noChanges)).toBeInTheDocument();
    expect(screen.queryByText(enCollab.comments.emptyTitle)).toBeNull();
    expect(screen.getByText(enCollab.comments.overleafOff)).toBeInTheDocument();
  });

  it("shows and writes comments as plain text, the way Overleaf does", () => {
    const body = "**not bold** and `not code`";
    const thread = overleafThread("64f1c2a3b4c5d6e7f80900ab", { from: 4, to: 9 }, {
      messages: [overleafMessage("m-plain", OVERLEAF_SEED.bob.account_id, body)],
    });
    show([], { threads: [thread] });
    expect(screen.getByText(body)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCollab.comments.reply }));
    expect(screen.getByRole("textbox", { name: enCollab.comments.replyLabel })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enEditor.toolbar.bold })).toBeNull();
    act(() => useCollabLiveStore.setState({ backend: "server" }));
    expect(screen.getByRole("button", { name: enEditor.toolbar.bold })).toBeInTheDocument();
  });

  it("copies a link that opens the comment in the Overleaf project", async () => {
    const user = userEvent.setup();
    const thread = overleafThread("64f1c2a3b4c5d6e7f80900aa", { from: 4, to: 9 });
    show([], { threads: [thread] });
    fireEvent.keyDown(screen.getByRole("button", { name: enCollab.comments.messageActions }), { key: "Enter" });
    await user.click(await screen.findByRole("menuitem", { name: enCollab.comments.copyLink }));
    const link = new URL(`${OVERLEAF_SERVER}/project/${OVERLEAF_PROJECT}`);
    link.searchParams.set("doc", DOC);
    link.searchParams.set("comment", thread.id);
    await waitFor(() => expect(mocks.writeClipboardText).toHaveBeenCalledWith(link.toString()));
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import type { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import { loadNamespace } from "@/i18n";
import type { CollabCommentThread, CollabProjectRole, CollabSuggestion } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { useSuggestions } from "../suggestions/suggestions-store";
import { ALICE_ID, BOB, BOB_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { AT, commentMessage, commentsStatus, commentThread, INTRO_FILE } from "../tests/comment-fixtures";
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
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

import { useComments } from "./comments-store";
import { CommentsPane } from "./CommentsPane";

const copy = enCollab.suggestions;
const MEMBERS = [projectMember(person(), "editor"), projectMember(BOB, "owner")];

function suggestion(id: string, overrides: Partial<CollabSuggestion> = {}): CollabSuggestion {
  return {
    id,
    fileId: INTRO_FILE,
    kind: "insert",
    author: BOB_ID,
    createdAt: AT,
    from: 4,
    to: 10,
    text: "quick ",
    threadId: null,
    verified: true,
    ...overrides,
  };
}

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
  options: { threads?: CollabCommentThread[]; comments?: boolean; counts?: { path: string; pending: number }[] } = {},
) {
  useComments.setState({
    projectId: "paper",
    status: options.comments === false ? commentsStatus({ projectEnabled: false, canComment: false }) : commentsStatus(),
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
  mocks.collabSuggestionList.mockResolvedValue({ rev: null, suggestions: [] });
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
  });
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
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
    expect(within(list).getAllByRole("article")).toHaveLength(1);
    expect(within(cardFor("Bob Smith")).getByText("Is this word right?")).toBeInTheDocument();
    expect(within(cardFor("Bob Smith")).getByRole("textbox", { name: enCollab.comments.replyLabel })).toBeInTheDocument();
  });

  it("lists suggestions while comments are turned off, without replies or the resolved filter", () => {
    show([added], { comments: false });
    expect(cardFor("Bob Smith")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: enCollab.comments.showResolved })).toBeNull();
  });

  it("gives another file with suggestions its own section and loads them when it opens", async () => {
    mocks.collabSuggestionList.mockResolvedValue({
      rev: null,
      suggestions: [suggestion("s-methods", { fileId: "file-methods", text: "carefully " })],
    });
    show([], { counts: [{ path: "chapters/methods.tex", pending: 1 }] });
    expect(screen.queryByText(enCollab.comments.emptyCanWrite)).toBeNull();
    const section = screen.getByRole("button", { name: "methods.tex" });
    expect(screen.getByLabelText(fill(copy.pendingCount, { number: "1" }))).toBeInTheDocument();
    fireEvent.click(section);
    await waitFor(() => expect(mocks.collabSuggestionList).toHaveBeenCalledWith("paper", "chapters/methods.tex"));
    expect(await screen.findByText("carefully")).toBeInTheDocument();
  });

  it("says once that the project has nothing when there are no comments and no suggestions", () => {
    show([], { counts: [] });
    expect(screen.getByText(enCollab.comments.emptyCanWrite)).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toEqual([]);
  });
});

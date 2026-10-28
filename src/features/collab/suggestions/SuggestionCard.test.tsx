// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabCommentThread, CollabSuggestion } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useComments } from "../comments/comments-store";
import { commentMessage, commentThread } from "../tests/comment-fixtures";
import { ALICE_ID, BOB, BOB_ID, CAROL_ID, deferred, fill, person } from "../tests/fixtures";
import { SUGGESTED_AT, suggestion } from "../tests/suggestion-fixtures";

const mocks = vi.hoisted(() => ({
  collabSuggestionAccept: vi.fn(),
  collabSuggestionReject: vi.fn(),
  collabSuggestionWithdraw: vi.fn(),
  collabSuggestionReply: vi.fn(),
  collabSuggestionCounts: vi.fn(),
  collabCommentThreadList: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabSuggestionAccept: mocks.collabSuggestionAccept,
  collabSuggestionReject: mocks.collabSuggestionReject,
  collabSuggestionWithdraw: mocks.collabSuggestionWithdraw,
  collabSuggestionReply: mocks.collabSuggestionReply,
  collabSuggestionCounts: mocks.collabSuggestionCounts,
  collabCommentThreadList: mocks.collabCommentThreadList,
}));

import { SuggestionCard, type SuggestionContext } from "./SuggestionCard";
import { useSuggestions } from "./suggestions-store";

const copy = enCollab.suggestions;

function context(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    now: SUGGESTED_AT + 60_000,
    canWrite: false,
    self: ALICE_ID,
    people: new Map([
      [ALICE_ID, person()],
      [BOB_ID, BOB],
    ]),
    members: [],
    canResolve: true,
    canSuggest: true,
    commentsOn: false,
    ...overrides,
  };
}

interface CardProps {
  suggestion?: CollabSuggestion;
  thread?: CollabCommentThread | null;
  selected?: boolean;
  focus?: number;
  context?: SuggestionContext;
  path?: string;
}

function card(props: CardProps = {}) {
  return (
    <ul>
      <SuggestionCard
        suggestion={props.suggestion ?? suggestion("s1")}
        thread={props.thread ?? null}
        selected={props.selected ?? false}
        focus={props.focus ?? 0}
        context={props.context ?? context()}
        path={props.path}
      />
    </ul>
  );
}

function article(name: string): HTMLElement {
  return screen.getByRole("article", { name });
}

const scrollIntoView = vi.fn();
const originalScroll = Element.prototype.scrollIntoView;

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
  for (const call of [mocks.collabSuggestionAccept, mocks.collabSuggestionReject, mocks.collabSuggestionWithdraw]) {
    call.mockResolvedValue(undefined);
  }
  mocks.collabSuggestionCounts.mockResolvedValue([]);
  mocks.collabCommentThreadList.mockResolvedValue({ rev: null, threads: [] });
  mocks.openFile.mockResolvedValue(undefined);
  useFilesStore.setState({ openFile: mocks.openFile });
  useSuggestions.setState({ projectId: "paper", path: "intro.tex", suggestions: [], selectedId: null, hoveredId: null });
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScroll;
  useSuggestions.setState({ projectId: null, path: null, suggestions: [], selectedId: null, hoveredId: null });
  useComments.setState({ projectId: null, threads: [], elsewhere: {} });
});

describe("a suggestion card", () => {
  it("names a verified author who has left the project as someone", () => {
    render(card({ suggestion: suggestion("s1", { author: CAROL_ID }) }));
    const found = article(fill(copy.card, { name: enCollab.toolbar.unknownPerson }));
    expect(within(found).getByText(enCollab.toolbar.unknownPerson)).not.toHaveClass("italic");
  });

  it("marks a suggestion whose author couldn't be verified and never offers to withdraw it", () => {
    render(
      card({
        suggestion: suggestion("s1", { author: ALICE_ID, verified: false }),
        context: context({ canResolve: false }),
      }),
    );
    const found = article(copy.unverifiedCard);
    expect(within(found).getByText(enCollab.comments.unverifiedAuthor)).toHaveClass("italic");
    expect(found.querySelector('[data-slot="avatar"]')).toHaveClass("bg-muted");
    expect(found.querySelector('[data-slot="avatar"] svg')).not.toBeNull();
    expect(within(found).queryByRole("button", { name: copy.withdraw })).toBeNull();
  });

  it("shows why accepting failed and clears the reason once it goes through", async () => {
    mocks.collabSuggestionAccept.mockRejectedValueOnce({ code: "unreachable", message: "offline" });
    render(card());
    const found = article(fill(copy.card, { name: "Bob Smith" }));
    fireEvent.click(within(found).getByRole("button", { name: copy.accept }));
    expect(await within(found).findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    fireEvent.click(within(found).getByRole("button", { name: copy.accept }));
    await waitFor(() => expect(mocks.collabSuggestionAccept).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(found).queryByRole("alert")).toBeNull());
    expect(mocks.collabSuggestionAccept).toHaveBeenLastCalledWith("paper", ["s1"]);
  });

  it("holds both decisions while one is on its way", async () => {
    const rejecting = deferred<void>();
    mocks.collabSuggestionReject.mockReturnValueOnce(rejecting.promise);
    render(card());
    const found = article(fill(copy.card, { name: "Bob Smith" }));
    fireEvent.click(within(found).getByRole("button", { name: copy.reject }));
    expect(within(found).getByRole("button", { name: copy.accept })).toBeDisabled();
    expect(within(found).getByRole("button", { name: copy.reject })).toBeDisabled();
    await act(async () => rejecting.resolve());
    expect(within(found).getByRole("button", { name: copy.accept })).toBeEnabled();
    expect(mocks.collabSuggestionReject).toHaveBeenCalledWith("paper", ["s1"]);
    expect(mocks.collabSuggestionAccept).not.toHaveBeenCalled();
  });

  it("asks before withdrawing, keeps the suggestion on cancel, and says why a withdrawal failed", async () => {
    mocks.collabSuggestionWithdraw.mockRejectedValueOnce({ code: "forbidden", message: "no" });
    render(card({ suggestion: suggestion("s1", { author: ALICE_ID }), context: context({ canResolve: false }) }));
    const found = article(fill(copy.card, { name: "Alice Chen" }));
    fireEvent.click(within(found).getByRole("button", { name: copy.withdraw }));
    const asking = await screen.findByRole("alertdialog", { name: copy.withdrawConfirm.title });
    fireEvent.click(within(asking).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.collabSuggestionWithdraw).not.toHaveBeenCalled();
    fireEvent.click(within(found).getByRole("button", { name: copy.withdraw }));
    const again = await screen.findByRole("alertdialog", { name: copy.withdrawConfirm.title });
    fireEvent.click(within(again).getByRole("button", { name: copy.withdrawConfirm.confirm }));
    expect(await within(found).findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(mocks.collabSuggestionWithdraw).toHaveBeenCalledWith("paper", ["s1"]);
  });

  it("jumps to a suggestion in the open file, and opens the file a suggestion elsewhere belongs to", () => {
    const view = render(card());
    fireEvent.click(screen.getByRole("button", { name: /quick/ }));
    expect(useSuggestions.getState().selectedId).toBe("s1");
    expect(mocks.openFile).not.toHaveBeenCalled();
    view.unmount();
    render(card({ suggestion: suggestion("m1", { fileId: "file-methods" }), path: "methods.tex" }));
    fireEvent.click(screen.getByRole("button", { name: /quick/ }));
    expect(mocks.openFile).toHaveBeenCalledWith("methods.tex");
  });

  it("brings the selected card into view when focus moves to it, and not on every render", () => {
    const view = render(card({ selected: true, focus: 0 }));
    const found = article(fill(copy.card, { name: "Bob Smith" }));
    expect(found).toHaveAttribute("aria-current", "true");
    expect(found).toHaveClass("border-primary/30");
    expect(scrollIntoView).not.toHaveBeenCalled();
    view.rerender(card({ selected: true, focus: 1 }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    view.rerender(card({ selected: false, focus: 2 }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(article(fill(copy.card, { name: "Bob Smith" }))).not.toHaveAttribute("aria-current");
  });

  it("lights up the suggestion in the editor while the pointer is over its card", () => {
    render(card());
    const found = article(fill(copy.card, { name: "Bob Smith" }));
    fireEvent.mouseEnter(found);
    expect(useSuggestions.getState().hoveredId).toBe("s1");
    fireEvent.mouseLeave(found);
    expect(useSuggestions.getState().hoveredId).toBeNull();
  });

  it("shows a thread's replies only while comments are on, and sends a reply from the card", async () => {
    const thread = commentThread("t-why", { from: 4, to: 10 }, {
      messages: [commentMessage("m-why", BOB_ID, "Is this word right?")],
    });
    const linked = suggestion("s1", { threadId: "t-why" });
    const view = render(card({ suggestion: linked, thread, context: context({ commentsOn: false, canWrite: true }) }));
    expect(screen.queryByText("Is this word right?")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    view.unmount();
    mocks.collabSuggestionReply.mockResolvedValue(commentThread("t-new", { from: 4, to: 10 }));
    render(card({ context: context({ commentsOn: true, canWrite: true }) }));
    fireEvent.change(screen.getByRole("textbox", { name: enCollab.comments.replyLabel }), {
      target: { value: "Why this word?" },
    });
    fireEvent.click(screen.getByRole("button", { name: enCollab.comments.reply }));
    await waitFor(() =>
      expect(mocks.collabSuggestionReply).toHaveBeenCalledWith("paper", "s1", "Why this word?", expect.any(Array)),
    );
  });
});

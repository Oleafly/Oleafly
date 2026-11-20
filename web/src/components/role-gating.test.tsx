import type { CollabCommentThread } from "@oleafly/backend-port";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectActions } from "../controller";
import type { OutboxItem } from "../outbox";
import type { CollabProjectRole, CollabSuggestion, WebFile } from "../protocol";
import { resetWebState, useWeb } from "../store";
import { ChatPane } from "./ChatPane";
import { CommentsPane, openThreadCount } from "./CommentsPane";
import { ActionsContext } from "./context";
import { SourceToolbar } from "./SourcePane";

const MAIN: WebFile = { fileId: "f-main", path: "main.tex", kind: "text", blob: null };

function actions(): ProjectActions {
  const done = vi.fn(async () => undefined);
  return {
    openFile: vi.fn(),
    setMode: vi.fn(),
    startComment: vi.fn(),
    cancelComment: vi.fn(),
    createComment: done,
    replyComment: done,
    editComment: done,
    deleteComment: done,
    resolveThread: done,
    reopenThread: done,
    reactComment: done,
    reactChat: vi.fn(async () => undefined),
    revealThread: vi.fn(),
    revealSuggestion: vi.fn(),
    acceptSuggestions: vi.fn(async () => undefined),
    rejectSuggestions: vi.fn(async () => undefined),
    withdrawSuggestions: vi.fn(async () => undefined),
    acceptFile: vi.fn(async () => undefined),
    rejectFile: vi.fn(async () => undefined),
    sendChat: vi.fn(async () => undefined),
    deleteChat: vi.fn(async () => undefined),
    clearChat: vi.fn(async () => undefined),
    discardOutbox: vi.fn(),
    retryOutbox: vi.fn(),
    setActivity: vi.fn(),
    compile: vi.fn(),
    toggleLog: vi.fn(),
    showInPdf: vi.fn(async () => undefined),
    openFromPdf: vi.fn(async () => undefined),
    openLocation: vi.fn(),
  };
}

function withRole(role: CollabProjectRole, patch: Parameters<typeof resetWebState>[0] = {}) {
  resetWebState({
    role,
    me: { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null },
    people: {
      me: { accountId: "me", name: "Me", avatarUrl: null, login: null },
      ana: { accountId: "ana", name: "Ana", avatarUrl: null, login: null },
    },
    files: [MAIN],
    activeFileId: MAIN.fileId,
    activePath: MAIN.path,
    chatLoaded: true,
    ...patch,
  });
}

function renderWith(node: ReactNode, given = actions()) {
  render(<ActionsContext.Provider value={given}>{node}</ActionsContext.Provider>);
  return given;
}

function suggestion(patch: Partial<CollabSuggestion> = {}): CollabSuggestion {
  return {
    id: "s1",
    fileId: MAIN.fileId,
    kind: "insert",
    author: "ana",
    createdAt: Date.now(),
    from: 0,
    to: 4,
    text: "new ",
    threadId: null,
    verified: true,
    ...patch,
  };
}

function thread(patch: Partial<CollabCommentThread> = {}): CollabCommentThread {
  return {
    id: "t1",
    fileId: MAIN.fileId,
    anchor: { quote: "Hello", range: { from: 0, to: 5 } },
    createdBy: "ana",
    createdAt: Date.now(),
    resolved: null,
    messages: [
      { id: "m1", author: "ana", at: Date.now(), body: "Is this right?", editedAt: null, deleted: false, mentions: [], verified: true, reactions: [], removed: false, pending: false },
    ],
    verified: true,
    ...patch,
  };
}

describe("source toolbar by role", () => {
  it("lets owners and editors switch between editing and suggesting", () => {
    for (const role of ["owner", "editor"] as const) {
      withRole(role);
      const given = renderWith(<SourceToolbar file={MAIN} loaded />);
      const switcher = screen.getByRole("tablist", { name: "Edit mode" });
      expect(within(switcher).getByRole("tab", { name: "Editing" })).toHaveAttribute("aria-selected", "true");
      const suggesting = within(switcher).getByRole("tab", { name: "Suggesting" });
      fireEvent.mouseDown(suggesting, { button: 0 });
      expect(given.setMode).toHaveBeenCalledWith("suggesting");
      expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
      document.body.innerHTML = "";
    }
  });

  it("shows the chosen mode", () => {
    withRole("editor", { chosenMode: "suggesting" });
    renderWith(<SourceToolbar file={MAIN} loaded />);
    expect(screen.getByRole("tab", { name: "Suggesting" })).toHaveAttribute("aria-selected", "true");
  });

  it("locks reviewers to suggesting", () => {
    withRole("reviewer");
    renderWith(<SourceToolbar file={MAIN} loaded />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("mode-locked")).toHaveTextContent("Suggesting");
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
  });

  it("keeps commenters read only but lets them comment", () => {
    withRole("commenter", { selection: { from: 0, to: 3 } });
    const given = renderWith(<SourceToolbar file={MAIN} loaded />);
    expect(screen.getByTestId("read-only")).toHaveTextContent("Read only");
    const comment = screen.getByRole("button", { name: "Comment" });
    expect(comment).toBeEnabled();
    fireEvent.click(comment);
    expect(given.startComment).toHaveBeenCalled();
  });

  it("disables Comment until text is selected", () => {
    withRole("commenter");
    renderWith(<SourceToolbar file={MAIN} loaded />);
    expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
  });

  it("gives viewers neither editing nor comments", () => {
    for (const role of ["viewer", "unknown"] as const) {
      withRole(role);
      renderWith(<SourceToolbar file={MAIN} loaded />);
      expect(screen.getByTestId("read-only")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
      document.body.innerHTML = "";
    }
  });

  it("hides the mode switch when the server has suggestions turned off", () => {
    withRole("owner", { features: { comments: true, suggestions: false, chat: true, reactions: false } });
    renderWith(<SourceToolbar file={MAIN} loaded />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("read-only")).toBeNull();
  });
});

describe("comments pane by role", () => {
  it("lets owners and editors accept and reject, one by one and per file", async () => {
    for (const role of ["owner", "editor"] as const) {
      withRole(role, { suggestions: { [MAIN.fileId]: [suggestion()] } });
      const given = renderWith(<CommentsPane />);
      for (const name of ["Accept", "Reject", "Accept all"]) {
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name }));
        });
      }
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
      });
      expect(given.rejectFile).not.toHaveBeenCalled();
      const dialog = screen.getByRole("alertdialog");
      expect(dialog).toHaveTextContent("Reject every suggestion in main.tex?");
      expect(dialog).toHaveTextContent("Suggestions waiting: 1.");
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Reject all" }));
      });
      expect(given.acceptSuggestions).toHaveBeenCalledWith(["s1"]);
      expect(given.rejectSuggestions).toHaveBeenCalledWith(["s1"]);
      expect(given.acceptFile).toHaveBeenCalledWith(MAIN.fileId);
      expect(given.rejectFile).toHaveBeenCalledWith(MAIN.fileId);
      expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
      document.body.innerHTML = "";
    }
  });

  it("asks before rejecting a whole file, and holds the buttons while an answer is on its way", async () => {
    withRole("owner", { suggestions: { [MAIN.fileId]: [suggestion()] } });
    const given = actions();
    given.acceptSuggestions = vi.fn(() => new Promise<void>(() => undefined));
    renderWith(<CommentsPane />, given);
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(given.rejectFile).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    });
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(given.acceptSuggestions).toHaveBeenCalledTimes(1);
  });

  it("lets a reviewer withdraw only their own suggestions", () => {
    withRole("reviewer", {
      suggestions: { [MAIN.fileId]: [suggestion({ id: "mine", author: "me" }), suggestion({ id: "theirs", from: 5, to: 6 })] },
    });
    const given = renderWith(<CommentsPane />);
    const withdraw = screen.getAllByRole("button", { name: "Withdraw" });
    expect(withdraw).toHaveLength(1);
    fireEvent.click(withdraw[0]);
    expect(given.withdrawSuggestions).toHaveBeenCalledWith(["mine"]);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
  });

  it("shows suggestions to commenters and viewers without review actions", () => {
    for (const role of ["commenter", "viewer"] as const) {
      withRole(role, { suggestions: { [MAIN.fileId]: [suggestion({ author: "me" })] } });
      renderWith(<CommentsPane />);
      expect(screen.getByRole("article", { name: "Suggestion by You" })).toBeInTheDocument();
      for (const name of ["Accept", "Reject", "Withdraw", "Accept all", "Reject all"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      document.body.innerHTML = "";
    }
  });

  it("lets commenters reply and resolve but not viewers", () => {
    withRole("commenter", { threads: { [MAIN.fileId]: [thread()] } });
    renderWith(<CommentsPane />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByRole("textbox", { name: "Reply to this thread" })).toHaveValue("@Ana ");
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    document.body.innerHTML = "";
    withRole("viewer", { threads: { [MAIN.fileId]: [thread()] } });
    renderWith(<CommentsPane />);
    expect(screen.getByText("Is this right?")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });

  it("sends a reply from the thread composer", async () => {
    withRole("reviewer", { threads: { [MAIN.fileId]: [thread()] } });
    const given = renderWith(<CommentsPane />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const field = screen.getByRole("textbox", { name: "Reply to this thread" });
    fireEvent.change(field, { target: { value: "  Yes  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(given.replyComment).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "Yes");
  });

  it("explains how to start a thread with the shortcut only to roles that can comment, and tells viewers why they can't", () => {
    withRole("commenter");
    renderWith(<CommentsPane />);
    expect(screen.getByText(/choose Comment, or press/u)).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.queryByText(/Ask an owner for commenter access/u)).toBeNull();
    document.body.innerHTML = "";
    withRole("viewer");
    renderWith(<CommentsPane />);
    expect(screen.getByText("Comments and suggestions on this project show here.")).toBeInTheDocument();
    expect(screen.getByText(/Ask an owner for commenter access to reply or react/u)).toBeInTheDocument();
  });

  it("shows the draft composer for a new comment", async () => {
    withRole("commenter", { draft: { fileId: MAIN.fileId, path: MAIN.path, from: 0, to: 5, quote: "Hello" } });
    const given = renderWith(<CommentsPane />);
    const field = screen.getByRole("textbox", { name: "New comment" });
    fireEvent.change(field, { target: { value: "Typo" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(given.createComment).toHaveBeenCalledWith("Typo");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(given.cancelComment).toHaveBeenCalled();
  });
});

describe("chat by role", () => {
  const messages = [
    { id: "c1", author: "ana", at: Date.now() - 5_000, body: "Hi all", deleted: false, verified: true, reactions: [], pending: false, mentions: [] },
    { id: "c2", author: "me", at: Date.now(), body: "Hello", deleted: false, verified: true, reactions: [], pending: false, mentions: [] },
    { id: "c3", author: "ana", at: Date.now(), body: "gone", deleted: true, verified: true, reactions: [], pending: false, mentions: [] },
  ];

  it("lets viewers read the chat but not post", () => {
    withRole("viewer", { chat: messages });
    renderWith(<ChatPane />);
    expect(screen.getByText("Hi all")).toBeInTheDocument();
    const own = screen.getByText("Hello").closest("[data-comment-entry]") as HTMLElement;
    expect(own).toHaveAttribute("data-own");
    expect(own).not.toHaveTextContent("Me");
    expect(screen.getByText("Hi all").closest("[data-comment-entry]")).not.toHaveAttribute("data-own");
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.queryByText("gone")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("You can read the chat. Viewers can't post.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions for this message" })).toBeNull();
  });

  it("lets commenters post and delete their own messages", async () => {
    withRole("commenter", { chat: messages });
    const given = renderWith(<ChatPane />);
    const menus = screen.getAllByRole("button", { name: "More actions for this message" });
    expect(menus).toHaveLength(1);
    fireEvent.keyDown(menus[0], { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete this message?");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    expect(given.deleteChat).toHaveBeenCalledWith("c2");
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "On it" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(given.sendChat).toHaveBeenCalledWith("On it");
    expect(screen.queryByRole("button", { name: "Clear chat" })).toBeNull();
  });

  it("lets only the owner clear the chat, after confirming", () => {
    withRole("editor", { chat: messages });
    renderWith(<ChatPane />);
    expect(screen.queryByRole("button", { name: "Clear chat" })).toBeNull();
    document.body.innerHTML = "";
    withRole("owner", { chat: messages });
    const given = renderWith(<ChatPane />);
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear chat" }));
    expect(given.clearChat).toHaveBeenCalled();
  });

  it("shows an offline failure next to the composer", async () => {
    withRole("commenter");
    const given = actions();
    const { OfflineError } = await import("../controller");
    given.sendChat = vi.fn(async () => {
      throw new OfflineError();
    });
    renderWith(<ChatPane />, given);
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Hi" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("You're offline. Try again when you're connected.");
    expect(useWeb.getState().role).toBe("commenter");
  });
});

describe("live comment states on the web", () => {
  function outbox(patch: Partial<OutboxItem>): OutboxItem {
    return {
      id: "o1",
      kind: "reply",
      body: "Keep the y-axis the same",
      at: Date.now(),
      state: "waiting",
      reason: null,
      retry: false,
      fileId: MAIN.fileId,
      threadId: "t1",
      path: null,
      from: null,
      to: null,
      quote: null,
      before: null,
      after: null,
      ...patch,
    };
  }

  it("shows a reply written offline in its thread as waiting, with the pane banner counting it", () => {
    withRole("commenter", { threads: { [MAIN.fileId]: [thread()] }, connection: "offline", outbox: [outbox({})] });
    renderWith(<CommentsPane />);
    const row = screen.getByText("Keep the y-axis the same").closest("[data-comment-entry]") as HTMLElement;
    expect(row).toHaveAttribute("data-delivery", "waiting");
    expect(row).toHaveTextContent("Waiting to send");
    expect(screen.getByTestId("comments-offline-queue")).toHaveTextContent("Can't reach the server. 1 comment will send when it's back.");
  });

  it("keeps a refused comment in place with the server's reason, Copy text and Discard", () => {
    const given = actions();
    withRole("commenter", {
      threads: { [MAIN.fileId]: [thread()] },
      outbox: [outbox({ state: "failed", reason: "comment_off_project" })],
    });
    renderWith(<CommentsPane />, given);
    const row = screen.getByText("Keep the y-axis the same").closest("[data-comment-entry]") as HTMLElement;
    expect(row).toHaveTextContent("Not sent.");
    expect(within(row).queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Discard" }));
    expect(given.discardOutbox).toHaveBeenCalledWith("o1");
  });

  it("filters threads by Open, Resolved and All", async () => {
    const done = thread({ id: "t2", resolved: { by: "ana", at: Date.now(), verified: true }, messages: [{ ...thread().messages[0], id: "m2", body: "Fixed now" }] });
    withRole("commenter", { threads: { [MAIN.fileId]: [thread(), done] } });
    renderWith(<CommentsPane />);
    expect(screen.queryByText(/Fixed now/u)).toBeNull();
    const pick = (name: string) => {
      fireEvent.pointerDown(screen.getByRole("button", { name: /^Comments shown:/u }), { button: 0, ctrlKey: false });
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: new RegExp(`^${name}`, "u") }));
    };
    pick("Resolved");
    expect(screen.getByText(/Fixed now/u)).toBeInTheDocument();
    expect(screen.queryByText("Is this right?")).toBeNull();
    pick("All");
    expect(screen.getByText("Is this right?")).toBeInTheDocument();
  });

  it("says a deleted comment was deleted, and a moderator removal was removed", () => {
    const base = thread().messages[0];
    withRole("owner", {
      threads: {
        [MAIN.fileId]: [
          thread({
            messages: [
              { ...base, deleted: true, body: "" },
              { ...base, id: "m2", author: "me", body: "Reply kept" },
              { ...base, id: "m3", deleted: true, removed: true, body: "" },
            ],
          }),
        ],
      },
      selectedThreadId: "t1",
    });
    renderWith(<CommentsPane />);
    expect(screen.getByText("This comment was deleted.")).toBeInTheDocument();
    expect(screen.getByText("Removed by a moderator")).toBeInTheDocument();
    expect(screen.getByText("Reply kept")).toBeInTheDocument();
  });
});

describe("web pane review fixes", () => {
  it("flags a comment that arrives as New when the panes run under StrictMode, as the app does", () => {
    withRole("commenter", { threads: { [MAIN.fileId]: [thread()] } });
    render(
      <StrictMode>
        <ActionsContext.Provider value={actions()}>
          <CommentsPane />
        </ActionsContext.Provider>
      </StrictMode>,
    );
    const late = { ...thread().messages[0], id: "m2", body: "Second look", at: Date.now() + 1 };
    act(() => {
      useWeb.setState({ threads: { [MAIN.fileId]: [thread({ messages: [...thread().messages, late] })] } });
    });
    expect(document.querySelector('[data-comment-entry="m2"]')).toHaveAttribute("data-fresh");
    expect(document.querySelector('[data-comment-entry="m1"]')).not.toHaveAttribute("data-fresh");
  });

  it("flags a chat message that arrives as New when the chat runs under StrictMode, as the app does", () => {
    const first = { id: "c1", author: "ana", at: Date.now() - 5_000, body: "Hi all", deleted: false, verified: true, reactions: [], pending: false, mentions: [] };
    withRole("commenter", { chat: [first] });
    render(
      <StrictMode>
        <ActionsContext.Provider value={actions()}>
          <ChatPane />
        </ActionsContext.Provider>
      </StrictMode>,
    );
    act(() => {
      useWeb.setState({ chat: [first, { ...first, id: "c2", body: "Just landed", at: Date.now() + 1 }] });
    });
    expect(document.querySelector('[data-comment-entry="c2"]')).toHaveAttribute("data-fresh");
    expect(document.querySelector('[data-comment-entry="c1"]')).not.toHaveAttribute("data-fresh");
  });

  it("names your waiting reply as you, the way your sent replies are named, not by your full name", () => {
    const sent = { ...thread().messages[0], id: "m2", author: "me", body: "Sent earlier", editedAt: Date.now() };
    const waiting: OutboxItem = {
      id: "o1",
      kind: "reply",
      body: "Still waiting",
      at: Date.now(),
      state: "waiting",
      reason: null,
      retry: false,
      fileId: MAIN.fileId,
      threadId: "t1",
      path: null,
      from: null,
      to: null,
      quote: null,
      before: null,
      after: null,
    };
    withRole("commenter", { threads: { [MAIN.fileId]: [thread({ messages: [...thread().messages, sent] })] }, connection: "offline", outbox: [waiting], selectedThreadId: "t1" });
    renderWith(<CommentsPane />);
    const settled = screen.getByText("Sent earlier").closest("[data-comment-entry]") as HTMLElement;
    const pending = screen.getByText("Still waiting").closest("[data-comment-entry]") as HTMLElement;
    const name = (row: HTMLElement) => row.querySelector(".max-w-full.shrink-0.truncate")?.textContent;
    expect(name(pending)).toBe(name(settled));
    expect(pending).not.toHaveTextContent("Me");
  });

  it("flags the first comment that arrives in an empty pane as New", () => {
    withRole("commenter", { threads: {} });
    renderWith(<CommentsPane />);
    act(() => {
      useWeb.setState({ threads: { [MAIN.fileId]: [thread({ messages: [{ ...thread().messages[0], at: Date.now() + 1 }] })] } });
    });
    expect(document.querySelector('[data-comment-entry="m1"]')).toHaveAttribute("data-fresh");
  });

  it("treats the history in the first chat frame as already read when the Chat tab opened before it", () => {
    withRole("commenter", { chat: [], chatLoaded: false });
    renderWith(<ChatPane />);
    const at = Date.now();
    act(() => {
      useWeb.setState({
        chatLoaded: true,
        chat: [{ id: "h1", author: "ana", at: at - 10_000, body: "From before", deleted: false, verified: true, reactions: [], pending: false, mentions: [] }],
      });
    });
    expect(screen.getByText("From before").closest("[data-comment-entry]")).not.toHaveAttribute("data-fresh");
    act(() => {
      useWeb.setState((state) => ({
        chat: [...state.chat, { id: "h2", author: "ana", at: at + 1, body: "Live one", deleted: false, verified: true, reactions: [], pending: false, mentions: [] }],
      }));
    });
    expect(screen.getByText("Live one").closest("[data-comment-entry]")).toHaveAttribute("data-fresh");
  });

  it("flags the first chat message that arrives in an empty chat as New, and one that only claims to be yours", () => {
    withRole("commenter", { chat: [] });
    renderWith(<ChatPane />);
    const at = Date.now() + 1;
    act(() => {
      useWeb.setState({
        chat: [
          { id: "n1", author: "ana", at, body: "First!", deleted: false, verified: true, reactions: [], pending: false, mentions: [] },
          { id: "n2", author: "me", at, body: "Not me", deleted: false, verified: false, reactions: [], pending: false, mentions: [] },
        ],
      });
    });
    expect(screen.getByText("First!").closest("[data-comment-entry]")).toHaveAttribute("data-fresh");
    expect(screen.getByText("Not me").closest("[data-comment-entry]")).toHaveAttribute("data-fresh");
  });

  it("lines the chat composer up with the message list", () => {
    withRole("commenter", { chat: [] });
    renderWith(<ChatPane />);
    const list = document.querySelector("[data-comment-entry], .overflow-y-auto > div") as HTMLElement;
    const composer = screen.getByRole("textbox").closest(".border-t") as HTMLElement;
    expect(list).toHaveClass("px-3");
    expect(composer).toHaveClass("px-3");
  });

  it("says who is typing in the chat", () => {
    withRole("commenter", {
      chat: [],
      peers: [{ deviceId: "d-ana", accountId: "ana", name: "Ana", fileId: null, anchor: null, head: null, activity: { kind: "chat", threadId: null }, seq: 1 }],
      activityAt: { "d-ana": Date.now() },
    });
    renderWith(<ChatPane />);
    expect(screen.getByRole("status")).toHaveTextContent("Ana is typing");
  });

  it("shows the read-only note only once the role is known to be viewer, and only while comments are on", () => {
    withRole("unknown");
    renderWith(<CommentsPane />);
    expect(screen.queryByText(/Ask an owner for commenter access/u)).toBeNull();
    document.body.innerHTML = "";
    withRole("viewer", { features: { comments: false, suggestions: true, chat: true, reactions: true } });
    renderWith(<CommentsPane />);
    expect(screen.queryByText(/Ask an owner for commenter access/u)).toBeNull();
  });

  it("says there are no resolved comments when the Resolved filter is empty but open ones exist", () => {
    withRole("commenter", { threads: { [MAIN.fileId]: [thread()] } });
    renderWith(<CommentsPane />);
    fireEvent.pointerDown(screen.getByRole("button", { name: /^Comments shown:/u }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Resolved/u }));
    expect(screen.getByText("No resolved comments")).toBeInTheDocument();
    expect(screen.queryByText("No comments yet")).toBeNull();
  });

  it("says every comment is resolved under Open instead of inviting a first one", () => {
    const resolved = { by: "ana", at: Date.now(), verified: true };
    withRole("commenter", { threads: { [MAIN.fileId]: [thread({ resolved }), thread({ id: "t2", resolved })] } });
    renderWith(<CommentsPane />);
    expect(screen.getByText("All comments are resolved.")).toBeInTheDocument();
    expect(screen.queryByText("No comments yet")).toBeNull();
    expect(screen.queryByText(/Select text/u)).toBeNull();
  });

  it("keeps the suggestion author's name whole, wraps the time under it and keeps the Inserted tag whole", () => {
    withRole("commenter", { suggestions: { [MAIN.fileId]: [suggestion()] } });
    renderWith(<CommentsPane />);
    const card = screen.getByRole("article", { name: "Suggestion by Ana" });
    const name = within(card).getByText("Ana");
    expect(name).toHaveClass("max-w-full", "shrink-0", "truncate");
    expect(name.parentElement).toHaveClass("min-w-0", "flex-wrap");
    expect((card.querySelector("time") as HTMLElement).parentElement).not.toHaveClass("shrink-0");
    expect(within(card).getByText("Inserted")).toHaveClass("shrink-0");
  });

  it("leaves a suggestion's discussion out of the Comments tab count too", () => {
    expect(openThreadCount({ [MAIN.fileId]: [thread()] }, { [MAIN.fileId]: [suggestion({ threadId: "t1" })] })).toBe(0);
    expect(openThreadCount({ [MAIN.fileId]: [thread()] }, {})).toBe(1);
  });

  it("counts the Comments tab once per change of threads, not on every store update", () => {
    let reads = 0;
    const threads = {
      get [MAIN.fileId]() {
        reads += 1;
        return [thread()];
      },
    };
    const suggestions = {};
    expect(openThreadCount(threads, suggestions)).toBe(1);
    expect(openThreadCount(threads, suggestions)).toBe(1);
    expect(reads).toBe(1);
  });

  it("leaves a suggestion's discussion out of the comment counts", () => {
    withRole("commenter", {
      threads: { [MAIN.fileId]: [thread()] },
      suggestions: { [MAIN.fileId]: [suggestion({ threadId: "t1" })] },
    });
    renderWith(<CommentsPane />);
    expect(screen.getByRole("button", { name: /^Comments shown:/u })).not.toHaveTextContent("1");
    fireEvent.pointerDown(screen.getByRole("button", { name: /^Comments shown:/u }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("menuitemcheckbox", { name: /^Open/u })).toHaveTextContent("0");
  });
});

describe("unsent new comments on the web", () => {
  it("draws the quote of a queued or refused new comment without the Outdated pill or a strike", () => {
    const created = (state: "waiting" | "failed") => ({
      id: `o-${state}`,
      kind: "create" as const,
      body: `Body ${state}`,
      at: Date.now(),
      state,
      reason: state === "failed" ? "comment_off_project" : null,
      retry: false,
      fileId: MAIN.fileId,
      threadId: null,
      path: MAIN.path,
      from: 0,
      to: 5,
      quote: "Hello",
      before: null,
      after: null,
    });
    withRole("commenter", { outbox: [created("waiting"), created("failed")] });
    renderWith(<CommentsPane />);
    expect(screen.queryByText("Outdated")).toBeNull();
    for (const quote of document.querySelectorAll("[data-quote-text]")) expect(quote).not.toHaveClass("line-through");
  });
});


describe("chat mentions on the web", () => {
  it("highlights a mention the server resolved in a chat message", () => {
    withRole("commenter", {
      chat: [{ id: "c1", author: "ana", at: Date.now(), body: "Thanks @Me", deleted: false, verified: true, reactions: [], pending: false, mentions: ["me"] }],
      discussion: "chat",
    });
    renderWith(<ChatPane />);
    expect(screen.getByText("@Me")).toHaveAttribute("data-mention");
  });
});

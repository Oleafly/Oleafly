import type { CollabCommentThread } from "@oleafly/backend-port";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectActions } from "../controller";
import type { CollabProjectRole, CollabSuggestion, WebFile } from "../protocol";
import { resetWebState, useWeb } from "../store";
import { ChatPane } from "./ChatPane";
import { CommentsPane } from "./CommentsPane";
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
      { id: "m1", author: "ana", at: Date.now(), body: "Is this right?", editedAt: null, deleted: false, mentions: [], verified: true },
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
    withRole("owner", { features: { comments: true, suggestions: false, chat: true } });
    renderWith(<SourceToolbar file={MAIN} loaded />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("read-only")).toBeNull();
  });
});

describe("comments pane by role", () => {
  it("lets owners and editors accept and reject, one by one and per file", () => {
    for (const role of ["owner", "editor"] as const) {
      withRole(role, { suggestions: { [MAIN.fileId]: [suggestion()] } });
      const given = renderWith(<CommentsPane />);
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
      fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
      expect(given.acceptSuggestions).toHaveBeenCalledWith(["s1"]);
      expect(given.rejectSuggestions).toHaveBeenCalledWith(["s1"]);
      expect(given.acceptFile).toHaveBeenCalledWith(MAIN.fileId);
      expect(given.rejectFile).toHaveBeenCalledWith(MAIN.fileId);
      expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
      document.body.innerHTML = "";
    }
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
    expect(screen.getByRole("textbox", { name: "Reply to this thread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    document.body.innerHTML = "";
    withRole("viewer", { threads: { [MAIN.fileId]: [thread()] } });
    renderWith(<CommentsPane />);
    expect(screen.getByText("Is this right?")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });

  it("sends a reply from the thread composer", async () => {
    withRole("reviewer", { threads: { [MAIN.fileId]: [thread()] } });
    const given = renderWith(<CommentsPane />);
    const field = screen.getByRole("textbox", { name: "Reply to this thread" });
    fireEvent.change(field, { target: { value: "  Yes  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });
    expect(given.replyComment).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "Yes");
  });

  it("explains how to start a thread only to roles that can comment", () => {
    withRole("commenter");
    renderWith(<CommentsPane />);
    expect(screen.getByText(/choose Comment to start a thread/u)).toBeInTheDocument();
    document.body.innerHTML = "";
    withRole("viewer");
    renderWith(<CommentsPane />);
    expect(screen.getByText("Comments and suggestions on this project show here.")).toBeInTheDocument();
  });

  it("shows the draft composer for a new comment", async () => {
    withRole("commenter", { draft: { fileId: MAIN.fileId, path: MAIN.path, from: 0, to: 5, quote: "Hello" } });
    const given = renderWith(<CommentsPane />);
    const field = screen.getByRole("textbox", { name: "New comment" });
    fireEvent.change(field, { target: { value: "Typo" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    });
    expect(given.createComment).toHaveBeenCalledWith("Typo");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(given.cancelComment).toHaveBeenCalled();
  });
});

describe("chat by role", () => {
  const messages = [
    { id: "c1", author: "ana", at: Date.now() - 5_000, body: "Hi all", deleted: false, verified: true },
    { id: "c2", author: "me", at: Date.now(), body: "Hello", deleted: false, verified: true },
    { id: "c3", author: "ana", at: Date.now(), body: "gone", deleted: true, verified: true },
  ];

  it("lets viewers read the chat but not post", () => {
    withRole("viewer", { chat: messages });
    renderWith(<ChatPane />);
    expect(screen.getByText("Hi all")).toBeInTheDocument();
    expect(screen.queryByText("gone")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("You can read the chat. Viewers can't post.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete message" })).toBeNull();
  });

  it("lets commenters post and delete their own messages", async () => {
    withRole("commenter", { chat: messages });
    const given = renderWith(<ChatPane />);
    const deletes = screen.getAllByRole("button", { name: "Delete message" });
    expect(deletes).toHaveLength(1);
    fireEvent.click(deletes[0]);
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

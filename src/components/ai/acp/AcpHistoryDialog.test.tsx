import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpSessionPage: vi.fn(),
  acpSessionRename: vi.fn(),
  acpSessionDelete: vi.fn(),
  acpAgentSessions: vi.fn(),
  acpSessionImport: vi.fn(),
  acpSessions: vi.fn(),
}));
vi.mock("@/lib/toast", async (original) => {
  const actual = await original<typeof import("@/lib/toast")>();
  return { ...actual, toast: { ...actual.toast, error: mocks.toastError } };
});

import {
  acpAgentSessions, acpSessionDelete, acpSessionImport, acpSessionPage, acpSessionRename, acpSessions,
  type AcpSession,
} from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { agent, session } from "./tests/ui-fixtures";
import { AcpHistoryDialog } from "./AcpHistoryDialog";

function search(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Search conversations" }), { target: { value: text } });
}

const rows = (...values: AcpSession[]) => values;
const names: Record<string, string> = { fixture: "Research CLI", codex: "Codex" };

function show({ importAgent = undefined as ReturnType<typeof agent> | undefined } = {}) {
  const onClose = vi.fn();
  const onOpenSession = vi.fn();
  render(
    <AcpHistoryDialog
      projectId="paper"
      open
      onClose={onClose}
      onOpenSession={onOpenSession}
      agentName={(id) => names[id] ?? id}
      importAgent={importAgent}
    />,
  );
  return { onClose, onOpenSession };
}

function row(title: string): HTMLElement {
  const found = screen.getAllByTestId("acp-history-row").find((item) => item.textContent?.includes(title));
  if (!found) throw new Error(`No row ${title}`);
  return found;
}

beforeEach(() => {
  vi.resetAllMocks();
  useAcpSessionsStore.setState({ sessions: {}, events: {}, activeByProject: {}, permissions: {}, elicitations: {} });
  vi.mocked(acpSessionPage).mockResolvedValue({
    sessions: rows(
      session("s1", { title: "Chapter one", updatedAt: 300 }),
      session("s2", { title: "Chapter two", updatedAt: 200, status: "running" }),
      session("child", { title: "Delegated", parentSessionId: "s1", updatedAt: 100 }),
    ),
    hasMore: false,
  });
  vi.mocked(acpSessions).mockResolvedValue([]);
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("AcpHistoryDialog", () => {
  it("searches conversations and loads more", async () => {
    vi.mocked(acpSessionPage).mockResolvedValueOnce({ sessions: rows(session("s1", { title: "Chapter one", updatedAt: 300 })), hasMore: false });
    show();
    await screen.findByText("Chapter one");
    expect(acpSessionPage).toHaveBeenCalledWith("paper", { query: undefined, before: undefined, limit: 50 });
    vi.mocked(acpSessionPage).mockResolvedValueOnce({ sessions: rows(session("c1", { title: "Chapter three", updatedAt: 90 })), hasMore: true });
    search("chapter");
    await screen.findByText("Chapter three");
    expect(acpSessionPage).toHaveBeenLastCalledWith("paper", { query: "chapter", before: undefined, limit: 50 });
    vi.mocked(acpSessionPage).mockResolvedValueOnce({ sessions: rows(session("c0", { title: "Chapter zero", updatedAt: 10 })), hasMore: false });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Chapter zero");
    expect(acpSessionPage).toHaveBeenLastCalledWith("paper", { query: "chapter", before: 90, beforeId: "c1", limit: 50 });
    expect(screen.getAllByTestId("acp-history-row").map((item) => item.textContent?.split("Research CLI")[0])).toEqual(["Chapter three", "Chapter zero"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("loads more from the last conversation of a page, delegated ones included", async () => {
    vi.mocked(acpSessionPage)
      .mockResolvedValueOnce({
        sessions: rows(
          session("s1", { title: "Chapter one", updatedAt: 300 }),
          session("task", { title: "Task run", taskId: "t1", updatedAt: 200 }),
        ),
        hasMore: true,
      })
      .mockResolvedValueOnce({
        sessions: rows(session("child", { title: "Delegated", parentSessionId: "s1", updatedAt: 150 })),
        hasMore: true,
      })
      .mockResolvedValueOnce({ sessions: rows(session("s0", { title: "Chapter zero", updatedAt: 90 })), hasMore: false });
    show();
    await screen.findByText("Chapter one");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(acpSessionPage).toHaveBeenLastCalledWith("paper", { query: undefined, before: 200, beforeId: "task", limit: 50 }),
    );
    // A page of delegated conversations alone still moves on.
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Chapter zero");
    expect(acpSessionPage).toHaveBeenLastCalledWith("paper", { query: undefined, before: 150, beforeId: "child", limit: 50 });
    expect(screen.getAllByTestId("acp-history-row").map((item) => item.textContent?.split("Research CLI")[0])).toEqual([
      "Chapter one",
      "Chapter zero",
    ]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("hides delegated conversations and says when nothing matches", async () => {
    show();
    await screen.findByText("Chapter one");
    expect(screen.queryByText("Delegated")).toBeNull();
    vi.mocked(acpSessionPage).mockResolvedValueOnce({ sessions: [], hasMore: false });
    search("zzz");
    expect(await screen.findByText("No conversations match.")).toBeInTheDocument();
  });

  it("shows a loading failure", async () => {
    vi.mocked(acpSessionPage).mockRejectedValueOnce(new Error("The conversation list could not be read."));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("The conversation list could not be read.");
  });

  it("has a visible close button", async () => {
    const { onClose } = show();
    await screen.findByText("Chapter one");
    const buttons = screen.getAllByRole("button", { name: "Close" });
    // The invisible backdrop also closes; the one in the header is the visible control.
    fireEvent.click(buttons.at(-1) as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens a conversation and closes the dialog", async () => {
    const { onClose, onOpenSession } = show();
    fireEvent.click(await screen.findByRole("button", { name: "Chapter one" }));
    expect(onOpenSession).toHaveBeenCalledWith("s1");
    expect(onClose).toHaveBeenCalled();
  });

  it("renames a conversation", async () => {
    useAcpSessionsStore.setState({ sessions: { s1: session("s1", { title: "Chapter one" }) } });
    vi.mocked(acpSessionRename).mockResolvedValue(session("s1", { title: "Introduction", updatedAt: 300 }));
    show();
    await screen.findByText("Chapter one");
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(input, { target: { value: "  Introduction  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(acpSessionRename).toHaveBeenCalledWith("paper", "s1", "Introduction"));
    expect(acpSessionRename).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Introduction")).toBeInTheDocument();
    expect(useAcpSessionsStore.getState().sessions.s1).toMatchObject({ title: "Introduction", titleLocked: true });
  });

  it("keeps the name when the edit is cancelled, empty or unchanged", async () => {
    show();
    await screen.findByText("Chapter one");
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Rename" }));
    let input = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(input, { target: { value: "Other" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Conversation name" })).toBeNull();
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Rename" }));
    input = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Rename" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Conversation name" }));
    expect(acpSessionRename).not.toHaveBeenCalled();
  });

  it("shows a rename failure", async () => {
    vi.mocked(acpSessionRename).mockRejectedValue("The name is too long.");
    show();
    await screen.findByText("Chapter one");
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("The name is too long.");
  });

  it("deletes here and in the agent when asked", async () => {
    vi.mocked(acpSessionPage).mockResolvedValue({
      sessions: rows(session("s1", { title: "Chapter one", capabilities: { ...session("s1").capabilities, delete: true } })),
      hasMore: false,
    });
    vi.mocked(acpSessionDelete).mockResolvedValue({ agentDeleted: true, agentError: null });
    useAcpSessionsStore.setState({
      sessions: { s1: session("s1") }, events: { s1: [] }, activeByProject: { paper: "s1" },
    });
    show();
    await screen.findByText("Chapter one");
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this conversation?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Also delete it from Research CLI" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(acpSessionDelete).toHaveBeenCalledWith("paper", "s1", true));
    await waitFor(() => expect(screen.queryByText("Chapter one")).toBeNull());
    const state = useAcpSessionsStore.getState();
    expect(state.sessions.s1).toBeUndefined();
    expect(state.events.s1).toBeUndefined();
    expect(state.activeByProject.paper).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("deletes only in Oleafly when the agent cannot, and reports the agent's failure", async () => {
    vi.mocked(acpSessionDelete).mockResolvedValue({ agentDeleted: false, agentError: "not found" });
    useAcpSessionsStore.setState({ sessions: { s1: session("s1") }, activeByProject: { paper: "other" } });
    show();
    await screen.findByText("Chapter one");
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(acpSessionDelete).toHaveBeenCalledWith("paper", "s1", false));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Deleted in Oleafly. Research CLI could not delete its copy: not found"));
    expect(useAcpSessionsStore.getState().activeByProject.paper).toBe("other");
  });

  it("keeps the conversation when the delete is cancelled or fails", async () => {
    vi.mocked(acpSessionDelete).mockRejectedValue(new Error("The database is locked."));
    show();
    await screen.findByText("Chapter one");
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Delete" }));
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(within(row("Chapter one")).getByRole("button", { name: "Delete" }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The database is locked.");
    expect(screen.getByText("Chapter one")).toBeInTheDocument();
  });

  it("refuses to delete a running conversation", async () => {
    show();
    await screen.findByText("Chapter two");
    expect(within(row("Chapter two")).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(within(row("Chapter one")).getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("imports conversations the agent knows for this folder", async () => {
    const codex = agent("codex", { definition: { ...agent().definition, id: "codex", name: "Codex" } });
    codex.runtime = {
      protocol: 1, protocolLabel: "ACP v1", providers: false, providersSupported: [], steering: false, sessionList: true,
      sessionFork: false, sessionDelete: false, logout: false, authMethods: [], checkedAt: 1,
    };
    vi.mocked(acpAgentSessions)
      .mockResolvedValueOnce({
        sessions: [
          { nativeSessionId: "n1", title: "Old work", updatedAt: null, cwd: "/paper", imported: true },
          { nativeSessionId: "n2", title: null, updatedAt: null, cwd: "/paper", imported: false },
        ],
        nextCursor: "more",
      })
      .mockResolvedValueOnce({
        sessions: [{ nativeSessionId: "n3", title: "Later", updatedAt: null, cwd: "/paper", imported: false }],
        nextCursor: null,
      });
    vi.mocked(acpSessionImport).mockResolvedValue([session("imported")]);
    show({ importAgent: codex });
    await screen.findByText("Chapter one");
    fireEvent.click(screen.getByRole("button", { name: "Find Codex conversations for this project" }));
    await screen.findByText("Old work");
    expect(acpAgentSessions).toHaveBeenCalledWith("paper", "codex", null);
    expect(screen.getByRole("checkbox", { name: /Old work/ })).toBeDisabled();
    expect(screen.getByText("Already in Oleafly")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import selected" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Later");
    expect(acpAgentSessions).toHaveBeenLastCalledWith("paper", "codex", "more");
    fireEvent.click(screen.getByRole("checkbox", { name: "n2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Later" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Later" }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await waitFor(() => expect(acpSessionImport).toHaveBeenCalledWith("paper", "codex", ["n2"]));
    await waitFor(() => expect(acpSessions).toHaveBeenCalledWith("paper"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find Codex conversations for this project" })).toBeInTheDocument());
  });

  it("says when the agent has nothing to import and reports import failures", async () => {
    const codex = agent("codex", { definition: { ...agent().definition, id: "codex", name: "Codex" } });
    codex.runtime = {
      protocol: 1, protocolLabel: "ACP v1", providers: false, providersSupported: [], steering: false, sessionList: true,
      sessionFork: false, sessionDelete: false, logout: false, authMethods: [], checkedAt: 1,
    };
    vi.mocked(acpAgentSessions).mockRejectedValueOnce(new Error("The agent cannot list conversations."));
    show({ importAgent: codex });
    await screen.findByText("Chapter one");
    fireEvent.click(screen.getByRole("button", { name: "Find Codex conversations for this project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The agent cannot list conversations.");
    vi.mocked(acpAgentSessions).mockResolvedValueOnce({ sessions: [], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Find Codex conversations for this project" }));
    expect(await screen.findByText("Codex has no other conversations for this project.")).toBeInTheDocument();
  });

  it("offers no import for agents that cannot list conversations", async () => {
    show({ importAgent: agent() });
    await screen.findByText("Chapter one");
    expect(screen.queryByRole("button", { name: /Find .* conversations/ })).toBeNull();
  });
});

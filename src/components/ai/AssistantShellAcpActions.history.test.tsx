import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./acp/tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

const mocks = vi.hoisted(() => ({ exportConversation: vi.fn(), toastSuccess: vi.fn() }));

vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpSessionPage: vi.fn(),
  acpDisconnect: vi.fn(),
  acpSnapshot: vi.fn(),
  acpEvents: vi.fn(),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
vi.mock("@/components/ai/acp/export-conversation", () => ({ exportConversation: mocks.exportConversation }));
vi.mock("@/lib/toast", async (original) => {
  const actual = await original<typeof import("@/lib/toast")>();
  return { ...actual, toast: { ...actual.toast, success: mocks.toastSuccess } };
});

import { acpDisconnect, acpEvents, acpSessionPage, acpSnapshot, type AcpSession } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { agent, session } from "./acp/tests/ui-fixtures";
import { AssistantShellAcpActions } from "./AssistantShellAcpActions";

async function openHistory(): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByTestId("acp-history-picker"), { button: 0, ctrlKey: false, pointerType: "mouse" });
  return await waitFor(() => {
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    if (!menu) throw new Error("The history menu did not open.");
    return menu;
  });
}

function conversations(count: number): Record<string, AcpSession> {
  const entries: [string, AcpSession][] = [];
  for (let index = 1; index <= count; index++) {
    entries.push([`c${index}`, session(`c${index}`, { title: `Conversation ${index}`, updatedAt: index })]);
  }
  entries.push(["task", session("task", { title: "Task run", taskId: "t1", updatedAt: 999 })]);
  entries.push(["elsewhere", session("elsewhere", { projectId: "other", title: "Other project", updatedAt: 998 })]);
  return Object.fromEntries(entries);
}

beforeEach(() => {
  vi.resetAllMocks();
  useAcpSessionsStore.setState({
    catalog: [agent()], sessions: conversations(25), activeByProject: { paper: "c25" }, events: {}, permissions: {},
    elicitations: {}, composers: { paper: { agentId: "fixture" } }, errors: {},
  });
  vi.mocked(acpSessionPage).mockResolvedValue({ sessions: [session("c25", { title: "Conversation 25" })], hasMore: false });
  vi.mocked(acpDisconnect).mockResolvedValue();
  vi.mocked(acpSnapshot).mockImplementation(async (_project, id) => ({ session: session(id, { title: `Conversation ${id}` }), permissions: [] }));
  vi.mocked(acpEvents).mockResolvedValue({ events: [], hasMore: false });
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("the CLI history menu", () => {
  it("lists the 20 newest conversations of this project, without task runs", async () => {
    render(<AssistantShellAcpActions projectId="paper" />);
    const menu = await openHistory();
    const items = within(menu).getAllByRole("menuitem").filter((item) => item.getAttribute("data-value"));
    expect(items).toHaveLength(20);
    expect(items[0]).toHaveTextContent("Conversation 25 · Research CLI");
    expect(items[0]).toHaveAttribute("data-current", "true");
    expect(items[19]).toHaveTextContent("Conversation 6");
    expect(within(menu).queryByText(/Task run/)).toBeNull();
    expect(within(menu).queryByText(/Other project/)).toBeNull();
  });

  it("opens all conversations from the history menu", async () => {
    render(<AssistantShellAcpActions projectId="paper" />);
    const menu = await openHistory();
    fireEvent.click(within(menu).getByTestId("acp-history-all"));
    const dialog = await screen.findByTestId("acp-history-dialog");
    expect(within(dialog).getByRole("textbox", { name: "Search conversations" })).toBeInTheDocument();
    await waitFor(() => expect(acpSessionPage).toHaveBeenCalledWith("paper", { query: undefined, before: undefined, limit: 50 }));
    // Besides the close button in its header, the backdrop around the dialog
    // closes it on mouse down, and so does Escape.
    fireEvent.mouseDown(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(screen.queryByTestId("acp-history-dialog")).toBeNull());
  });

  it("opens a saved conversation after closing the idle one", async () => {
    render(<AssistantShellAcpActions projectId="paper" />);
    const menu = await openHistory();
    fireEvent.click(within(menu).getByText(/Conversation 7 ·/));
    await waitFor(() => expect(useAcpSessionsStore.getState().activeByProject.paper).toBe("c7"));
    expect(acpDisconnect).toHaveBeenCalledWith("paper", "c25");
    expect(acpSnapshot).toHaveBeenCalledWith("paper", "c7");
  });

  it("does nothing when the open conversation is chosen again", async () => {
    render(<AssistantShellAcpActions projectId="paper" />);
    const menu = await openHistory();
    fireEvent.click(within(menu).getByText(/Conversation 25 ·/));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acpDisconnect).not.toHaveBeenCalled();
    expect(acpSnapshot).not.toHaveBeenCalled();
  });

  it("exports the open conversation", async () => {
    mocks.exportConversation.mockResolvedValue(true);
    render(<AssistantShellAcpActions projectId="paper" />);
    const menu = await openHistory();
    fireEvent.click(within(menu).getByTestId("acp-export-conversation"));
    await waitFor(() => expect(mocks.exportConversation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "paper", agentName: "Research CLI", session: expect.objectContaining({ id: "c25" }),
    })));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
  });

  it("keeps the history closed while a turn runs", () => {
    useAcpSessionsStore.setState((state) => ({ sessions: { ...state.sessions, c25: { ...state.sessions.c25, status: "running" } } }));
    render(<AssistantShellAcpActions projectId="paper" />);
    expect(screen.getByTestId("acp-history-picker")).toBeDisabled();
    expect(screen.getByTestId("acp-new-conversation")).toBeDisabled();
  });
});

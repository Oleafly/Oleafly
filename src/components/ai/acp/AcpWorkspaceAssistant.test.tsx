import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { installUiDom } = await import("./tests/ui-fixtures");
  return installUiDom();
});
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), acpEvents: vi.fn(),
  acpStart: vi.fn(), acpAuthenticate: vi.fn(), acpDisconnect: vi.fn(), acpReconnect: vi.fn(),
  acpSetModel: vi.fn(), acpPrompt: vi.fn(), acpPermission: vi.fn(), acpCancel: vi.fn(),
  onAcpEvent: vi.fn(), onAcpResync: vi.fn(),
}));
import {
  acpAuthenticate, acpCancel, acpCatalog, acpDisconnect, acpEvents, acpPermission, acpPrompt,
  acpReconnect, acpSessions, acpSetModel, acpSnapshot, acpStart, onAcpEvent, onAcpResync,
  type AcpEvent, type AcpPermission, type AcpSnapshot,
} from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { agent, deferred, event, session } from "./tests/ui-fixtures";
import { AcpWorkspaceAssistant } from "./AcpWorkspaceAssistant";

let snapshots: Record<string, AcpSnapshot>;
let history: Record<string, AcpEvent[]>;
let emit: (value: AcpEvent) => void;
const stopEvents = vi.fn();
const stopResync = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  snapshots = { saved: { session: session(), permissions: [] } };
  history = { saved: [] };
  emit = () => { throw new Error("The native event listener is not attached"); };
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: { paper: "saved" } });
  vi.mocked(acpCatalog).mockResolvedValue([agent()]);
  vi.mocked(acpSessions).mockImplementation(async () => Object.values(snapshots).map((value) => value.session));
  vi.mocked(acpSnapshot).mockImplementation(async (_project, id) => {
    if (!snapshots[id]) throw new Error("Conversation missing");
    return snapshots[id];
  });
  vi.mocked(acpEvents).mockImplementation(async (_project, id, after = 0, limit = 300) => {
    const remaining = (history[id] ?? []).filter((value) => value.sequence > after);
    return { events: remaining.slice(0, limit), hasMore: remaining.length > limit };
  });
  vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return stopEvents; });
  vi.mocked(onAcpResync).mockResolvedValue(stopResync);
  vi.mocked(acpDisconnect).mockResolvedValue();
});
afterEach(cleanup);
afterAll(restore);

function typeMessage(input: HTMLElement, value: string) {
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
}

async function publish(...events: AcpEvent[]) {
  act(() => { for (const value of events) emit(value); });
  await waitFor(() => expect(useAcpSessionsStore.getState().events[events[0].sessionId]?.at(-1)?.sequence).toBe(events.at(-1)?.sequence));
}

function permission(overrides: Partial<AcpPermission> = {}): AcpPermission {
  return { id: "request", sessionId: "saved", turnId: "turn", title: "Read the linked evidence?", toolCallId: "tool", options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }], expiresAt: Date.now() + 60_000, ...overrides };
}

describe("ACP assistant acceptance", () => {
  it("reopens persisted messages, loads older activity, and retains unknown usage without inventing token totals", async () => {
    history.saved = [
      event(1, "user_message", { text: "Compare the source methods" }),
      ...Array.from({ length: 300 }, (_, index) => event(index + 2, "usage_update", { used: 900, size: 8000, inputTokens: null, outputTokens: null })),
      event(302, "agent_message_chunk", { content: { type: "text", text: "The saved methods comparison." } }),
      event(303, "turn_complete", { stopReason: "end_turn" }),
    ];
    snapshots.saved = { session: session("saved", { status: "disconnected", lastSequence: 303 }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    expect(await ui.findByText("The saved methods comparison.")).toBeInTheDocument();
    expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 3);
    expect(ui.queryByText("Compare the source methods")).not.toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: "Load earlier activity" }));
    expect(await ui.findByText("Compare the source methods")).toBeInTheDocument();
    expect(acpEvents).toHaveBeenLastCalledWith("paper", "saved", 0, 3);
    expect(ui.queryByRole("button", { name: "Load earlier activity" })).not.toBeInTheDocument();
    expect(useAcpSessionsStore.getState().events.saved).toHaveLength(303);
    expect(useAcpSessionsStore.getState().events.saved[1].data).toMatchObject({ inputTokens: null, outputTokens: null });
    expect(ui.container).not.toHaveTextContent("900 tokens");
    expect(ui.container).not.toHaveTextContent("0 tokens");
    ui.unmount();
    expect(stopEvents).toHaveBeenCalledOnce();
    expect(stopResync).toHaveBeenCalledOnce();
    const reopened = render(<AcpWorkspaceAssistant projectId="paper" />);
    expect(await reopened.findByText("The saved methods comparison.")).toBeInTheDocument();
    await waitFor(() => expect(onAcpEvent).toHaveBeenCalledTimes(2));
    expect(reopened.getAllByText("The saved methods comparison.")).toHaveLength(1);
    expect(useAcpSessionsStore.getState().events.saved).toHaveLength(303);
    expect(acpStart).not.toHaveBeenCalled();
  });

  it("starts the chosen CLI, exposes authentication errors, and reconnects only after disconnect finishes", async () => {
    useAcpSessionsStore.setState({ activeByProject: {} });
    snapshots = {};
    const required = session("new", { status: "auth_required", authMethods: [{ id: "browser-login", name: "Sign in in browser", description: null }] });
    vi.mocked(acpStart).mockRejectedValueOnce(new Error("The agent executable is missing.")).mockResolvedValueOnce({ session: required, permissions: [] });
    vi.mocked(acpAuthenticate).mockRejectedValueOnce(new Error("Complete sign-in in the CLI."));
    const disconnect = deferred<void>();
    vi.mocked(acpDisconnect).mockReturnValueOnce(disconnect.promise);
    vi.mocked(acpReconnect).mockResolvedValue({ session: session("new"), permissions: [] });
    vi.mocked(acpSetModel).mockImplementation(async (_project, id, modelId) => ({ session: { ...session(id), controls: { ...session(id).controls, modelId } }, permissions: [] }));
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await ui.findByRole("option", { name: "Research CLI" });
    fireEvent.change(ui.getByLabelText("Agent"), { target: { value: "fixture" } });
    fireEvent.click(ui.getByRole("button", { name: "New conversation" }));
    expect(await ui.findByRole("alert")).toHaveTextContent("The agent executable is missing.");
    expect(ui.getByLabelText("Message CLI agent")).toBeDisabled();
    fireEvent.click(ui.getByRole("button", { name: "New conversation" }));
    fireEvent.click(await ui.findByRole("button", { name: "Sign in in browser" }));
    expect(await ui.findByRole("alert")).toHaveTextContent("Complete sign-in in the CLI.");
    expect(acpAuthenticate).toHaveBeenCalledExactlyOnceWith("paper", "new", "browser-login");
    fireEvent.click(ui.getByRole("button", { name: "Reconnect after sign-in" }));
    expect(acpDisconnect).toHaveBeenCalledExactlyOnceWith("paper", "new");
    expect(acpReconnect).not.toHaveBeenCalled();
    expect(ui.getByRole("button", { name: "Reconnect after sign-in" })).toBeDisabled();
    await act(async () => disconnect.resolve());
    await waitFor(() => expect(ui.getByLabelText("Message CLI agent")).toBeEnabled());
    expect(acpReconnect).toHaveBeenCalledExactlyOnceWith("paper", "new");
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(ui.getByLabelText("Agent model"), { target: { value: "chosen" } });
    await waitFor(() => expect(ui.getByLabelText("Agent model")).toHaveValue("chosen"));
    expect(acpSetModel).toHaveBeenCalledExactlyOnceWith("paper", "new", "chosen");
    expect(vi.mocked(acpStart).mock.calls).toEqual([["paper", "fixture"], ["paper", "fixture"]]);
  });

  it("renders streamed reasoning and tool results, and keeps a rejected permission available for retry", async () => {
    vi.mocked(acpPrompt).mockImplementation(async (_project, _id, text) => {
      const accepted = event(1, "user_message", { text });
      history.saved = [accepted];
      snapshots.saved = { session: session("saved", { status: "running", lastSequence: 1 }), permissions: [] };
      emit(accepted);
      return snapshots.saved;
    });
    const pending = deferred<void>();
    vi.mocked(acpPermission).mockReturnValueOnce(pending.promise).mockResolvedValue();
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    typeMessage(ui.getByLabelText("Message CLI agent"), "Check the linked evidence");
    fireEvent.click(ui.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(ui.getByRole("button", { name: "Stop" })).toBeEnabled());
    expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", "Check the linked evidence", []);
    const request = permission();
    await publish(
      event(2, "agent_thought_chunk", { content: { type: "text", text: "I will compare the sample sizes." } }),
      event(3, "tool_call", { toolCallId: "tool", title: "Read linked evidence", status: "in_progress" }),
      event(4, "permission", { ...request }),
    );
    const approval = ui.getByRole("group", { name: "Agent permission" });
    fireEvent.click(within(approval).getByRole("button", { name: "Allow once" }));
    expect(within(approval).getByRole("button", { name: "Allow once" })).toBeDisabled();
    expect(within(approval).getByRole("button", { name: "Dismiss" })).toBeDisabled();
    await act(async () => pending.reject(new Error("Permission response could not be sent.")));
    expect(ui.getByRole("alert")).toHaveTextContent("Permission response could not be sent.");
    fireEvent.click(within(approval).getByRole("button", { name: "Allow once" }));
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(acpPermission).toHaveBeenCalledTimes(2));
    expect(acpPermission).toHaveBeenLastCalledWith("paper", "saved", "request", "allow-once");
    snapshots.saved = { session: session("saved", { status: "ready", lastSequence: 8 }), permissions: [] };
    await publish(
      event(5, "permission_resolved", { id: "request" }),
      event(6, "tool_call_update", { toolCallId: "tool", status: "completed", content: [{ type: "content", content: { type: "text", text: "Both sources used 120 participants." } }] }),
      event(7, "agent_message_chunk", { content: { type: "text", text: "The sample sizes match." } }),
      event(8, "turn_complete", { stopReason: "end_turn" }),
    );
    expect(await ui.findByText("The sample sizes match.")).toBeInTheDocument();
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
    expect(ui.queryByRole("group", { name: "Agent permission" })).not.toBeInTheDocument();
    for (const group of ui.getAllByRole("button", { name: /Worked through/ })) fireEvent.click(group);
    fireEvent.click(ui.getByRole("button", { name: "Reasoning" }));
    expect(await ui.findByText("I will compare the sample sizes.")).toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: /Read linked evidence/ }));
    expect(ui.getByText("Both sources used 120 participants.")).toBeInTheDocument();
    expect(ui.getByLabelText("Message CLI agent")).toHaveValue("");
    expect(ui.getByLabelText("Message CLI agent")).toBeEnabled();
  });

  it("retries a failed stop, catches up to cancellation, and retains the partial answer for reconnect", async () => {
    history.saved = [event(1, "user_message", { text: "Review these results" }), event(2, "agent_message_chunk", { content: { type: "text", text: "The first result needs a larger sample." } })];
    snapshots.saved = { session: session("saved", { status: "running", lastSequence: 2 }), permissions: [] };
    vi.mocked(acpCancel).mockRejectedValueOnce(new Error("The agent could not be stopped yet.")).mockImplementationOnce(async () => {
      history.saved.push(event(3, "turn_complete", { stopReason: "cancelled" }));
      snapshots.saved = { session: session("saved", { status: "cancelled", lastSequence: 3 }), permissions: [] };
    });
    vi.mocked(acpReconnect).mockRejectedValueOnce(new Error("The executable is temporarily unavailable.")).mockResolvedValueOnce({ session: session("saved", { lastSequence: 3 }), permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await ui.findByText("The first result needs a larger sample.");
    expect(ui.getByLabelText("Message CLI agent")).toBeDisabled();
    fireEvent.click(ui.getByRole("button", { name: "Stop" }));
    expect(await ui.findByRole("alert")).toHaveTextContent("The agent could not be stopped yet.");
    fireEvent.click(ui.getByRole("button", { name: "Stop" }));
    const reconnect = await ui.findByRole("button", { name: "Reconnect to conversation" });
    expect(acpCancel).toHaveBeenCalledTimes(2);
    expect(acpCancel).toHaveBeenLastCalledWith("paper", "saved");
    expect(acpEvents).toHaveBeenLastCalledWith("paper", "saved", 2);
    expect(ui.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(ui.getByText("The first result needs a larger sample.")).toBeInTheDocument();
    fireEvent.click(reconnect);
    expect(await ui.findByRole("alert")).toHaveTextContent("The executable is temporarily unavailable.");
    fireEvent.click(reconnect);
    await waitFor(() => expect(ui.getByLabelText("Message CLI agent")).toBeEnabled());
    expect(acpReconnect).toHaveBeenLastCalledWith("paper", "saved");
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
    expect(ui.getByText("The first result needs a larger sample.")).toBeInTheDocument();
  });

  it("does not offer expired approvals or reconnect a task conversation outside the task lifecycle", async () => {
    snapshots.saved = { session: session("saved", { status: "failed", taskId: "task-42" }), permissions: [permission({ expiresAt: Date.now() - 1000 })] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    expect(await ui.findByText("Open the research task to resume this work.")).toBeInTheDocument();
    expect(ui.getByRole("group", { name: "Agent permission" })).toHaveTextContent("This request expired.");
    expect(ui.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
    expect(ui.queryByRole("button", { name: "Reconnect to conversation" })).not.toBeInTheDocument();
    expect(acpPermission).not.toHaveBeenCalled();
    expect(acpReconnect).not.toHaveBeenCalled();
  });
});

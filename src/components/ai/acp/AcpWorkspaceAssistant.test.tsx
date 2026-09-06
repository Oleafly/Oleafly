import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as renderWithoutProviders, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
vi.mock("@/lib/skills", async (original) => ({
  ...await original<typeof import("@/lib/skills")>(),
  useSkills: () => ({
    data: [
      {
        id: "fixture-skill",
        name: "Fixture skill",
        description: "A skill the fixture offers.",
        instructions: "",
        dir: "/skills/fixture-skill",
        files: [],
        allowedTools: [],
        tier: "native",
        phase: "research",
        tools: [],
        source: "bundled",
        updateAvailable: false,
        projectEnabled: false,
        enabled: true,
        removable: false,
        validation: { status: "valid" },
      },
    ],
    isPending: false,
    isFetching: false,
  }),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
import type { ReactNode } from "react";
import {
  acpAuthenticate, acpCancel, acpCatalog, acpDisconnect, acpEvents, acpPermission, acpPrompt,
  acpReconnect, acpSessions, acpSetModel, acpSnapshot, acpStart, onAcpEvent, onAcpResync,
  type AcpEvent, type AcpPermission, type AcpSnapshot,
} from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { AssistantShellAcpActions } from "@/components/ai/AssistantShellAcpActions";
import {
  agent, chooseMenuItem, chooseOption, deferred, event, menuItemNames, session,
} from "./tests/ui-fixtures";
import { AcpWorkspaceAssistant } from "./AcpWorkspaceAssistant";

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithoutProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function AcpWorkspace({ projectId = "paper" }: { projectId?: string }) {
  return (
    <>
      <AssistantShellAcpActions projectId={projectId} />
      <AcpWorkspaceAssistant projectId={projectId} />
    </>
  );
}

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
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: { paper: "saved" }, composers: {}, errors: {} });
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
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
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
    const ui = render(<AcpWorkspace />);
    await waitFor(() => expect(ui.getByTestId("agent-picker-fixture")).toHaveTextContent("Research CLI"));
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
    await chooseOption(ui.getByRole("combobox", { name: "Agent model" }), "Chosen model");
    await waitFor(() => expect(ui.getByRole("combobox", { name: "Agent model" })).toHaveTextContent("Chosen model"));
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

  it("defaults to a ready agent, keeps the draft across remounts, and offers the bridge install for the rest", async () => {
    useAcpSessionsStore.setState({ activeByProject: {} });
    snapshots = {};
    const missing = agent("claude", {
      definition: { ...agent().definition, id: "claude", name: "Claude Code", builtin: true },
      installed: false, executable: null, managed: false, canInstall: true,
      cli: { command: "claude", displayName: "Claude Code", path: "/home/researcher/.local/bin/claude", version: "2.1.258", signInCommand: "claude auth login" },
    });
    vi.mocked(acpCatalog).mockResolvedValue([missing, agent()]);
    const ui = render(<AcpWorkspace />);
    await waitFor(() => expect(ui.getByTestId("agent-picker-fixture")).toHaveTextContent("Research CLI"));
    expect(ui.getByRole("button", { name: "New conversation" })).toBeEnabled();
    expect(
      [...ui.getByTestId("agent-picker-row").querySelectorAll("button")]
        .map((node) => node.getAttribute("aria-label"))
        .slice(0, 2),
    ).toEqual(["Claude Code", "Research CLI"]);
    fireEvent.click(ui.getByTestId("agent-picker-claude"));
    await waitFor(() => expect(ui.getByRole("button", { name: "New conversation" })).toBeDisabled());
    expect(ui.getByTestId("acp-bridge-card-claude")).toHaveTextContent(
      "Claude Code 2.1.258 found at /home/researcher/.local/bin/claude",
    );
    expect(ui.container).not.toHaveTextContent("not installed");
    expect(useAcpSessionsStore.getState().composers.paper?.agentId).toBe("claude");
    ui.unmount();
    const reopened = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(reopened.getByTestId("agent-picker-claude")).toHaveTextContent("Claude Code"));
  });

  it("starts a conversation from the empty state and shows the session status inside the composer", async () => {
    useAcpSessionsStore.setState({ activeByProject: {} });
    snapshots = {};
    vi.mocked(acpStart).mockResolvedValueOnce({ session: session("new"), permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const start = await ui.findByTestId("acp-start-conversation");
    expect(ui.getByTestId("assistant-home")).toHaveTextContent("What would you like to do today?");
    expect(ui.queryByTestId("assistant-home-cards")).not.toBeInTheDocument();
    expect(ui.queryByTestId("assistant-home-chips")).not.toBeInTheDocument();
    expect(ui.queryByRole("tablist")).not.toBeInTheDocument();
    const roster = ui.getByTestId("agent-picker-row");
    const rosterNames = [...roster.querySelectorAll("button")].map((node) => node.getAttribute("aria-label"));
    expect(rosterNames[0]).toBe("Research CLI");
    expect(rosterNames).toEqual(expect.arrayContaining(["Claude Code", "Codex CLI", "Pi", "Hermes Agent", "Google Antigravity"]));
    expect(rosterNames).toHaveLength(16);
    expect(ui.getByTestId("agent-picker-fixture")).toHaveAttribute("aria-pressed", "true");
    expect(ui.getByTestId("agent-picker-pi")).toHaveAttribute("data-available", "false");
    expect(new Set(rosterNames).size).toBe(rosterNames.length);
    expect(ui.queryByTestId("acp-session-status")).not.toBeInTheDocument();
    expect(ui.container).not.toHaveTextContent("CLI account limits apply");
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(acpStart).toHaveBeenCalledExactlyOnceWith("paper", "fixture"));
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("fixture · ready"));
    expect(ui.getByTestId("acp-session-status")).toHaveAttribute("data-status", "ready");
    expect(ui.getByTestId("assistant-home")).toHaveTextContent("Research CLI is ready in this project");
    expect(ui.getByTestId("assistant-home")).toHaveTextContent("What would you like to do today?");
    expect(ui.getByTestId("assistant-home-cards")).toBeInTheDocument();
    expect(ui.getByTestId("agent-picker-row")).toBeInTheDocument();
    expect(ui.queryByTestId("acp-start-conversation")).not.toBeInTheDocument();
    const controls = ui.getByTestId("acp-composer-controls");
    expect(ui.getByTestId("agent-picker-fixture")).toHaveTextContent("Research CLI");
    expect(within(controls).getByRole("combobox", { name: "Agent model" })).toHaveTextContent("First model");
    expect(within(controls).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("moves the live conversation to the agent the picker chooses", async () => {
    const other = agent("other", {
      definition: { ...agent().definition, id: "other", name: "Other CLI" },
    });
    vi.mocked(acpCatalog).mockResolvedValue([agent(), other]);
    vi.mocked(acpStart).mockResolvedValue({
      session: session("switched", { agentId: "other" }),
      permissions: [],
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    expect(ui.getByTestId("acp-session-status")).toHaveTextContent("fixture · ready");

    fireEvent.click(ui.getByTestId("agent-picker-other"));

    await waitFor(() => expect(acpStart).toHaveBeenCalledExactlyOnceWith("paper", "other"));
    expect(acpDisconnect).toHaveBeenCalledExactlyOnceWith("paper", "saved");
    await waitFor(() => expect(useAcpSessionsStore.getState().activeByProject.paper).toBe("switched"));
    expect(useAcpSessionsStore.getState().composers.paper?.agentId).toBe("other");
  });

  it("does not carry the previous agent's model into the new conversation", async () => {
    const other = agent("other", {
      definition: { ...agent().definition, id: "other", name: "Other CLI" },
    });
    vi.mocked(acpCatalog).mockResolvedValue([agent(), other]);
    const switched = session("switched", { agentId: "other" });
    vi.mocked(acpStart).mockResolvedValue({
      session: {
        ...switched,
        controls: {
          modelId: "codex-spark",
          modelConfigId: null,
          models: [{ modelId: "codex-spark", name: "Codex Spark" }],
        },
      },
      permissions: [],
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    expect(ui.getByRole("combobox", { name: "Agent model" })).toHaveTextContent("First model");

    fireEvent.click(ui.getByTestId("agent-picker-other"));

    await waitFor(() =>
      expect(ui.getByRole("combobox", { name: "Agent model" })).toHaveTextContent("Codex Spark"),
    );
    expect(acpSetModel).not.toHaveBeenCalled();
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("drops the open conversation when the chosen agent is not installed yet", async () => {
    const missing = agent("missing", {
      definition: { ...agent().definition, id: "missing", name: "Missing CLI" },
      installed: false,
      executable: null,
    });
    vi.mocked(acpCatalog).mockResolvedValue([agent(), missing]);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));

    fireEvent.click(ui.getByTestId("agent-picker-missing"));

    await waitFor(() => expect(acpDisconnect).toHaveBeenCalledExactlyOnceWith("paper", "saved"));
    expect(acpStart).not.toHaveBeenCalled();
    await waitFor(() => expect(useAcpSessionsStore.getState().activeByProject.paper).toBeNull());
    expect(ui.queryByTestId("acp-session-status")).not.toBeInTheDocument();
  });

  it("shows a starting state while a conversation opens from the header", async () => {
    useAcpSessionsStore.setState({ activeByProject: {} });
    snapshots = {};
    const pending = deferred<AcpSnapshot>();
    vi.mocked(acpStart).mockReturnValueOnce(pending.promise);
    const ui = render(<AcpWorkspace />);
    await waitFor(() => expect(ui.getByRole("button", { name: "New conversation" })).toBeEnabled());
    expect(ui.queryByTestId("acp-connecting")).not.toBeInTheDocument();

    fireEvent.click(ui.getByRole("button", { name: "New conversation" }));

    const connecting = await ui.findByTestId("acp-connecting");
    expect(connecting).toHaveTextContent("Starting Research CLI");
    expect(ui.queryByTestId("assistant-home")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({ session: session("new"), permissions: [] });
    });
    await waitFor(() => expect(ui.queryByTestId("acp-connecting")).not.toBeInTheDocument());
    expect(ui.getByTestId("acp-session-status")).toHaveTextContent("fixture · ready");
  });

  it("keeps the composer draft when the panel unmounts", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    typeMessage(ui.getByLabelText("Message CLI agent"), "Half written question");
    expect(useAcpSessionsStore.getState().composers.paper?.draft).toBe("Half written question");
    ui.unmount();
    const reopened = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(reopened.getByLabelText("Message CLI agent")).toHaveValue("Half written question"));
  });

  it("hides delegated conversations from the saved list", async () => {
    snapshots = {
      saved: { session: session(), permissions: [] },
      "task-run": { session: session("task-run", { taskId: "task-9", title: "Task conversation" }), permissions: [] },
      "child-run": { session: session("child-run", { parentSessionId: "chat-1", title: "Delegated conversation" }), permissions: [] },
    };
    history["task-run"] = [];
    history["child-run"] = [];
    const ui = render(<AcpWorkspace />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    const names = await menuItemNames(ui.getByRole("button", { name: "Saved conversations" }));
    expect(names).toEqual(["Conversation saved · fixture"]);
  });

  it("opens a saved conversation from the header menu after disconnecting the current one", async () => {
    snapshots.other = { session: session("other", { status: "disconnected", title: "Earlier review" }), permissions: [] };
    history.other = [];
    const ui = render(<AcpWorkspace />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    await chooseMenuItem(
      ui.getByRole("button", { name: "Saved conversations" }),
      "Earlier review · fixture",
    );
    await waitFor(() => expect(acpDisconnect).toHaveBeenCalledExactlyOnceWith("paper", "saved"));
    await waitFor(() => expect(useAcpSessionsStore.getState().activeByProject.paper).toBe("other"));
    expect(acpEvents).toHaveBeenLastCalledWith("paper", "other", 0);
  });

  it("does not offer reconnect for a delegated child conversation", async () => {
    snapshots.saved = { session: session("saved", { status: "failed", parentSessionId: "chat-1" }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    expect(await ui.findByText("This conversation belongs to a delegated agent run.")).toBeInTheDocument();
    expect(ui.queryByRole("button", { name: "Reconnect to conversation" })).not.toBeInTheDocument();
  });

  it("re-enables the composer when a stop leaves the agent connected", async () => {
    history.saved = [event(1, "user_message", { text: "Review these results" })];
    snapshots.saved = { session: session("saved", { status: "running", lastSequence: 1 }), permissions: [] };
    vi.mocked(acpCancel).mockImplementation(async () => {
      history.saved.push(event(2, "turn_complete", { stopReason: "cancelled" }));
      snapshots.saved = { session: session("saved", { status: "ready", lastSequence: 2 }), permissions: [] };
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(ui.getByRole("button", { name: "Stop" })).toBeEnabled());
    fireEvent.click(ui.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(ui.getByLabelText("Message CLI agent")).toBeEnabled());
    expect(ui.queryByRole("button", { name: "Reconnect to conversation" })).not.toBeInTheDocument();
    expect(acpReconnect).not.toHaveBeenCalled();
  });

  it("opens agent setup in settings instead of embedding it", async () => {
    const ui = render(<AcpWorkspace />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    expect(ui.queryByRole("button", { name: "Configure CLI agents" })).not.toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: "Agent setup" }));
    const settings = useSettingsStore.getState();
    expect(settings.settingsOpen).toBe(true);
    expect(settings.settingsInitialSection).toBe("ai");
    expect(settings.settingsScrollTarget).toBe("ai-agents");
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

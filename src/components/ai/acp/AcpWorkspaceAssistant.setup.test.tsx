import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderWithoutProviders, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), acpEvents: vi.fn(),
  acpStart: vi.fn(), acpAuthenticate: vi.fn(), acpDisconnect: vi.fn(), acpReconnect: vi.fn(),
  acpSignInCommand: vi.fn(), onAcpEvent: vi.fn(), onAcpResync: vi.fn(),
  onAcpSession: vi.fn(async () => () => {}), onAcpBufferRequest: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/skills", async (original) => ({
  ...await original<typeof import("@/lib/skills")>(),
  useSkills: () => ({ data: [], isPending: false, isFetching: false }),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));

import {
  acpAuthenticate, acpCatalog, acpEvents, acpSessions, acpSignInCommand, acpSnapshot, onAcpEvent, onAcpResync,
  type AcpAgentStatus, type AcpSnapshot,
} from "@/lib/acp";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import { AssistantShellAcpActions } from "@/components/ai/AssistantShellAcpActions";
import { registerTerminalPromptHost, useTerminalPromptStore } from "@/lib/terminal-lifecycle";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import { agent, session } from "./tests/ui-fixtures";
import { AcpWorkspaceAssistant } from "./AcpWorkspaceAssistant";

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithoutProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function pi(overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return agent("pi", {
    definition: { ...agent().definition, id: "pi", name: "Pi", builtin: true },
    installed: true, managed: true, cliRequired: true,
    cli: { command: "pi", displayName: "Pi", path: null, version: null, signInCommand: "pi" },
    signInHint: "Run pi in your terminal and sign in with /login, then reconnect.",
    ...overrides,
  });
}

let snapshots: Record<string, AcpSnapshot>;

function agreeToTerminalPrompts() {
  const asked: { description: string; commandLine: string }[] = [];
  const unregister = registerTerminalPromptHost();
  const stop = useTerminalPromptStore.subscribe((state) => {
    if (state.prompt?.kind !== "launch") return;
    asked.push({ description: state.prompt.description, commandLine: state.prompt.commandLine });
    state.answer(state.prompt.id, true);
  });
  return { asked, done: () => { stop(); unregister(); } };
}

function activeTerminal() {
  const terminals = useTerminalsStore.getState();
  return terminals.tabs.find((value) => value.id === terminals.activeId);
}

beforeEach(() => {
  vi.resetAllMocks();
  snapshots = {};
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: {}, composers: {}, errors: {} });
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null, terminalOpen: false });
  useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
  useFilesStore.setState({ projectId: null });
  vi.mocked(acpSessions).mockImplementation(async () => Object.values(snapshots).map((value) => value.session));
  vi.mocked(acpSnapshot).mockImplementation(async (_project, id) => {
    if (!snapshots[id]) throw new Error("Conversation missing");
    return snapshots[id];
  });
  vi.mocked(acpEvents).mockResolvedValue({ events: [], hasMore: false });
  vi.mocked(onAcpEvent).mockResolvedValue(vi.fn());
  vi.mocked(onAcpResync).mockResolvedValue(vi.fn());
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("CLI agent setup in the assistant", () => {
  it("prefers a usable agent and keeps Pi unstartable while its CLI is missing", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([pi(), agent()]);
    const ui = render(
      <>
        <AssistantShellAcpActions projectId="paper" />
        <AcpWorkspaceAssistant projectId="paper" />
      </>,
    );
    await waitFor(() => expect(useAcpSessionsStore.getState().composers.paper?.agentId).toBe("fixture"));
    await waitFor(() => expect(ui.getByTestId("acp-start-conversation")).toBeEnabled());

    fireEvent.click(ui.getByTestId("agent-picker-pi"));

    await waitFor(() => expect(ui.getByTestId("acp-start-conversation")).toBeDisabled());
    expect(ui.getByRole("button", { name: enAi.acp.newConversation })).toBeDisabled();
    const card = ui.getByTestId("acp-bridge-card-pi");
    expect(card).toHaveTextContent("Oleafly couldn't find Pi on this computer.");
    expect(card).not.toHaveTextContent("PATH");
    fireEvent.click(ui.getByRole("button", { name: "Set up Pi" }));
    expect(useSettingsStore.getState().settingsScrollTarget).toBe("ai-agents:pi");
  });

  it("signs in through a terminal method by running the CLI in the project terminal", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([pi({ cli: { command: "pi", displayName: "Pi", path: "/Users/ada/.npm-global/bin/pi", version: "0.81.2", signInCommand: "pi" } })]);
    const login = ["/Users/ada/.npm-global/lib/node_modules/pi-acp/dist/index.js", "--terminal-login"];
    vi.mocked(acpSignInCommand).mockResolvedValue({ title: "Sign in to Pi", program: "/usr/local/bin/node", args: login, env: {} });
    useFilesStore.setState({ projectId: "paper" });
    snapshots.saved = {
      session: session("saved", {
        agentId: "pi", status: "auth_required",
        authMethods: [{
          id: "pi_terminal_login", name: "Launch pi in the terminal", description: null, kind: "terminal",
          terminalCommand: { command: "/usr/local/bin/node", args: login, label: "Launch pi" },
        }],
      }),
      permissions: [],
    };
    useAcpSessionsStore.setState({ activeByProject: { paper: "saved" } });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const prompts = agreeToTerminalPrompts();

    fireEvent.click(await ui.findByRole("button", { name: "Launch pi in the terminal" }));

    await waitFor(() => expect(activeTerminal()?.launch).toEqual({ command: "/usr/local/bin/node", args: login }));
    prompts.done();
    expect(prompts.asked).toHaveLength(1);
    expect(prompts.asked[0].commandLine).toContain("/usr/local/bin/node");
    expect(prompts.asked[0].commandLine).toContain("--terminal-login");
    expect(prompts.asked[0].description).toContain("Pi");
    expect(acpSignInCommand).toHaveBeenCalledExactlyOnceWith("paper", "pi", "saved", "pi_terminal_login");
    expect(useTerminalsStore.getState().projectId).toBe("paper");
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    expect(acpAuthenticate).not.toHaveBeenCalled();
    expect(ui.getByRole("button", { name: enAi.acp.reconnectAfterSignIn })).toBeInTheDocument();
  });

  it("asks the agent to authenticate for an agent method", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([pi({ cli: { command: "pi", displayName: "Pi", path: "/usr/local/bin/pi", version: null, signInCommand: "pi" } })]);
    const authRequired = session("saved", {
      agentId: "pi", status: "auth_required",
      authMethods: [{ id: "browser", name: "Sign in", description: null, kind: null }],
    });
    snapshots.saved = { session: authRequired, permissions: [] };
    vi.mocked(acpAuthenticate).mockResolvedValue({ session: { ...authRequired, status: "ready", lastSequence: 1 }, permissions: [] });
    useAcpSessionsStore.setState({ activeByProject: { paper: "saved" } });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    fireEvent.click(await ui.findByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(acpAuthenticate).toHaveBeenCalledExactlyOnceWith("paper", "saved", "browser"));
    expect(useTerminalsStore.getState().tabs).toHaveLength(0);
  });

  it("runs a terminal method's own sign-in in the terminal when the CLI was not located", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([pi({ cli: { command: "pi", displayName: "Pi", path: null, version: null, signInCommand: "pi" } })]);
    vi.mocked(acpSignInCommand).mockResolvedValue({ title: "Sign in to Pi", program: "/tools/pi-acp", args: ["--terminal-login"], env: {} });
    useFilesStore.setState({ projectId: "paper" });
    snapshots.saved = {
      session: session("saved", {
        agentId: "pi", status: "auth_required",
        authMethods: [{ id: "browser", name: "Sign in", description: null, kind: "terminal" }],
      }),
      permissions: [],
    };
    useAcpSessionsStore.setState({ activeByProject: { paper: "saved" } });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const prompts = agreeToTerminalPrompts();

    fireEvent.click(await ui.findByRole("button", { name: "Sign in in the terminal" }));

    await waitFor(() => expect(activeTerminal()?.launch).toEqual({ command: "/tools/pi-acp", args: ["--terminal-login"] }));
    prompts.done();
    expect(acpSignInCommand).toHaveBeenCalledExactlyOnceWith("paper", "pi", "saved", "browser");
    expect(acpAuthenticate).not.toHaveBeenCalled();
  });
});

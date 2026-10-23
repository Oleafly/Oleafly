import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as renderWithoutProviders, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
const skillState = vi.hoisted(() => ({ data: [] as unknown[] }));
const intake = vi.hoisted(() => ({ intakeFiles: vi.fn() }));
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), acpEvents: vi.fn(),
  acpStart: vi.fn(), acpAuthenticate: vi.fn(), acpDisconnect: vi.fn(), acpReconnect: vi.fn(),
  acpSetModel: vi.fn(), acpPrompt: vi.fn(), acpPermission: vi.fn(), acpCancel: vi.fn(),
  acpSignInCommand: vi.fn(), acpElicitationRespond: vi.fn(),
  onAcpEvent: vi.fn(), onAcpResync: vi.fn(),
  onAcpSession: vi.fn(async () => () => {}), onAcpBufferRequest: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/attachments-intake", () => ({ intakeFiles: intake.intakeFiles }));
vi.mock("@/lib/tauri", async (original) => ({
  ...await original<typeof import("@/lib/tauri")>(),
  gitIsInitialized: vi.fn(),
}));
vi.mock("@/lib/external-file-changes", async (original) => ({
  ...await original<typeof import("@/lib/external-file-changes")>(),
  flushOpenFilesToDisk: vi.fn(),
}));
vi.mock("@/components/layout/CleanLibraryDialog", () => ({
  CleanLibraryDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="clean-library-dialog">
      <button type="button" onClick={onClose}>{"Close cleanup"}</button>
    </div>
  ),
}));
vi.mock("@/lib/skills", async (original) => ({
  ...await original<typeof import("@/lib/skills")>(),
  useSkills: () => ({ data: skillState.data, isPending: false, isFetching: false }),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
import type { ReactNode } from "react";
import {
  acpCatalog, acpDisconnect, acpEvents, acpPermission, acpPrompt, acpSessions, acpSignInCommand, acpSnapshot, acpStart,
  onAcpEvent, onAcpResync, type AcpEvent, type AcpPromptInput, type AcpSnapshot,
} from "@/lib/acp";
import type { DraftAttachment } from "@/components/ai/composer/types";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { flushOpenFilesToDisk } from "@/lib/external-file-changes";
import { gitIsInitialized } from "@/lib/tauri";
import { acpComposerId, useAcpSessionsStore } from "@/store/acp-sessions";
import { useComposerDrafts } from "@/store/composer-drafts";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore, type TerminalTab } from "@/store/terminals";
import { agent, deferred, event, session } from "./tests/ui-fixtures";
import { AcpWorkspaceAssistant } from "./AcpWorkspaceAssistant";

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithoutProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function skill(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

const imageSession = () => session("saved", { capabilities: { ...session().capabilities, image: true } });

let snapshots: Record<string, AcpSnapshot>;
let history: Record<string, AcpEvent[]>;

beforeEach(() => {
  vi.resetAllMocks();
  skillState.data = [];
  snapshots = { saved: { session: session(), permissions: [] } };
  history = { saved: [] };
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: { paper: "saved" }, composers: {}, queues: {}, errors: {}, starting: {} });
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null, terminalOpen: false });
  useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
  useComposerDrafts.setState({ drafts: {} });
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
  vi.mocked(onAcpEvent).mockResolvedValue(() => {});
  vi.mocked(onAcpResync).mockResolvedValue(() => {});
  vi.mocked(acpDisconnect).mockResolvedValue();
  vi.mocked(gitIsInitialized).mockResolvedValue(false);
  vi.mocked(flushOpenFilesToDisk).mockResolvedValue();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

async function readyComposer(ui: ReturnType<typeof render>) {
  const composer = ui.getByLabelText(enAi.acp.composerAriaLabel);
  await waitFor(() => expect(composer).toBeEnabled());
  return composer as HTMLTextAreaElement;
}

function typeMessage(input: HTMLElement, value: string) {
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
}

const composerId = acpComposerId("paper", "fixture", "saved");

function input(text: string, overrides: Partial<AcpPromptInput> = {}): AcpPromptInput {
  return { text, images: [], files: [], selections: [], skillId: null, ...overrides };
}

function stored(name: string, kind: DraftAttachment["kind"], sha256: string): DraftAttachment {
  const mime = kind === "image" ? "image/png" : kind === "pdf" ? "application/pdf" : "text/plain";
  return { id: name, name, mime, size: 1024, status: "ready", kind, scope: "paper", sha256 };
}

function fileInput(ui: ReturnType<typeof render>) {
  const found = ui.container.querySelector<HTMLInputElement>('[data-testid="ai-composer-file-input"]');
  if (!found) throw new Error("The file picker is missing.");
  return found;
}

describe("ACP composer attachments", () => {
  it("hands picked files to the attachment intake, with images only for agents that read them", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);
    expect(ui.getByRole("button", { name: enAi.acp.attachFile })).toBeEnabled();
    const file = new window.File(["%PDF"], "paper.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput(ui), { target: { files: [file] } });
    await waitFor(() => expect(intake.intakeFiles).toHaveBeenCalledOnce());
    expect(intake.intakeFiles.mock.calls[0][1]).toEqual({ composerId, scope: "paper", kinds: ["pdf", "text"] });
    cleanup();

    snapshots.saved = { session: imageSession(), permissions: [] };
    const withImages = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(withImages);
    fireEvent.change(fileInput(withImages), { target: { files: [file] } });
    await waitFor(() => expect(intake.intakeFiles).toHaveBeenCalledTimes(2));
    expect(intake.intakeFiles.mock.calls[1][1]).toEqual({ composerId, scope: "paper", kinds: ["image", "pdf", "text"] });
  });

  it("sends stored files with the message and clears them, and lets the user remove one", async () => {
    vi.mocked(acpPrompt).mockResolvedValue({ session: { ...session(), lastSequence: 1 }, permissions: [] });
    useComposerDrafts.getState().setAttachments(composerId, [stored("paper.pdf", "pdf", "ab12"), stored("notes.txt", "text", "cd34")]);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    fireEvent.click(await ui.findByRole("button", { name: "Remove notes.txt" }));
    expect(ui.queryByRole("button", { name: "Remove notes.txt" })).toBeNull();
    typeMessage(composer, "Summarise the PDF");
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", input("Summarise the PDF", {
      files: [{ kind: "stored", sha256: "ab12", name: "paper.pdf", mime: "application/pdf" }],
    })));
    await waitFor(() => expect(ui.queryByRole("button", { name: "Remove paper.pdf" })).toBeNull());
  });

  it("refuses images the agent cannot read and keeps them in the composer", async () => {
    useComposerDrafts.getState().setAttachments(composerId, [stored("figure.png", "image", "ef56")]);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    typeMessage(composer, "What does the figure show?");
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(await ui.findByRole("alert")).toHaveTextContent(enAi.acp.composer.imagesUnsupported);
    expect(acpPrompt).not.toHaveBeenCalled();
    expect(await ui.findByRole("button", { name: "Remove figure.png" })).toBeInTheDocument();
    expect(composer).toHaveValue("What does the figure show?");
  });
});

describe("ACP composer sending", () => {
  it("refuses a message larger than the agent accepts", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "a".repeat(256 * 1024 + 1));
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));

    expect(await ui.findByRole("alert")).toHaveTextContent(enAi.acp.messageTooLarge);
    expect(acpPrompt).not.toHaveBeenCalled();
  });

  it("sends on Enter, and leaves Shift+Enter, IME composition and blank drafts alone", async () => {
    vi.mocked(acpPrompt).mockResolvedValue({ session: { ...session(), lastSequence: 1 }, permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "   ");
    fireEvent.keyDown(composer, { key: "Enter" });
    typeMessage(composer, "Summarise the notes");
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
    fireEvent.keyDown(composer, { key: "a" });
    expect(acpPrompt).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", input("Summarise the notes")));
    await waitFor(() => expect(composer).toHaveValue(""));
  });

  it("queues a second message while the first is still on its way, then sends it after the turn", async () => {
    let emit: (value: AcpEvent) => void = () => {};
    vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return () => {}; });
    const saving = deferred<void>();
    vi.mocked(flushOpenFilesToDisk).mockReturnValueOnce(saving.promise);
    vi.mocked(acpPrompt).mockResolvedValue({ session: session("saved", { status: "running", lastSequence: 1 }), permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "First question");
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(composer).toHaveAttribute("placeholder", enAi.acp.composerPlaceholderRunning));
    typeMessage(composer, "Second question");
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(await ui.findByTestId("acp-queued")).toHaveTextContent("Second question");
    expect(composer).toHaveValue("");
    expect(acpPrompt).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", input("First question")));

    snapshots.saved = { session: session("saved", { status: "ready", lastSequence: 2 }), permissions: [] };
    act(() => emit(event(2, "turn_complete", { stopReason: "end_turn" })));
    await waitFor(() => expect(acpPrompt).toHaveBeenCalledTimes(2));
    expect(acpPrompt).toHaveBeenLastCalledWith("paper", "saved", input("Second question"));
    await waitFor(() => expect(ui.queryByTestId("acp-queued")).toBeNull());
  });

  it("shows the rejection and keeps the draft when the prompt never reached the agent", async () => {
    vi.mocked(acpPrompt).mockRejectedValue(new Error("The agent refused the prompt."));
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "Check the bibliography");
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));

    expect(await ui.findByRole("alert")).toHaveTextContent("The agent refused the prompt.");
    expect(composer).toHaveValue("Check the bibliography");
    expect(acpSnapshot).toHaveBeenCalledWith("paper", "saved");
  });

  it("clears the draft when the failed prompt still reached the agent", async () => {
    vi.mocked(acpPrompt).mockImplementation(async () => {
      history.saved = [event(1, "user_message", { text: "Check the bibliography" })];
      throw new Error("The connection dropped.");
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "Check the bibliography");
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));

    expect(await ui.findByRole("alert")).toHaveTextContent("The connection dropped.");
    expect(composer).toHaveValue("");
  });

  it("asks for sign-in instead of an error when the prompt failed on an expired login", async () => {
    vi.mocked(acpPrompt).mockImplementation(async () => {
      snapshots.saved = { session: session("saved", { status: "auth_required" }), permissions: [] };
      throw new Error("Authentication required.");
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "Check the bibliography");
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));

    expect(await ui.findByText("Run research-fixture login")).toBeInTheDocument();
    expect(ui.queryByRole("alert")).toBeNull();
  });

  it("reports a save failure that is not about the open files and holds the prompt", async () => {
    vi.mocked(flushOpenFilesToDisk).mockRejectedValue(new Error("The disk is full."));
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "Draft the abstract");
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));

    expect(await ui.findByRole("alert")).toHaveTextContent("The disk is full.");
    expect(acpPrompt).not.toHaveBeenCalled();
    expect(composer).toHaveValue("Draft the abstract");
  });

  it("shows a permission failure from the agent", async () => {
    snapshots.saved = {
      session: session("saved", { status: "running" }),
      permissions: [{ id: "request", sessionId: "saved", turnId: "turn", title: "Read notes?", toolCallId: "tool", options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }], expiresAt: Date.now() + 60_000 }],
    };
    vi.mocked(acpPermission).mockRejectedValue(new Error("The request expired."));
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    fireEvent.click(await ui.findByRole("button", { name: "Allow once" }));

    expect(await ui.findByRole("alert")).toHaveTextContent("The request expired.");
    expect(acpPermission).toHaveBeenCalledWith("paper", "saved", "request", "allow-once");
  });
});

describe("ACP assistant lifecycle", () => {
  it("shows a catalog failure", async () => {
    vi.mocked(acpCatalog).mockRejectedValue(new Error("The agent catalog is unavailable."));
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByRole("alert")).toHaveTextContent("The agent catalog is unavailable.");
  });

  it("stops listening when the panel closes before the listeners attach", async () => {
    const attached = deferred<() => void>();
    const stop = vi.fn();
    vi.mocked(onAcpEvent).mockReturnValue(attached.promise);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    ui.unmount();

    await act(async () => attached.resolve(stop));

    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(acpCatalog).not.toHaveBeenCalled();
  });

  it("refreshes the catalog when agents change elsewhere", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);
    vi.mocked(acpCatalog).mockResolvedValue([agent("fixture", { definition: { ...agent().definition, name: "Renamed CLI" } })]);

    act(() => { window.dispatchEvent(new window.Event("oleafly:acp-catalog-changed")); });

    expect(await ui.findByTestId("agent-picker-fixture")).toHaveTextContent("Renamed CLI");
  });

  it("puts the previous agent back when the chosen one fails to start", async () => {
    const second = agent("second", { definition: { ...agent().definition, id: "second", name: "Second CLI" } });
    vi.mocked(acpCatalog).mockResolvedValue([agent(), second]);
    vi.mocked(acpStart).mockRejectedValue(new Error("Second CLI crashed on start."));
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);
    await waitFor(() => expect(ui.getByTestId("agent-picker-second")).toBeEnabled());

    fireEvent.click(ui.getByTestId("agent-picker-second"));

    expect(await ui.findByRole("alert")).toHaveTextContent("Second CLI crashed on start.");
    expect(acpStart).toHaveBeenCalledWith("paper", "second");
    expect(useAcpSessionsStore.getState().composers.paper?.agentId).toBe("fixture");
  });

  it("lists only the agents in the catalog", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);

    expect(ui.getByTestId("agent-picker-fixture")).toBeInTheDocument();
    expect(ui.queryByTestId("agent-picker-claude")).toBeNull();
    expect(ui.queryByText(enAi.acp.roster.unavailable)).toBeNull();
  });

  it("opens the skills settings from a skill that is switched off", async () => {
    skillState.data = [skill({ enabled: false })];
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);

    fireEvent.click(await ui.findByTestId("assistant-home-card-fixture-skill"));

    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "ai",
      settingsScrollTarget: "ai-skills",
    });
    expect(ui.queryByTestId("acp-skill-chip")).toBeNull();
  });

  it("fills a preset without a skill and closes the library cleanup", async () => {
    vi.mocked(gitIsInitialized).mockResolvedValue(true);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    const figure = await waitFor(() => {
      const found = ui.getAllByTestId("acp-quick-start").find((node) => node.textContent === enAi.presets.figureAudit);
      if (!found) throw new Error("The figure audit preset is missing.");
      return found;
    });
    fireEvent.click(figure);
    expect(composer.value).toMatch(/^Check every figure and table/u);
    expect(ui.queryByTestId("acp-skill-chip")).toBeNull();

    fireEvent.click(ui.getAllByTestId("acp-quick-start").find((node) => node.textContent === enAi.presets.referenceCleanup) as HTMLElement);
    fireEvent.click(await ui.findByRole("button", { name: "Close cleanup" }));
    expect(ui.queryByTestId("clean-library-dialog")).toBeNull();
  });
});

describe("ACP assistant session states", () => {
  it("explains that a plain conversation cannot be resumed", async () => {
    snapshots.saved = {
      session: session("saved", { status: "disconnected", capabilities: { ...session().capabilities, loadSession: false, resume: false } }),
      permissions: [],
    };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByText(enAi.acp.noResume)).toBeInTheDocument();
    expect(ui.queryByRole("button", { name: enAi.acp.reconnect })).toBeNull();
  });

  it("shows the agent's own error for a failed conversation", async () => {
    snapshots.saved = { session: session("saved", { status: "failed", error: "The agent exited with code 1." }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByRole("alert")).toHaveTextContent("The agent exited with code 1.");
    expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · failed");
  });

  it.each([
    [null, enAi.acp.modelManaged],
    ["house-model", "house-model"],
  ])("names the model as %s when the agent offers no model list", async (modelId, label) => {
    snapshots.saved = { session: session("saved", { controls: { modelId, modelConfigId: null, models: [] } }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);

    expect(ui.getByText(label)).toBeInTheDocument();
    expect(ui.queryByRole("combobox", { name: enAi.acp.agentModel })).toBeNull();
  });

  it.each([
    ["connecting", "connecting"],
    ["cancelling", "cancelling"],
    ["cancelled", "cancelled"],
  ] as const)("labels a %s conversation in the status pill", async (status, label) => {
    snapshots.saved = { session: session("saved", { status }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent(`Research CLI · ${label}`));
    expect(ui.getByTestId("acp-session-status")).toHaveAttribute("data-status", status);
  });

  it("disables stop while the agent is already cancelling", async () => {
    snapshots.saved = { session: session("saved", { status: "cancelling" }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByRole("button", { name: enAi.acp.stop })).toBeDisabled();
  });

  it("names the conversation's agent when it is missing from the catalog", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([]);
    snapshots.saved = {
      session: session("saved", { agentId: "retired", status: "auth_required" }),
      permissions: [{ id: "request", sessionId: "saved", turnId: "turn", title: "Read notes?", toolCallId: "tool", options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }], expiresAt: Date.now() + 60_000 }],
    };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByText(enAi.acp.signInFallback)).toBeInTheDocument();
    expect(ui.getByTestId("acp-session-status")).toHaveTextContent("retired · auth required");
    expect(ui.getByText(enAi.acp.permission.namedHeadline.replace("{{agent}}", "retired"))).toBeInTheDocument();
  });

  it("shows a generic starting state before any agent is known", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([]);
    snapshots = {};
    useAcpSessionsStore.setState({ activeByProject: {}, starting: { paper: true } });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByTestId("acp-connecting")).toHaveTextContent(
      enAi.acp.starting.replace("{{agent}}", enAi.acp.startingFallback),
    );
  });

  it("says the terminal is full when a terminal sign-in cannot open a tab", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([
      agent("fixture", { cli: { command: "research-fixture", displayName: "Research CLI", path: "/tools/research-fixture", version: null, signInCommand: "research-fixture" } }),
    ]);
    snapshots.saved = {
      session: session("saved", { status: "auth_required", authMethods: [{ id: "terminal", name: "Sign in from the terminal", description: null, kind: "terminal" }] }),
      permissions: [],
    };
    const tabs: TerminalTab[] = Array.from({ length: 10 }, (_, index) => ({
      id: `tab-${index}`, index, title: `Terminal ${index}`, color: null, autoStart: false, bell: false, oscTitle: null,
    }));
    useTerminalsStore.setState({ projectId: "paper", tabs, activeId: "tab-0", counters: { paper: 10 } });
    vi.mocked(acpSignInCommand).mockResolvedValue({ title: "Sign in", program: "/tools/research-fixture", args: ["login"], env: {} });
    const infoUnique = vi.spyOn(toast, "infoUnique").mockImplementation(() => 0);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    fireEvent.click(await ui.findByRole("button", { name: "Sign in from the terminal in the terminal" }));

    await waitFor(() => expect(infoUnique).toHaveBeenCalledWith("terminal-limit", enWorkspace.terminal.limitReached));
    expect(acpSignInCommand).toHaveBeenCalledWith("paper", "fixture", "saved", "terminal");
    expect(useTerminalsStore.getState().tabs).toHaveLength(10);
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
    expect(ui.queryByText(enAi.acp.signIn.afterTerminal)).toBeNull();
    infoUnique.mockRestore();
  });

  it("keeps the reader's place when they scroll up while new activity arrives", async () => {
    let emit: (value: AcpEvent) => void = () => {};
    vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return () => {}; });
    history.saved = [event(1, "agent_message_chunk", { content: { type: "text", text: "First answer." } })];
    snapshots.saved = { session: session("saved", { lastSequence: 1 }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await ui.findByText("First answer.");
    const scroller = scrolledUp(ui);

    act(() => emit(event(2, "agent_message_chunk", { content: { type: "text", text: " More detail." } })));
    await ui.findByText(/More detail/u);

    expect(scroller.scrollTop).toBe(100);
  });

  it("brings a reader who scrolled up down to the message they send", async () => {
    let emit: (value: AcpEvent) => void = () => {};
    vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return () => {}; });
    history.saved = [event(1, "agent_message_chunk", { content: { type: "text", text: "First answer." } })];
    snapshots.saved = { session: session("saved", { lastSequence: 1 }), permissions: [] };
    vi.mocked(acpPrompt).mockImplementation(async () => {
      emit(event(2, "user_message", { text: "A follow-up" }));
      return { session: session("saved", { status: "running", lastSequence: 2 }), permissions: [] };
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await ui.findByText("First answer.");
    const scroller = scrolledUp(ui);

    typeMessage(ui.getByLabelText(enAi.acp.composerAriaLabel), "A follow-up");
    fireEvent.keyDown(ui.getByLabelText(enAi.acp.composerAriaLabel), { key: "Enter" });
    await ui.findByText("A follow-up");

    await waitFor(() => expect(scroller.scrollTop).toBe(2000));
  });
});

/** The transcript, scrolled well above its end. */
function scrolledUp(ui: ReturnType<typeof render>): HTMLElement {
  const scroller = ui.getByTestId("acp-transcript");
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
  scroller.scrollTop = 100;
  fireEvent.scroll(scroller);
  return scroller;
}

describe("ACP composer on the shared composer (0.4.8)", () => {
  it("lets the user type while the agent connects and sends when it is ready", async () => {
    let emit: (value: AcpEvent) => void = () => {};
    vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return () => {}; });
    snapshots.saved = { session: session("saved", { status: "connecting" }), permissions: [] };
    vi.mocked(acpPrompt).mockResolvedValue({ session: session("saved", { status: "running", lastSequence: 2 }), permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    await waitFor(() => expect(composer).toHaveAttribute("placeholder", enAi.acp.composerPlaceholderConnecting));

    typeMessage(composer, "Outline the paper");
    fireEvent.keyDown(composer, { key: "Enter" });
    // Nothing runs yet, so the message does not wait for a turn to finish.
    expect(await ui.findByTestId("acp-queued")).toHaveTextContent(enAi.acp.queue.queuedConnecting);
    expect(composer).toHaveValue("");
    expect(acpPrompt).not.toHaveBeenCalled();

    snapshots.saved = { session: session("saved", { status: "ready", lastSequence: 1 }), permissions: [] };
    act(() => emit(event(1, "status", { status: "ready" })));
    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", input("Outline the paper")));
    await waitFor(() => expect(ui.queryByTestId("acp-queued")).toBeNull());
  });

  it("queues a message during a turn and shows it as queued", async () => {
    snapshots.saved = { session: session("saved", { status: "running" }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "Also check the figures");
    fireEvent.keyDown(composer, { key: "Enter" });

    const queued = await ui.findByTestId("acp-queued");
    expect(queued).toHaveTextContent("Also check the figures");
    expect(queued).toHaveTextContent("Queued: sends when the agent finishes");
    expect(useAcpSessionsStore.getState().queues.saved?.map((item) => item.text)).toEqual(["Also check the figures"]);
    expect(acpPrompt).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.queue.remove }));
    await waitFor(() => expect(ui.queryByTestId("acp-queued")).toBeNull());
  });

  it("starts a conversation when Enter is pressed without one", async () => {
    snapshots = {};
    useAcpSessionsStore.setState({ activeByProject: {} });
    vi.mocked(acpStart).mockImplementation(async () => {
      snapshots.fresh = { session: session("fresh", { status: "ready" }), permissions: [] };
      return snapshots.fresh;
    });
    vi.mocked(acpPrompt).mockResolvedValue({ session: session("fresh", { status: "running", lastSequence: 1 }), permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    await waitFor(() => expect(composer).toHaveAttribute("placeholder", enAi.acp.composerPlaceholderStart.replace("{{agent}}", "Research CLI")));

    typeMessage(composer, "Hello");
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(acpStart).toHaveBeenCalledWith("paper", "fixture"));
    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "fresh", input("Hello")));
  });

  it("gives the first message back when the conversation cannot start", async () => {
    snapshots = {};
    useAcpSessionsStore.setState({ activeByProject: {} });
    vi.mocked(acpStart).mockRejectedValue(new Error("The agent could not start."));
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "Hello");
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(await ui.findByRole("alert")).toHaveTextContent("The agent could not start.");
    await waitFor(() => expect(composer).toHaveValue("Hello"));
    expect(acpPrompt).not.toHaveBeenCalled();
  });

  it("keeps typing possible while sign-in is needed but does not send", async () => {
    snapshots.saved = { session: session("saved", { status: "auth_required" }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);

    typeMessage(composer, "Draft the abstract");
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(composer).toHaveValue("Draft the abstract");
    expect(ui.getByRole("button", { name: enAi.acp.send })).toBeDisabled();
    expect(acpPrompt).not.toHaveBeenCalled();
  });

  it("sends the skill chip with the message and clears it", async () => {
    useAcpSessionsStore.getState().setComposer("paper", { agentId: "fixture", skill: { id: "oleafly-literature-sweep", name: "Literature sweep" } });
    vi.mocked(acpPrompt).mockResolvedValue({ session: { ...session(), lastSequence: 1 }, permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    expect(ui.getByTestId("acp-skill-chip")).toHaveTextContent("Literature sweep");

    typeMessage(composer, "Find related work on solvers");
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith(
      "paper", "saved", input("Find related work on solvers", { skillId: "oleafly-literature-sweep" }),
    ));
    await waitFor(() => expect(ui.queryByTestId("acp-skill-chip")).toBeNull());
  });

  it("keeps the draft of each agent separate", async () => {
    snapshots = {};
    useAcpSessionsStore.setState({ activeByProject: {} });
    const second = agent("second", { definition: { ...agent().definition, id: "second", name: "Second CLI" } });
    vi.mocked(acpCatalog).mockResolvedValue([agent(), second]);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    await waitFor(() => expect(ui.getByTestId("agent-picker-second")).toBeEnabled());

    typeMessage(composer, "Draft for the fixture agent");
    fireEvent.click(ui.getByTestId("agent-picker-second"));
    await waitFor(() => expect(ui.getByLabelText(enAi.acp.composerAriaLabel)).toHaveValue(""));
    typeMessage(ui.getByLabelText(enAi.acp.composerAriaLabel), "Draft for the second agent");
    fireEvent.click(ui.getByTestId("agent-picker-fixture"));

    await waitFor(() => expect(ui.getByLabelText(enAi.acp.composerAriaLabel)).toHaveValue("Draft for the fixture agent"));
    expect(useComposerDrafts.getState().drafts[acpComposerId("paper", "second")]?.text).toBe("Draft for the second agent");
    expect(acpStart).not.toHaveBeenCalled();
  });

  it("shows the remote banner for a Hermes session over SSH", async () => {
    snapshots.saved = { session: session("saved", { remote: { host: "lab.example.org", folder: "/srv/paper" } }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByTestId("acp-remote-banner")).toHaveTextContent(
      enAi.acp.remote.banner.replace("{{host}}", "lab.example.org"),
    );
  });

  it("renders an agent request card next to permission cards", async () => {
    snapshots.saved = {
      session: session("saved", { status: "running" }),
      permissions: [{ id: "request", sessionId: "saved", turnId: "turn", title: "Read notes?", toolCallId: "tool", options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }], expiresAt: Date.now() + 60_000 }],
      elicitations: [{ id: "ask", mode: "form", message: "Which venue?", url: null, fields: [], sessionId: "saved", toolCallId: null, expiresAt: Date.now() + 60_000 }],
    };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    expect(await ui.findByTestId("acp-elicitation")).toHaveTextContent("Which venue?");
    expect(ui.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
  });
});

describe("ACP drafts, failed sends and queued messages", () => {
  const queuedDraft = { attachments: [], mentions: [], selections: [], skill: null };

  it("sends only the files that are ready and drops the chip of one that could not be prepared", async () => {
    vi.mocked(acpPrompt).mockResolvedValue({ session: { ...session(), lastSequence: 1 }, permissions: [] });
    useComposerDrafts.getState().setAttachments(composerId, [
      stored("paper.pdf", "pdf", "ab12"),
      { ...stored("photo.heic", "image", ""), status: "error", error: "Cannot read it.", sha256: undefined },
    ]);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    typeMessage(composer, "Summarise the PDF");
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));

    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", input("Summarise the PDF", {
      files: [{ kind: "stored", sha256: "ab12", name: "paper.pdf", mime: "application/pdf" }],
    })));
    await waitFor(() => expect(ui.queryByRole("button", { name: "Remove photo.heic" })).toBeNull());
    expect(ui.queryByRole("alert")).toBeNull();
  });

  it("puts a message that failed to send before what was typed since", async () => {
    const failing = deferred<AcpSnapshot>();
    vi.mocked(acpPrompt).mockReturnValue(failing.promise);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    typeMessage(composer, "The first message");
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));
    await waitFor(() => expect(composer).toHaveValue(""));
    typeMessage(composer, "Already typing the next one");

    await act(async () => {
      failing.reject(new Error("The connection dropped."));
    });

    await waitFor(() => expect(composer).toHaveValue("The first message\n\nAlready typing the next one"));
  });

  it("lets a failed queued message be edited, with its text back in the box", async () => {
    useAcpSessionsStore.setState({
      queues: { saved: [{ ...queuedDraft, id: "q1", text: "Check the figures", failed: true }] },
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    expect(await ui.findByTestId("acp-queued")).toHaveTextContent(enAi.acp.queue.sendFailed);

    fireEvent.click(ui.getByRole("button", { name: enAi.acp.queue.edit }));

    expect(ui.queryByTestId("acp-queued")).toBeNull();
    expect(composer).toHaveValue("Check the figures");
    expect(useAcpSessionsStore.getState().queues.saved).toEqual([]);
  });

  it("sends a failed queued message again", async () => {
    vi.mocked(acpPrompt).mockResolvedValue({ session: { ...session(), status: "running", lastSequence: 1 }, permissions: [] });
    useAcpSessionsStore.setState({
      queues: { saved: [{ ...queuedDraft, id: "q1", text: "Check the figures", failed: true }, { ...queuedDraft, id: "q2", text: "Then the tables" }] },
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);

    fireEvent.click(await ui.findByRole("button", { name: enAi.acp.queue.retry }));

    await waitFor(() => expect(acpPrompt).toHaveBeenCalledWith("paper", "saved", input("Check the figures")));
    await waitFor(() => expect(useAcpSessionsStore.getState().queues.saved?.map((item) => item.id)).not.toContain("q1"));
  });

  it("keeps a separate draft for each conversation", async () => {
    snapshots.second = { session: session("second", { title: "Second conversation" }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    typeMessage(composer, "For the first conversation");

    await act(async () => {
      await useAcpSessionsStore.getState().open("paper", "second");
    });
    await waitFor(() => expect(ui.getByLabelText(enAi.acp.composerAriaLabel)).toHaveValue(""));
    typeMessage(ui.getByLabelText(enAi.acp.composerAriaLabel), "For the second one");

    await act(async () => {
      await useAcpSessionsStore.getState().open("paper", "saved");
    });
    await waitFor(() => expect(ui.getByLabelText(enAi.acp.composerAriaLabel)).toHaveValue("For the first conversation"));
    expect(useComposerDrafts.getState().drafts[acpComposerId("paper", "fixture", "second")]?.text).toBe("For the second one");
  });

  it("keeps what was typed before an agent was chosen", async () => {
    snapshots = {};
    useAcpSessionsStore.setState({ activeByProject: {} });
    useComposerDrafts.getState().setText(acpComposerId("paper", null), "Typed while the agents loaded");
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    await waitFor(() => expect(ui.getByLabelText(enAi.acp.composerAriaLabel)).toHaveValue("Typed while the agents loaded"));
    expect(useComposerDrafts.getState().drafts[acpComposerId("paper", null)]).toBeUndefined();
    expect(useComposerDrafts.getState().drafts[acpComposerId("paper", "fixture")]?.text).toBe("Typed while the agents loaded");
  });

  it("carries the draft into the conversation it starts", async () => {
    snapshots = {};
    useAcpSessionsStore.setState({ activeByProject: {} });
    vi.mocked(acpStart).mockResolvedValue({ session: session("fresh"), permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const composer = await readyComposer(ui);
    typeMessage(composer, "Plan the experiments");
    await waitFor(() => expect(ui.getByTestId("acp-start-conversation")).toBeEnabled());

    fireEvent.click(ui.getByTestId("acp-start-conversation"));

    await waitFor(() => expect(acpStart).toHaveBeenCalledExactlyOnceWith("paper", "fixture"));
    await waitFor(() => expect(ui.getByLabelText(enAi.acp.composerAriaLabel)).toHaveValue("Plan the experiments"));
    expect(useComposerDrafts.getState().drafts[acpComposerId("paper", "fixture", "fresh")]?.text).toBe("Plan the experiments");
  });

  it("does not switch back to the conversation that was active before the panel finished loading", async () => {
    snapshots.second = { session: session("second", { title: "Second conversation" }), permissions: [] };
    const loading = deferred<AcpSnapshot["session"][]>();
    const { acpSessions: sessionsMock } = await import("@/lib/acp");
    vi.mocked(sessionsMock).mockReturnValue(loading.promise);
    render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled());

    // The user opens another conversation from the history while the panel is still loading.
    act(() => useAcpSessionsStore.getState().setActive("paper", "second"));
    await act(async () => {
      loading.resolve([session("saved"), session("second", { title: "Second conversation" })]);
    });

    await waitFor(() => expect(acpSnapshot).toHaveBeenCalledWith("paper", "second"));
    expect(acpSnapshot).not.toHaveBeenCalledWith("paper", "saved");
    expect(useAcpSessionsStore.getState().activeByProject.paper).toBe("second");
  });

  it("shows the session status as a badge whose dot stops pulsing when motion is reduced", async () => {
    snapshots.saved = { session: session("saved", { status: "running" }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    const pill = await ui.findByTestId("acp-session-status");
    await waitFor(() => expect(pill).toHaveAttribute("data-status", "running"));
    const dot = pill.querySelector("span[aria-hidden]");
    expect(dot?.className).toContain("motion-safe:animate-pulse");
    expect(dot?.className).not.toMatch(/(^|\s)animate-pulse/);
  });
});

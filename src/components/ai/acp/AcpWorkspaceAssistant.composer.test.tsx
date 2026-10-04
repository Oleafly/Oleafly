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
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), acpEvents: vi.fn(),
  acpStart: vi.fn(), acpAuthenticate: vi.fn(), acpDisconnect: vi.fn(), acpReconnect: vi.fn(),
  acpSetModel: vi.fn(), acpPrompt: vi.fn(), acpPermission: vi.fn(), acpCancel: vi.fn(),
  onAcpEvent: vi.fn(), onAcpResync: vi.fn(),
}));
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
  acpCatalog, acpDisconnect, acpEvents, acpPermission, acpPrompt, acpSessions, acpSnapshot, acpStart,
  onAcpEvent, onAcpResync, type AcpEvent, type AcpSnapshot,
} from "@/lib/acp";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { flushOpenFilesToDisk } from "@/lib/external-file-changes";
import { gitIsInitialized } from "@/lib/tauri";
import { useAcpSessionsStore } from "@/store/acp-sessions";
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
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: { paper: "saved" }, composers: {}, errors: {}, starting: {} });
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null, terminalOpen: false });
  useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
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

function fileInput(ui: ReturnType<typeof render>) {
  const input = ui.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The image picker is missing.");
  return input;
}

function pickImage(ui: ReturnType<typeof render>, file: File | undefined) {
  fireEvent.change(fileInput(ui), { target: { files: file ? [file] : [] } });
}

function imageFile(name: string, bytes = 8) {
  return new window.File([new Uint8Array(bytes).fill(65)], name, { type: "image/png" });
}

function withFileReader(behaviour: (reader: { result: unknown; onload: null | (() => void); onerror: null | (() => void) }) => void) {
  const previous = globalThis.FileReader;
  class StubReader {
    result: unknown = null;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    readAsDataURL() {
      behaviour(this);
    }
  }
  Object.defineProperty(globalThis, "FileReader", { configurable: true, writable: true, value: StubReader });
  return () => Object.defineProperty(globalThis, "FileReader", { configurable: true, writable: true, value: previous });
}

describe("ACP composer attachments", () => {
  it("attaches an image, lets the user remove it, and sends the rest with the message", async () => {
    snapshots.saved = { session: imageSession(), permissions: [] };
    vi.mocked(acpPrompt).mockResolvedValue({ session: { ...imageSession(), lastSequence: 1 }, permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);
    expect(ui.getByRole("button", { name: enAi.acp.attachImage })).toBeEnabled();

    pickImage(ui, imageFile("figure.png"));
    pickImage(ui, imageFile("chart.png"));
    await ui.findByRole("button", { name: "Remove chart.png" });
    fireEvent.click(ui.getByRole("button", { name: "Remove figure.png" }));
    expect(ui.queryByRole("button", { name: "Remove figure.png" })).toBeNull();

    fireEvent.click(ui.getByRole("button", { name: enAi.acp.send }));

    await waitFor(() => expect(acpPrompt).toHaveBeenCalledOnce());
    expect(vi.mocked(acpPrompt).mock.calls[0]).toEqual([
      "paper", "saved", "", [{ mimeType: "image/png", data: "QUFBQUFBQUE=" }], null,
    ]);
    await waitFor(() => expect(ui.queryByRole("button", { name: "Remove chart.png" })).toBeNull());
  });

  it("refuses an image over the size limit and a fifth image", async () => {
    snapshots.saved = { session: imageSession(), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);

    pickImage(ui, imageFile("huge.png", 480 * 1024 + 1));
    expect(await ui.findByRole("alert")).toHaveTextContent(enAi.acp.imageTooLarge);
    expect(ui.queryByRole("button", { name: "Remove huge.png" })).toBeNull();

    for (const name of ["a.png", "b.png", "c.png", "d.png"]) {
      pickImage(ui, imageFile(name));
      await ui.findByRole("button", { name: `Remove ${name}` });
    }
    pickImage(ui, imageFile("e.png"));
    expect(ui.getByRole("alert")).toHaveTextContent(enAi.acp.imageTooLarge);
    expect(ui.queryByRole("button", { name: "Remove e.png" })).toBeNull();
  });

  it("ignores an empty pick and an image that reads as empty", async () => {
    snapshots.saved = { session: imageSession(), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);
    const restoreReader = withFileReader((reader) => {
      reader.result = "data:image/png;base64,";
      reader.onload?.();
    });
    try {
      pickImage(ui, undefined);
      pickImage(ui, imageFile("blank.png"));
    } finally {
      restoreReader();
    }

    expect(ui.queryByRole("button", { name: "Remove blank.png" })).toBeNull();
    expect(ui.queryByRole("alert")).toBeNull();
  });

  it("says when the image cannot be read", async () => {
    snapshots.saved = { session: imageSession(), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);
    const restoreReader = withFileReader((reader) => act(() => reader.onerror?.()));
    try {
      pickImage(ui, imageFile("broken.png"));
    } finally {
      restoreReader();
    }

    expect(await ui.findByRole("alert")).toHaveTextContent(enAi.acp.imageReadFailed);
  });

  it("hides the image button when the agent cannot take images", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);

    expect(ui.queryByRole("button", { name: enAi.acp.attachImage })).toBeNull();
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

    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", "Summarise the notes", [], null));
    await waitFor(() => expect(composer).toHaveValue(""));
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
    expect(useAcpSessionsStore.getState().composers.paper?.draft).toBe("");
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

  it("sends an agent that is coming soon to the agent settings", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await readyComposer(ui);

    fireEvent.click(ui.getByTestId("agent-picker-claude"));

    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "ai" });
    expect(acpStart).not.toHaveBeenCalled();
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
    const tabs: TerminalTab[] = Array.from({ length: 10 }, (_, index) => ({ id: `tab-${index}`, index, title: `Terminal ${index}`, color: null, autoStart: false }));
    useTerminalsStore.setState({ projectId: "paper", tabs, activeId: "tab-0", counters: { paper: 10 } });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);

    fireEvent.click(await ui.findByRole("button", { name: "Sign in from the terminal" }));

    expect(await ui.findByRole("alert")).toHaveTextContent(enWorkspace.terminal.limitReached);
    expect(useTerminalsStore.getState().tabs).toHaveLength(10);
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });

  it("keeps the reader's place when they scroll up while new activity arrives", async () => {
    let emit: (value: AcpEvent) => void = () => {};
    vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return () => {}; });
    history.saved = [event(1, "agent_message_chunk", { content: { type: "text", text: "First answer." } })];
    snapshots.saved = { session: session("saved", { lastSequence: 1 }), permissions: [] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await ui.findByText("First answer.");
    const scroller = ui.getByRole("region", { name: enAi.acp.assistantAriaLabel }).firstElementChild as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    scroller.scrollTop = 100;

    fireEvent.scroll(scroller);
    act(() => emit(event(2, "agent_message_chunk", { content: { type: "text", text: " More detail." } })));
    await ui.findByText(/More detail/u);

    expect(scroller.scrollTop).toBe(100);
  });
});

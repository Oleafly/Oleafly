import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { installUiDom } = await import("@/components/ai/acp/tests/ui-fixtures");
  return installUiDom();
});
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpRegister: vi.fn(), acpInstall: vi.fn(), acpRegistrySearch: vi.fn(), acpRemoveAgent: vi.fn(), acpStart: vi.fn(),
  acpCheckAgent: vi.fn(), acpPickAgentProgram: vi.fn(), acpSetAgentProgram: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import {
  acpCatalog, acpCheckAgent, acpInstall, acpPickAgentProgram, acpRegister, acpRegistrySearch, acpRemoveAgent,
  acpSetAgentProgram, acpStart, type AcpAgentStatus, type AcpCliStatus,
} from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import { agent, deferred, session } from "@/components/ai/acp/tests/ui-fixtures";
import { initializeI18n } from "@/i18n";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import { AcpAgentsTab } from "./AcpAgentsTab";

await initializeI18n({
  preference: "en",
  systemLocale: async () => "en",
  missingKeyMode: "throw",
});

const copy = enSettings.ai.agents;
const withValues = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{{${key}}}`, value),
    template,
  );

let catalog: AcpAgentStatus[];
beforeEach(() => {
  vi.resetAllMocks();
  catalog = [];
  useAcpSessionsStore.setState({ catalog: [], sessions: { saved: session() }, activeByProject: {}, events: {}, permissions: {}, composers: {} });
  useSettingsStore.setState({ terminalOpen: false });
  useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
  vi.mocked(acpCatalog).mockImplementation(async () => catalog);
  vi.mocked(acpRegister).mockImplementation(async (text) => {
    const definition = JSON.parse(text) as AcpAgentStatus["definition"];
    catalog = [...catalog, agent(definition.id, { definition, installed: false })];
    return definition;
  });
});
afterEach(async () => {
  cleanup();
  resetDisplayHomes();
  await new Promise((resolve) => setImmediate(resolve));
});
afterAll(restore);

type Ui = ReturnType<typeof render>;

function openSection(ui: Ui, id: string) {
  fireEvent.click(ui.getByTestId(`acp-section-${id}`));
}

async function expandAgent(ui: Ui, id = "fixture") {
  const card = await ui.findByTestId(`acp-agent-card-${id}`);
  fireEvent.click(within(card).getByRole("button", { expanded: false }));
  return card;
}

function fill(input: HTMLElement, value: string) {
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
}

describe("ACP agent setup acceptance", () => {
  it("shows an immediate, reserved checking state before the first agent list arrives", async () => {
    const check = deferred<AcpAgentStatus[]>();
    vi.mocked(acpCatalog).mockReturnValueOnce(check.promise);

    const ui = render(<AcpAgentsTab />);
    const list = ui.getByTestId("acp-agent-list");
    expect(list).toHaveAttribute("aria-busy", "true");
    const checkButton = ui.getByRole("button", { name: copy.checkingAction });
    expect(checkButton).toBeDisabled();
    expect(checkButton.querySelector(".animate-spin")).not.toBeNull();
    expect(ui.queryByTestId("acp-agent-check-status")).not.toBeInTheDocument();
    expect(ui.getByTestId("acp-agent-empty-state")).toHaveAttribute(
      "role",
      "status",
    );
    expect(ui.getByText(copy.checkingTitle)).toBeInTheDocument();
    expect(ui.getByText(copy.checkingDescription)).toBeInTheDocument();

    await act(async () => check.resolve([agent()]));

    expect(await ui.findByTestId("acp-agent-card-fixture")).toBeInTheDocument();
    expect(list).toHaveAttribute("aria-busy", "false");
    expect(ui.queryByTestId("acp-agent-check-status")).not.toBeInTheDocument();
  });

  it("keeps the current cards visible while checking again and reports the completed check", async () => {
    catalog = [agent()];
    const ui = render(<AcpAgentsTab />);
    await ui.findByTestId("acp-agent-card-fixture");
    const checkButton = await ui.findByRole("button", {
      name: copy.checkInstalled,
    });
    const check = deferred<AcpAgentStatus[]>();
    vi.mocked(acpCatalog).mockReturnValueOnce(check.promise);

    fireEvent.click(checkButton);

    expect(ui.getByTestId("acp-agent-list")).toHaveAttribute("aria-busy", "true");
    expect(ui.getByRole("button", { name: copy.checkingAction })).toBeDisabled();
    expect(ui.getByTestId("acp-agent-check-status")).toHaveTextContent(
      copy.refreshingStatus,
    );
    expect(ui.getByTestId("acp-agent-card-fixture")).toBeInTheDocument();

    await act(async () => check.resolve([agent()]));

    expect(ui.getByTestId("acp-agent-list")).toHaveAttribute("aria-busy", "false");
    expect(ui.queryByTestId("acp-agent-check-status")).not.toBeInTheDocument();
  });

  it("explains a failed first check and lets the user retry from the reserved result area", async () => {
    vi.mocked(acpCatalog)
      .mockRejectedValueOnce(new Error("The agent service did not respond."))
      .mockResolvedValueOnce([]);

    const ui = render(<AcpAgentsTab />);

    expect(await ui.findByRole("alert")).toHaveTextContent("The agent service did not respond.");
    expect(ui.getByText(copy.checkFailedTitle)).toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: copy.checkAgain }));
    expect(await ui.findByText(copy.emptyTitle)).toBeInTheDocument();
    expect(ui.getByText(copy.emptyDescription)).toBeInTheDocument();
  });

  it("keeps later action errors separate from an earlier catalog failure", async () => {
    vi.mocked(acpCatalog).mockRejectedValueOnce(
      new Error("The agent service did not respond."),
    );
    vi.mocked(acpRegister).mockRejectedValueOnce(
      new Error("The agent definition was rejected."),
    );
    const ui = render(<AcpAgentsTab />);
    expect(await ui.findByRole("alert")).toHaveTextContent(
      "The agent service did not respond.",
    );

    openSection(ui, "custom");
    fill(
      ui.getByLabelText(copy.custom.label),
      JSON.stringify(agent().definition),
    );
    fireEvent.click(ui.getByRole("button", { name: copy.custom.submit }));

    expect(await ui.findByRole("alert")).toHaveTextContent(
      "The agent definition was rejected.",
    );
    expect(ui.queryByText("The agent service did not respond.")).not.toBeInTheDocument();
  });

  it("stays busy until a superseding catalog refresh is replaced by an accepted check", async () => {
    const initial = deferred<AcpAgentStatus[]>();
    const outside = deferred<AcpAgentStatus[]>();
    const retry = deferred<AcpAgentStatus[]>();
    vi.mocked(acpCatalog)
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(outside.promise)
      .mockReturnValueOnce(retry.promise);

    const ui = render(<AcpAgentsTab />);
    await waitFor(() => expect(acpCatalog).toHaveBeenCalledTimes(1));
    const outsideRefresh = useAcpSessionsStore.getState().refreshCatalog();

    await act(async () => initial.resolve([]));
    await waitFor(() => expect(acpCatalog).toHaveBeenCalledTimes(3));
    expect(ui.getByTestId("acp-agent-list")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(ui.queryByTestId("acp-agent-check-status")).not.toBeInTheDocument();

    await act(async () => outside.resolve([agent("outside")]));
    await expect(outsideRefresh).resolves.toBe(false);
    expect(ui.getByTestId("acp-agent-list")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await act(async () => retry.resolve([agent()]));
    expect(await ui.findByTestId("acp-agent-card-fixture")).toBeInTheDocument();
    expect(ui.getByTestId("acp-agent-list")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("registers exactly the reviewed custom definition without installing or launching it", async () => {
    const ui = render(<AcpAgentsTab projectId="paper" />);
    openSection(ui, "custom");
    expect(ui.getByRole("button", { name: copy.custom.submit })).toBeDisabled();
    fireEvent.click(ui.getByRole("button", { name: copy.custom.useExample }));
    expect((ui.getByLabelText(copy.custom.label) as HTMLTextAreaElement).value).toContain('"my-agent"');
    const definition = agent().definition;
    const json = JSON.stringify(definition);
    fill(ui.getByLabelText(copy.custom.label), json);
    fireEvent.click(ui.getByRole("button", { name: copy.custom.submit }));
    expect(await ui.findByTestId("acp-agent-notice")).toHaveTextContent(
      withValues(copy.notice.registered, { name: "Research CLI" }),
    );
    expect(acpRegister).toHaveBeenCalledExactlyOnceWith(json);
    expect(ui.getByRole("heading", { name: "Research CLI" })).toBeInTheDocument();
    expect(acpInstall).not.toHaveBeenCalled();
    expect(acpStart).not.toHaveBeenCalled();
  });

  it("keeps a rejected definition editable and clears its error after a successful retry", async () => {
    vi.mocked(acpRegister).mockRejectedValueOnce(new Error("The package version must be pinned."));
    const ui = render(<AcpAgentsTab />);
    openSection(ui, "custom");
    const input = ui.getByLabelText(copy.custom.label);
    const json = JSON.stringify(agent().definition);
    fill(input, json);
    fireEvent.click(ui.getByRole("button", { name: copy.custom.submit }));
    expect(await ui.findByRole("alert")).toHaveTextContent("The package version must be pinned.");
    expect(input).toHaveValue(json);
    fireEvent.click(ui.getByRole("button", { name: copy.custom.submit }));
    await ui.findByTestId("acp-agent-notice");
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires installation review, prevents duplicate installs, and retains a failed review for retry", async () => {
    catalog = [agent()];
    const install = deferred<AcpAgentStatus>();
    vi.mocked(acpInstall).mockReturnValueOnce(install.promise).mockResolvedValue(agent("fixture", { managed: true }));
    const ui = render(<AcpAgentsTab />);
    await expandAgent(ui);
    fireEvent.click(ui.getByTestId("acp-agent-install-fixture"));
    const dialog = await ui.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      withValues(copy.install.title, { name: "Research CLI", version: "1.2.3" }),
    );
    expect(dialog).toHaveTextContent("research-fixture@1.2.3");
    expect(acpInstall).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(ui.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(ui.getByTestId("acp-agent-install-fixture"));
    fireEvent.click(
      within(await ui.findByRole("dialog")).getByRole("button", { name: copy.install.confirm }),
    );
    expect(ui.getByRole("button", { name: copy.install.installing })).toBeDisabled();
    await act(async () => install.reject(new Error("Download interrupted")));
    expect(ui.getByRole("alert")).toHaveTextContent("Download interrupted");
    expect(ui.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(
      within(ui.getByRole("dialog")).getByRole("button", { name: copy.install.confirm }),
    );
    expect(await ui.findByTestId("acp-agent-notice")).toHaveTextContent(
      withValues(copy.notice.installed, { name: "Research CLI" }),
    );
    expect(acpInstall).toHaveBeenCalledTimes(2);
    expect(acpInstall).toHaveBeenLastCalledWith("fixture");
    expect(acpRegister).not.toHaveBeenCalled();
    expect(acpCatalog).toHaveBeenLastCalledWith(true);
  });

  it("shows unsupported registry entries without allowing registration and registers supported entries", async () => {
    const definition = agent().definition;
    vi.mocked(acpRegistrySearch).mockResolvedValue([
      { id: "unsupported", name: "Unsupported agent", description: "Unavailable distribution", version: "1", definition: null, reason: "Unverified binary" },
      { id: definition.id, name: definition.name, description: definition.description, version: definition.version, definition, reason: null },
    ]);
    const ui = render(<AcpAgentsTab />);
    openSection(ui, "registry");
    fill(ui.getByLabelText(copy.registry.searchLabel), "research");
    fireEvent.click(ui.getByRole("button", { name: copy.registry.search }));
    await ui.findByText("Unverified binary");
    const buttons = ui.getAllByRole("button", { name: copy.registry.register });
    expect(buttons[0]).toBeDisabled();
    expect(ui.queryByText(/"research-fixture@1.2.3"/)).not.toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: copy.registry.showDistribution }));
    expect(
      ui.getByRole("button", { name: copy.registry.hideDistribution }),
    ).toBeInTheDocument();
    fireEvent.click(buttons[1]);
    expect(await ui.findByRole("button", { name: copy.registry.registered })).toBeDisabled();
    expect(acpRegistrySearch).toHaveBeenCalledExactlyOnceWith("research");
    expect(acpRegister).toHaveBeenCalledExactlyOnceWith(JSON.stringify(definition));
    expect(acpInstall).not.toHaveBeenCalled();
  });

  it("surfaces removal errors and removes only the definition after retry", async () => {
    catalog = [agent(), agent("builtin", { definition: { ...agent().definition, id: "builtin", name: "Built-in CLI", builtin: true } })];
    vi.mocked(acpRemoveAgent).mockRejectedValueOnce("Disconnect its sessions first.").mockImplementation(async (id) => { catalog = catalog.filter((entry) => entry.definition.id !== id); });
    const ui = render(<AcpAgentsTab />);
    const card = await expandAgent(ui);
    const remove = within(card).getByRole("button", { name: enCommon.actions.remove });
    fireEvent.click(remove);
    expect(await ui.findByRole("alert")).toHaveTextContent("Disconnect its sessions first.");
    fireEvent.click(remove);
    expect(await ui.findByTestId("acp-agent-notice")).toHaveTextContent(
      copy.notice.removed,
    );
    expect(acpRemoveAgent).toHaveBeenLastCalledWith("fixture");
    expect(ui.queryByRole("heading", { name: "Research CLI" })).not.toBeInTheDocument();
    expect(useAcpSessionsStore.getState().sessions.saved).toEqual(session());
  });

  it("opens the current project's sign-in terminal without starting an agent", async () => {
    useTerminalsStore.getState().setProject("paper");
    const initial = useTerminalsStore.getState().tabs;
    const ui = render(<AcpAgentsTab projectId="paper" />);
    fireEvent.click(ui.getByRole("button", { name: copy.openSignInTerminal }));
    await waitFor(() => expect(useTerminalsStore.getState().projectId).toBe("paper"));
    expect(useTerminalsStore.getState().tabs).toHaveLength(initial.length + 1);
    expect(useTerminalsStore.getState().activeId).not.toBe(initial[0].id);
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    expect(acpStart).not.toHaveBeenCalled();
    ui.rerender(<AcpAgentsTab />);
    expect(
      within(ui.container).queryByRole("button", { name: copy.openSignInTerminal }),
    ).not.toBeInTheDocument();
  });

  it("shows vendor CLI details while keeping bridge metadata collapsed until requested", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    catalog = [
      agent("claude", {
        definition: { ...agent().definition, id: "claude", name: "Claude Code", version: "0.74.0", builtin: true },
        installed: false,
        executable: null,
        canInstall: true,
        signInHint: "Sign in before starting a conversation.",
        cli: { command: "claude", displayName: "Claude Code", path: "/Users/researcher/.local/bin/claude", version: "2.1.258", signInCommand: "claude auth login" },
      }),
    ];
    setDisplayHomes(["/Users/researcher"]);
    const ui = render(<AcpAgentsTab projectId="paper" />);
    const card = await ui.findByTestId("acp-agent-card-claude");
    expect(card).toHaveTextContent("Bridge needed");
    expect(card).toHaveTextContent("Claude Code 2.1.258 found at ~/.local/bin/claude");
    expect(card).not.toHaveTextContent("Not installed");
    fireEvent.click(within(card).getByRole("button", { expanded: false }));
    const cliDetails = within(card).getByRole("region", {
      name: copy.cliTitle,
    });
    expect(cliDetails).toHaveTextContent(copy.cliPathLabel);
    expect(cliDetails).toHaveTextContent("~/.local/bin/claude");
    expect(card).not.toHaveTextContent("/Users/researcher");
    expect(cliDetails).toHaveTextContent(copy.versionLabel);
    expect(cliDetails).toHaveTextContent("2.1.258");
    expect(cliDetails).toHaveTextContent(copy.signInCommandLabel);
    const command = within(card).getByTestId("acp-agent-sign-in-command-claude");
    expect(command).toHaveClass("min-h-12", "px-3", "py-2.5");
    expect(command).toHaveTextContent("claude auth login");
    const copyButton = within(command).getByRole("button", {
      name: copy.copySignInCommand,
    });
    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("claude auth login");
    const copiedButton = await within(command).findByRole("button", {
      name: enCommon.actions.copied,
    });
    expect(copiedButton).toHaveAttribute("data-copied", "true");
    expect(copiedButton).toHaveClass("text-emerald-600");
    expect(copiedButton.querySelector("svg")).toHaveClass("size-3.5");
    const bridgeDetails = within(card).getByRole("region", {
      name: copy.bridgeTitle,
    });
    const bridgeToggle = within(bridgeDetails).getByTestId(
      "acp-agent-bridge-details-claude-toggle",
    );
    const bridgeContent = bridgeDetails.querySelector<HTMLElement>(
      "#acp-agent-bridge-details-claude-content",
    );
    expect(bridgeContent).not.toBeNull();
    expect(bridgeToggle).toHaveAttribute("aria-expanded", "false");
    expect(bridgeToggle).toHaveAttribute(
      "aria-controls",
      "acp-agent-bridge-details-claude-content",
    );
    expect(bridgeContent).toHaveAttribute("hidden");
    expect(bridgeDetails).not.toHaveTextContent(copy.bridgePathLabel);
    expect(command).toBeVisible();
    expect(within(card).getByRole("region", { name: copy.nextStepTitle })).toHaveTextContent(
      copy.installBridgeNextStep,
    );

    fireEvent.click(bridgeToggle);

    expect(bridgeToggle).toHaveAttribute("aria-expanded", "true");
    expect(bridgeContent).not.toHaveAttribute("hidden");
    expect(bridgeDetails).toHaveTextContent(copy.bridgePathLabel);
    expect(bridgeDetails).toHaveTextContent(copy.bridgeSourceLabel);
    expect(bridgeDetails).toHaveTextContent(copy.platformLabel);
    expect(
      Array.from(bridgeDetails.querySelectorAll("dt")).map((term) => term.textContent),
    ).toEqual([
      copy.bridgePathLabel,
      copy.versionLabel,
      copy.platformLabel,
      copy.bridgeSourceLabel,
    ]);
    expect(bridgeDetails.querySelector("dl")).toHaveClass("grid-cols-3");
    expect(within(card).getByTestId("acp-agent-install-claude")).toHaveTextContent(
      copy.installBridge,
    );
    expect(acpCatalog).toHaveBeenCalledWith(true);
  });

  it("marks an agent unavailable when neither its CLI nor an install route exists", async () => {
    catalog = [
      agent("codex", {
        definition: { ...agent().definition, id: "codex", name: "Codex", builtin: true },
        installed: false,
        executable: null,
        canInstall: false,
        reason: "Install Node.js 22 or newer to run this agent.",
        cli: { command: "codex", displayName: "Codex", path: null, version: null, signInCommand: "codex login" },
      }),
    ];
    const ui = render(<AcpAgentsTab />);
    const card = await ui.findByTestId("acp-agent-card-codex");
    expect(card).toHaveTextContent("CLI not found");
    expect(card).toHaveTextContent("Oleafly couldn't find Codex on this computer.");
    expect(card).not.toHaveTextContent("PATH");
    fireEvent.click(within(card).getByRole("button", { expanded: false }));
    const install = within(card).getByTestId("acp-agent-install-codex");
    expect(install).toBeDisabled();
    const reasonId = install.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(card.querySelector(`[id="${reasonId}"]`)).toHaveTextContent(
      "Install Node.js 22 or newer to run this agent.",
    );
  });

  it("does not offer bridge installation when the vendor CLI is the bridge", async () => {
    catalog = [
      agent("shared-cli", {
        definition: {
          ...agent().definition,
          id: "shared-cli",
          name: "Shared CLI",
          builtin: true,
          distribution: {
            command: { executable: "shared-cli" },
          },
        },
        installed: true,
        executable: "/usr/local/bin/shared-cli",
        installedVersion: "3.2.1",
        managed: false,
        canInstall: false,
        signInHint: "Sign in through Shared CLI before starting a conversation.",
        cli: {
          command: "shared-cli",
          displayName: "Shared CLI",
          path: "/usr/local/bin/shared-cli",
          version: "3.2.1",
          signInCommand: "shared-cli login",
        },
        bridgeSharedWithCli: true,
      }),
    ];

    const ui = render(<AcpAgentsTab projectId="paper" />);
    const card = await expandAgent(ui, "shared-cli");

    expect(
      within(card).queryByTestId("acp-agent-install-shared-cli"),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByRole("region", { name: copy.nextStepTitle }),
    ).toHaveTextContent(
      "Sign in through Shared CLI before starting a conversation.",
    );
    expect(
      within(card).getByRole("button", { name: copy.openTerminal }),
    ).toBeInTheDocument();
  });
});

const piCli: AcpCliStatus = {
  command: "pi", displayName: "Pi", path: null, version: null, signInCommand: "pi", source: null, rejected: [],
};
const PICKED = "D:\\Tools\\Agents\\Pi\\pi.exe";
const TASKS_ON_WINDOWS = "Isolated CLI agent tasks are not available on Windows yet. Use the agent in the assistant instead.";

function pi(overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return agent("pi", {
    definition: { ...agent().definition, id: "pi", name: "Pi", version: "0.0.34", builtin: true },
    platform: "windows-x86_64", installed: true, managed: true, cliRequired: true, cli: piCli,
    signInHint: "Run pi in your terminal and sign in with /login, then reconnect.",
    taskUnavailableReason: TASKS_ON_WINDOWS,
    ...overrides,
  });
}

const program = copy.program;
const setupCopy = enAi.acp.setup;

describe("CLI agent program setup", () => {
  it("puts the setup step first and keeps the background task limit on its own line", async () => {
    catalog = [pi({ cli: { ...piCli, rejected: [{ path: "C:\\Users\\Ada\\AppData\\Roaming\\npm\\pi.ps1", reason: "unsupported_script" }] } })];
    const ui = render(<AcpAgentsTab projectId="paper" />);
    const card = await ui.findByTestId("acp-agent-card-pi");
    expect(card).toHaveTextContent("Found pi.ps1, but PowerShell scripts can't be started. Choose pi.cmd or pi.exe.");
    fireEvent.click(within(card).getByRole("button", { expanded: false }));
    const nextStep = within(card).getByRole("region", { name: copy.nextStepTitle });
    const lines = Array.from(nextStep.querySelectorAll("p")).map((node) => node.textContent);
    expect(lines[0]).toBe(setupCopy.cliMissingNextStep.replace("{{cli}}", "Pi"));
    expect(lines).toContain(setupCopy.backgroundTasks.replace("{{reason}}", TASKS_ON_WINDOWS));
    expect(within(card).getByTestId("acp-agent-program-pi")).toBeInTheDocument();
    expect(within(card).getByRole("textbox", { name: program.inputLabel.replace("{{name}}", "Pi") })).toBeInTheDocument();
    expect(card).not.toHaveTextContent("PATH");
  });

  it("tests a chosen program, saves it, and shows the agent as ready", async () => {
    catalog = [pi()];
    const saved = pi({ programOverride: PICKED, cli: { ...piCli, path: PICKED, source: "override", version: "0.81.2" } });
    vi.mocked(acpPickAgentProgram).mockResolvedValue(PICKED);
    vi.mocked(acpCheckAgent).mockResolvedValue({ ok: true, code: "ready", detail: null, program: PICKED, version: "0.81.2", agentName: "pi-acp" });
    vi.mocked(acpSetAgentProgram).mockResolvedValue(saved);
    const ui = render(<AcpAgentsTab projectId="paper" />);
    const card = await expandAgent(ui, "pi");
    expect(card).toHaveTextContent("CLI not found");

    fireEvent.click(within(card).getByRole("button", { name: program.choose }));

    expect(await within(card).findByRole("status")).toHaveTextContent("Pi 0.81.2 started and answered.");
    expect(acpCheckAgent).toHaveBeenCalledExactlyOnceWith("pi", PICKED);
    expect(acpSetAgentProgram).toHaveBeenCalledExactlyOnceWith("pi", PICKED);
    expect(card).toHaveTextContent("Ready");
    expect(within(card).getByTestId("acp-agent-program-pi")).toHaveTextContent(program.source.override);
    expect(useAcpSessionsStore.getState().catalog[0]).toEqual(saved);
  });

  it("installs the bridge a failed test asked for and then tests the same file again", async () => {
    const found = { ...piCli, path: "/usr/local/bin/pi" };
    catalog = [pi({ installed: false, managed: false, executable: null, cli: found })];
    vi.mocked(acpPickAgentProgram).mockResolvedValue("/opt/pi/bin/pi");
    vi.mocked(acpCheckAgent)
      .mockResolvedValueOnce({ ok: false, code: "bridge_missing", detail: null, program: "/opt/pi/bin/pi", version: null, agentName: null })
      .mockResolvedValueOnce({ ok: true, code: "ready", detail: null, program: "/opt/pi/bin/pi", version: "0.81.2", agentName: null });
    vi.mocked(acpInstall).mockImplementation(async () => {
      catalog = [pi({ cli: found })];
      return catalog[0];
    });
    vi.mocked(acpSetAgentProgram).mockResolvedValue(pi({ programOverride: "/opt/pi/bin/pi", cli: { ...found, path: "/opt/pi/bin/pi" } }));
    const ui = render(<AcpAgentsTab projectId="paper" />);
    const card = await expandAgent(ui, "pi");
    fireEvent.click(within(card).getByRole("button", { name: program.choose }));
    const result = await within(card).findByTestId("acp-agent-program-result-pi");
    fireEvent.click(within(result).getByRole("button", { name: copy.installBridge }));
    fireEvent.click(within(await ui.findByRole("dialog")).getByRole("button", { name: copy.install.confirm }));

    expect(await within(card).findByRole("status")).toHaveTextContent("Pi 0.81.2 started and answered.");
    expect(acpInstall).toHaveBeenCalledExactlyOnceWith("pi");
    expect(acpCheckAgent).toHaveBeenLastCalledWith("pi", "/opt/pi/bin/pi");
    expect(acpSetAgentProgram).toHaveBeenCalledExactlyOnceWith("pi", "/opt/pi/bin/pi");
  });

  it("keeps the bridged vendor CLI choice inside the bridge details", async () => {
    catalog = [
      agent("claude", {
        definition: { ...agent().definition, id: "claude", name: "Claude Code", builtin: true },
        installed: true, managed: true,
        cli: { command: "claude", displayName: "Claude Code", path: "/usr/local/bin/claude", version: "2.1.258", signInCommand: "claude auth login" },
      }),
    ];
    const ui = render(<AcpAgentsTab />);
    const card = await expandAgent(ui, "claude");
    expect(within(card).queryByTestId("acp-agent-program-claude")).not.toBeInTheDocument();
    fireEvent.click(within(card).getByTestId("acp-agent-bridge-details-claude-toggle"));
    const row = within(card).getByTestId("acp-agent-program-claude");
    expect(row).toHaveTextContent(program.bridgeLabel.replace("{{cli}}", "Claude Code"));
    expect(row).toHaveTextContent(program.bridgeDefault);
  });

  it("keeps multi-line install errors readable and copyable", async () => {
    catalog = [agent("fixture", { installed: false })];
    const failure = "npm error code EISDIR\nnpm error syscall lstat\nnpm error path D:";
    vi.mocked(acpInstall).mockRejectedValue(failure);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const ui = render(<AcpAgentsTab />);
    await expandAgent(ui);
    fireEvent.click(ui.getByTestId("acp-agent-install-fixture"));
    const dialog = await ui.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: copy.install.confirm }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe(failure);
    expect(alert).toHaveClass("whitespace-pre-wrap");
    fireEvent.click(within(dialog).getByRole("button", { name: program.copyDetails }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(failure));
  });

  it("shows a registry entry for a built-in agent as built in and opens its card", async () => {
    catalog = [pi({ cli: { ...piCli, path: "/usr/local/bin/pi" } })];
    const definition = { ...agent().definition, id: "pi-acp", name: "pi ACP" };
    vi.mocked(acpRegistrySearch).mockResolvedValue([
      { id: "pi-acp", name: "pi ACP", description: "ACP adapter for pi", version: "0.0.34", definition, reason: null, builtinId: "pi" },
    ]);
    const ui = render(<AcpAgentsTab />);
    const card = await ui.findByTestId("acp-agent-card-pi");
    openSection(ui, "registry");
    fill(ui.getByLabelText(copy.registry.searchLabel), "pi");
    fireEvent.click(ui.getByRole("button", { name: copy.registry.search }));
    const show = await ui.findByRole("button", { name: setupCopy.showAgent });
    expect(ui.getByText(setupCopy.builtIn)).toBeInTheDocument();
    expect(ui.queryByRole("button", { name: copy.registry.register })).not.toBeInTheDocument();
    fireEvent.click(show);
    await waitFor(() => expect(within(card).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true"));
    expect(acpRegister).not.toHaveBeenCalled();
  });

  it("expands and scrolls to the agent a deep link names once the list arrives", async () => {
    const check = deferred<AcpAgentStatus[]>();
    vi.mocked(acpCatalog).mockReturnValueOnce(check.promise);
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const ui = render(<AcpAgentsTab focusAgentId="pi" focusToken={1} />);
    await act(async () => check.resolve([agent(), pi()]));
    const card = await ui.findByTestId("acp-agent-card-pi");
    await waitFor(() => expect(within(card).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true"));
    expect(within(ui.getByTestId("acp-agent-card-fixture")).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(card);
    scrollIntoView.mockRestore();
  });

  it("reports a deep link as handled once, so the host can drop it", async () => {
    vi.mocked(acpCatalog).mockResolvedValueOnce([agent(), pi()]);
    const onFocusHandled = vi.fn();
    const ui = render(<AcpAgentsTab focusAgentId="pi" focusToken={3} onFocusHandled={onFocusHandled} />);
    await ui.findByTestId("acp-agent-card-pi");
    expect(onFocusHandled).toHaveBeenCalledExactlyOnceWith(3);
    ui.rerender(<AcpAgentsTab focusAgentId="pi" focusToken={3} onFocusHandled={() => onFocusHandled("new callback")} />);
    await act(async () => {});
    expect(onFocusHandled).toHaveBeenCalledTimes(1);
  });
});

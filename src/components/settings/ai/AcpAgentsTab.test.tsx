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
}));

import { acpCatalog, acpInstall, acpRegister, acpRegistrySearch, acpRemoveAgent, acpStart, type AcpAgentStatus } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import { agent, deferred, session } from "@/components/ai/acp/tests/ui-fixtures";
import { initializeI18n } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
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
    const ui = render(<AcpAgentsTab projectId="paper" />);
    const card = await ui.findByTestId("acp-agent-card-claude");
    expect(card).toHaveTextContent("Bridge needed");
    expect(card).toHaveTextContent("Claude Code 2.1.258 found at /Users/researcher/.local/bin/claude");
    expect(card).not.toHaveTextContent("Not installed");
    fireEvent.click(within(card).getByRole("button", { expanded: false }));
    const cliDetails = within(card).getByRole("region", {
      name: copy.cliTitle,
    });
    expect(cliDetails).toHaveTextContent(copy.cliPathLabel);
    expect(cliDetails).toHaveTextContent("/Users/researcher/.local/bin/claude");
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
    expect(card).toHaveTextContent("Codex is not on your PATH");
    fireEvent.click(within(card).getByRole("button", { expanded: false }));
    expect(within(card).getByTestId("acp-agent-install-codex")).toBeDisabled();
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

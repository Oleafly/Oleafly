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
afterEach(cleanup);
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
    expect(await ui.findByRole("status")).toHaveTextContent(
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
    await ui.findByRole("status");
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
    expect(await ui.findByRole("status")).toHaveTextContent(
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
    expect(await ui.findByRole("status")).toHaveTextContent(copy.notice.removed);
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

  it("names the vendor CLI it found instead of reporting the agent as not installed", async () => {
    catalog = [
      agent("claude", {
        definition: { ...agent().definition, id: "claude", name: "Claude Code", version: "0.74.0", builtin: true },
        installed: false,
        executable: null,
        canInstall: true,
        cli: { command: "claude", displayName: "Claude Code", path: "/Users/researcher/.local/bin/claude", version: "2.1.258", signInCommand: "claude auth login" },
      }),
    ];
    const ui = render(<AcpAgentsTab projectId="paper" />);
    const card = await ui.findByTestId("acp-agent-card-claude");
    expect(card).toHaveTextContent("Bridge needed");
    expect(card).toHaveTextContent("Claude Code 2.1.258 found at /Users/researcher/.local/bin/claude");
    expect(card).not.toHaveTextContent("Not installed");
    fireEvent.click(within(card).getByRole("button", { expanded: false }));
    expect(card).toHaveTextContent("claude auth login");
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
});

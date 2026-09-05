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
import { AcpAgentsTab } from "./AcpAgentsTab";

let catalog: AcpAgentStatus[];
beforeEach(() => {
  vi.resetAllMocks();
  catalog = [];
  useAcpSessionsStore.setState({ catalog: [], sessions: { saved: session() }, activeByProject: {}, events: {}, permissions: {} });
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

describe("ACP agent setup acceptance", () => {
  it("registers exactly the reviewed custom definition without installing or launching it", async () => {
    const ui = render(<AcpAgentsTab projectId="paper" />);
    expect(ui.getByRole("button", { name: "Register definition" })).toBeDisabled();
    fireEvent.click(ui.getByRole("button", { name: "Use example" }));
    expect((ui.getByLabelText("Register a custom agent") as HTMLTextAreaElement).value).toContain('"my-agent"');
    const definition = agent().definition;
    const json = JSON.stringify(definition);
    const input = ui.getByLabelText("Register a custom agent");
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: json } });
    fireEvent.keyUp(input, { key: "a" });
    fireEvent.click(ui.getByRole("button", { name: "Register definition" }));
    expect(await ui.findByRole("status")).toHaveTextContent("Research CLI is registered");
    expect(acpRegister).toHaveBeenCalledExactlyOnceWith(json);
    expect(ui.getByRole("heading", { name: "Research CLI" })).toBeInTheDocument();
    expect(acpInstall).not.toHaveBeenCalled();
    expect(acpStart).not.toHaveBeenCalled();
  });

  it("keeps a rejected definition editable and clears its error after a successful retry", async () => {
    vi.mocked(acpRegister).mockRejectedValueOnce(new Error("The package version must be pinned."));
    const ui = render(<AcpAgentsTab />);
    const input = ui.getByLabelText("Register a custom agent");
    const json = JSON.stringify(agent().definition);
    fireEvent.focusIn(input);
    fireEvent.change(input, { target: { value: json } });
    fireEvent.keyUp(input, { key: "a" });
    fireEvent.click(ui.getByRole("button", { name: "Register definition" }));
    expect(await ui.findByRole("alert")).toHaveTextContent("The package version must be pinned.");
    expect(input).toHaveValue(json);
    fireEvent.click(ui.getByRole("button", { name: "Register definition" }));
    await ui.findByRole("status");
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requires installation review, prevents duplicate installs, and retains a failed review for retry", async () => {
    catalog = [agent()];
    const install = deferred<AcpAgentStatus>();
    vi.mocked(acpInstall).mockReturnValueOnce(install.promise).mockResolvedValue(agent("fixture", { managed: true }));
    const ui = render(<AcpAgentsTab />);
    fireEvent.click(await ui.findByRole("button", { name: "Review installation" }));
    expect(ui.getByRole("group", { name: "Review agent installation" })).toHaveTextContent("research-fixture@1.2.3");
    expect(acpInstall).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: "Cancel" }));
    expect(ui.queryByRole("group", { name: "Review agent installation" })).not.toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: "Review installation" }));
    fireEvent.click(ui.getByRole("button", { name: "Install pinned version" }));
    expect(ui.getByRole("button", { name: "Installing…" })).toBeDisabled();
    expect(ui.getByRole("button", { name: "Remove definition" })).toBeDisabled();
    await act(async () => install.reject(new Error("Download interrupted")));
    expect(ui.getByRole("alert")).toHaveTextContent("Download interrupted");
    expect(ui.getByRole("group", { name: "Review agent installation" })).toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: "Install pinned version" }));
    expect(await ui.findByRole("status")).toHaveTextContent("Research CLI is installed");
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
    const query = ui.getByLabelText("Find an ACP agent");
    fireEvent.focusIn(query);
    fireEvent.change(query, { target: { value: "research" } });
    fireEvent.keyUp(query, { key: "h" });
    fireEvent.click(ui.getByRole("button", { name: "Search" }));
    await ui.findByText("Unverified binary");
    const buttons = ui.getAllByRole("button", { name: "Register agent" });
    expect(buttons[0]).toBeDisabled();
    fireEvent.click(buttons[1]);
    expect(await ui.findByRole("button", { name: "Registered" })).toBeDisabled();
    expect(acpRegistrySearch).toHaveBeenCalledExactlyOnceWith("research");
    expect(acpRegister).toHaveBeenCalledExactlyOnceWith(JSON.stringify(definition));
    expect(acpInstall).not.toHaveBeenCalled();
  });

  it("surfaces removal errors and removes only the definition after retry", async () => {
    catalog = [agent(), agent("builtin", { definition: { ...agent().definition, id: "builtin", name: "Built-in CLI", builtin: true } })];
    vi.mocked(acpRemoveAgent).mockRejectedValueOnce("Disconnect its sessions first.").mockImplementation(async (id) => { catalog = catalog.filter((entry) => entry.definition.id !== id); });
    const ui = render(<AcpAgentsTab />);
    const remove = await ui.findByRole("button", { name: "Remove definition" });
    fireEvent.click(remove);
    expect(await ui.findByRole("alert")).toHaveTextContent("Disconnect its sessions first.");
    fireEvent.click(remove);
    expect(await ui.findByRole("status")).toHaveTextContent("Installed files and saved conversations remain available.");
    expect(acpRemoveAgent).toHaveBeenLastCalledWith("fixture");
    expect(ui.queryByRole("heading", { name: "Research CLI" })).not.toBeInTheDocument();
    expect(useAcpSessionsStore.getState().sessions.saved).toEqual(session());
  });

  it("opens the current project's sign-in terminal without starting an agent", async () => {
    useTerminalsStore.getState().setProject("paper");
    const initial = useTerminalsStore.getState().tabs;
    const ui = render(<AcpAgentsTab projectId="paper" />);
    fireEvent.click(ui.getByRole("button", { name: "Open sign-in terminal" }));
    await waitFor(() => expect(useTerminalsStore.getState().projectId).toBe("paper"));
    expect(useTerminalsStore.getState().tabs).toHaveLength(initial.length + 1);
    expect(useTerminalsStore.getState().activeId).not.toBe(initial[0].id);
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    expect(acpStart).not.toHaveBeenCalled();
    ui.rerender(<AcpAgentsTab />);
    expect(within(ui.container).queryByRole("button", { name: "Open sign-in terminal" })).not.toBeInTheDocument();
  });
});

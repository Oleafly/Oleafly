import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpPreferences: vi.fn(),
  acpSetPreferences: vi.fn(),
  acpAgentPreferences: vi.fn(),
  acpSetAgentPreferences: vi.fn(),
  acpProviderChoices: vi.fn(),
  acpHermesSettings: vi.fn(),
  acpSetHermesSettings: vi.fn(),
  acpHermesStatus: vi.fn(),
  acpHermesSetOption: vi.fn(),
  acpTestRemoteHermes: vi.fn(),
}));

import {
  acpAgentPreferences, acpHermesSetOption, acpHermesSettings, acpHermesStatus, acpPreferences, acpProviderChoices,
  acpSetAgentPreferences, acpSetHermesSettings, acpSetPreferences, acpTestRemoteHermes,
  type AcpHermesSettings, type AcpHermesStatus, type AcpPreferences,
} from "@/lib/acp";
import { chooseOption } from "@/components/ai/acp/tests/ui-fixtures";
import { AcpAgentChoices } from "./AcpAgentChoices";
import { AcpExperimentalSection } from "./AcpExperimentalSection";
import { AcpProvidersSection } from "./AcpProvidersSection";
import { HermesSection, remoteIssues, remoteProblem } from "./HermesSection";

const prefs = (overrides: Partial<AcpPreferences> = {}): AcpPreferences => ({
  experimentalV2: false, experimentalProviders: false, inactivityMinutes: 20, ...overrides,
});
const hermes = (overrides: Partial<AcpHermesSettings> = {}): AcpHermesSettings => ({
  mode: "default", profile: null, memory: false, toolGateway: false, remote: null, ...overrides,
});
const status = (overrides: Partial<AcpHermesStatus> = {}): AcpHermesStatus => ({
  mode: "default", profile: null, exists: true, gateway: "ready", reason: null, memory: false, toolGateway: false, ...overrides,
});

async function openExperimental() {
  render(<AcpExperimentalSection />);
  fireEvent.click(screen.getByTestId("acp-experimental-toggle"));
  await waitFor(() => expect(screen.getByRole("switch", { name: "Use ACP v2 when available" })).not.toHaveAttribute("aria-disabled"));
}

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("Experimental agent settings", () => {
  it("turns the experimental switches on and keeps them after reload", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    vi.mocked(acpSetPreferences).mockImplementation(async (value) => value);
    await openExperimental();
    fireEvent.click(screen.getByRole("switch", { name: "Use ACP v2 when available" }));
    await waitFor(() => expect(acpSetPreferences).toHaveBeenCalledWith(prefs({ experimentalV2: true })));
    fireEvent.click(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" }));
    await waitFor(() => expect(acpSetPreferences).toHaveBeenLastCalledWith(prefs({ experimentalV2: true, experimentalProviders: true })));
    cleanup();
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalV2: true, experimentalProviders: true }));
    await openExperimental();
    expect(screen.getByRole("switch", { name: "Use ACP v2 when available" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves the inactivity limit", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    vi.mocked(acpSetPreferences).mockImplementation(async (value) => value);
    await openExperimental();
    const trigger = screen.getByTestId("acp-inactivity");
    expect(trigger).toHaveTextContent("20 minutes");
    await chooseOption(trigger, "60 minutes");
    await waitFor(() => expect(acpSetPreferences).toHaveBeenCalledWith(prefs({ inactivityMinutes: 60 })));
  });

  it("lists a saved limit that is not one of the usual choices", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ inactivityMinutes: 45 }));
    await openExperimental();
    expect(screen.getByTestId("acp-inactivity")).toHaveTextContent("45 minutes");
  });

  it("shows why the settings could not be read or saved, and puts the switch back", async () => {
    vi.mocked(acpPreferences).mockRejectedValueOnce(new Error("Settings are locked."));
    render(<AcpExperimentalSection />);
    fireEvent.click(screen.getByTestId("acp-experimental-toggle"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Settings are locked.");
    expect(screen.getByRole("switch", { name: "Use ACP v2 when available" })).toHaveAttribute("aria-disabled", "true");
    cleanup();
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    vi.mocked(acpSetPreferences).mockRejectedValue(new Error("Disk full."));
    await openExperimental();
    const v2 = screen.getByRole("switch", { name: "Use ACP v2 when available" });
    fireEvent.click(v2);
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full.");
    expect(v2).toHaveAttribute("aria-checked", "false");
  });

  it("keeps a newer change when an earlier save fails", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    let failFirst: (error: Error) => void = () => {};
    vi.mocked(acpSetPreferences)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }))
      .mockImplementation(async (value) => value);
    await openExperimental();
    fireEvent.click(screen.getByRole("switch", { name: "Use ACP v2 when available" }));
    await waitFor(() => expect(acpSetPreferences).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" }));
    await waitFor(() => expect(acpSetPreferences).toHaveBeenLastCalledWith(prefs({ experimentalV2: true, experimentalProviders: true })));
    failFirst(new Error("Disk full."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full.");
    expect(screen.getByRole("switch", { name: "Use ACP v2 when available" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Remembered agent choices", () => {
  it("forgets a remembered effort", async () => {
    const remembered = { effort: { value: "high", name: "High" }, mode: { value: "plan", name: "Plan" }, provider: null };
    vi.mocked(acpAgentPreferences).mockResolvedValue(remembered);
    vi.mocked(acpSetAgentPreferences).mockImplementation(async (_agent, value) => value);
    render(<AcpAgentChoices agentId="claude" />);
    expect(await screen.findByText("Effort: High")).toBeInTheDocument();
    expect(screen.getByText("Mode: Plan")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]);
    await waitFor(() => expect(acpSetAgentPreferences).toHaveBeenCalledWith("claude", { ...remembered, effort: null }));
    await waitFor(() => expect(screen.queryByText("Effort: High")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(screen.getByText("New conversations use the agent's defaults.")).toBeInTheDocument());
  });

  it("reports a failure to read or forget a choice", async () => {
    vi.mocked(acpAgentPreferences).mockRejectedValueOnce(new Error("No such agent."));
    render(<AcpAgentChoices agentId="ghost" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No such agent.");
    cleanup();
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: { value: "plan", name: "Plan" }, provider: null });
    vi.mocked(acpSetAgentPreferences).mockRejectedValue(new Error("Could not save."));
    render(<AcpAgentChoices agentId="claude" />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save.");
    expect(screen.getByText("Mode: Plan")).toBeInTheDocument();
  });
});

describe("Routing an agent through an Oleafly key", () => {
  it("routes an agent through an Oleafly key when the switch is on", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalProviders: true }));
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([{ id: "openrouter", label: "OpenRouter", apiType: "openai" }]);
    vi.mocked(acpSetAgentPreferences).mockImplementation(async (_agent, value) => value);
    render(<AcpProvidersSection agentId="claude" />);
    const trigger = await screen.findByRole("combobox", { name: "Use my Oleafly API key" });
    expect(trigger).toHaveTextContent("Off (the agent signs in on its own)");
    await chooseOption(trigger, "OpenRouter");
    await waitFor(() => expect(acpSetAgentPreferences).toHaveBeenCalledWith("claude", { effort: null, mode: null, provider: "openrouter" }));
    await chooseOption(trigger, "Off (the agent signs in on its own)");
    await waitFor(() => expect(acpSetAgentPreferences).toHaveBeenLastCalledWith("claude", { effort: null, mode: null, provider: null }));
  });

  it("stays hidden while the experimental switch is off", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([]);
    render(<AcpProvidersSection agentId="claude" />);
    await waitFor(() => expect(acpProviderChoices).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("acp-agent-providers-claude")).toBeNull();
  });

  it("asks for an API key when there is none to route through", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalProviders: true }));
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([]);
    render(<AcpProvidersSection agentId="claude" />);
    expect(
      await screen.findByText("Add an API key in Settings, AI Assistant, Providers and keys to use it here."),
    ).toBeInTheDocument();
  });

  it("reports a failure to save the key choice", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalProviders: true }));
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: "openrouter" });
    vi.mocked(acpProviderChoices).mockResolvedValue([{ id: "openrouter", label: "OpenRouter", apiType: "openai" }, { id: "groq", label: "Groq", apiType: "openai" }]);
    vi.mocked(acpSetAgentPreferences).mockRejectedValue(new Error("This agent cannot use Groq."));
    render(<AcpProvidersSection agentId="claude" />);
    await chooseOption(await screen.findByRole("combobox", { name: "Use my Oleafly API key" }), "Groq");
    expect(await screen.findByRole("alert")).toHaveTextContent("This agent cannot use Groq.");
  });

  it("stays hidden when the choices cannot be read", async () => {
    vi.mocked(acpPreferences).mockRejectedValue(new Error("x"));
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([]);
    const { container } = render(<AcpProvidersSection agentId="claude" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Hermes for this project", () => {
  it("creates a project profile for Hermes and toggles its memory", async () => {
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes());
    vi.mocked(acpHermesStatus).mockResolvedValue(status());
    vi.mocked(acpSetHermesSettings).mockResolvedValue(status({ mode: "project", profile: "oleafly-paper", gateway: "starting" }));
    vi.mocked(acpHermesSetOption).mockResolvedValue(status({ mode: "project", profile: "oleafly-paper", memory: true }));
    render(<HermesSection projectId="paper" />);
    expect(await screen.findByText("Gateway running")).toBeInTheDocument();
    expect(screen.getByText("Disconnecting Oleafly never stops the gateway.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Project profile" }));
    await waitFor(() => expect(acpSetHermesSettings).toHaveBeenCalledWith("paper", hermes({ mode: "project" })));
    expect(await screen.findByText("Profile oleafly-paper")).toBeInTheDocument();
    expect(screen.getByText("Gateway starting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Project memory" }));
    await waitFor(() => expect(acpHermesSetOption).toHaveBeenCalledWith("paper", "memory", true));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Project memory" })).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("switch", { name: "Tool Gateway" }));
    await waitFor(() => expect(acpHermesSetOption).toHaveBeenCalledWith("paper", "toolGateway", true));
  });

  it("shows the gateway state with its reason and checks again", async () => {
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes());
    vi.mocked(acpHermesStatus)
      .mockResolvedValueOnce(status({ gateway: "stopped", reason: "hermes is not installed" }))
      .mockResolvedValueOnce(status({ gateway: "unknown" }))
      .mockRejectedValueOnce(new Error("The status check failed."));
    render(<HermesSection projectId="paper" />);
    expect(await screen.findByText("Gateway stopped (hermes is not installed)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Gateway status unknown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The status check failed.");
  });

  it("tests a remote Hermes connection", async () => {
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes());
    vi.mocked(acpHermesStatus).mockResolvedValue(status());
    vi.mocked(acpTestRemoteHermes).mockResolvedValue("hermes 1.2.0");
    vi.mocked(acpSetHermesSettings).mockResolvedValue(status({ mode: "remote" }));
    render(<HermesSection projectId="paper" />);
    await screen.findByText("Gateway running");
    fireEvent.click(screen.getByRole("radio", { name: "Remote over SSH" }));
    expect(acpSetHermesSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: " lab.example.org " } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "2222" } });
    fireEvent.change(screen.getByLabelText("Project folder on that machine"), { target: { value: "/home/ada/paper" } });
    fireEvent.change(screen.getByLabelText("Profile (optional)"), { target: { value: "lab" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(acpTestRemoteHermes).toHaveBeenCalledWith("paper", {
      host: "lab.example.org", port: 2222, folder: "/home/ada/paper", command: "hermes", profile: "lab",
    }));
    expect(await screen.findByText("Connected: hermes 1.2.0")).toBeInTheDocument();
    expect(screen.getByText("Oleafly signs in with your SSH keys only.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Profile (optional)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(acpSetHermesSettings).toHaveBeenCalledWith("paper", hermes({
      mode: "remote", remote: { host: "lab.example.org", port: null, folder: "/home/ada/paper", command: "hermes", profile: null },
    })));
  });

  it("says why the remote buttons are disabled and what is not saved yet", async () => {
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes());
    vi.mocked(acpHermesStatus).mockResolvedValue(status());
    vi.mocked(acpSetHermesSettings).mockResolvedValue(status({ mode: "remote" }));
    render(<HermesSection projectId="paper" />);
    await screen.findByText("Gateway running");
    fireEvent.click(screen.getByRole("radio", { name: "Remote over SSH" }));

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Test connection and Save need valid values for: Host and Project folder on that machine."))
      .toHaveAttribute("id", save.getAttribute("aria-describedby"));
    expect(screen.getByText("Not saved yet. Until you save, this project keeps using: Default profile (shared).")).toBeInTheDocument();
    // An untouched empty field stays quiet; the folder shows what to type.
    expect(screen.queryByText("Enter the host name or user@host.")).toBeNull();
    expect(screen.getByText("The full path on that machine, such as /home/ada/paper.")).toBeInTheDocument();

    const host = screen.getByLabelText("Host");
    fireEvent.blur(host);
    expect(screen.getByText("Enter the host name or user@host.")).toBeInTheDocument();
    fireEvent.change(host, { target: { value: "-oProxy" } });
    expect(host).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use only letters, digits, dots, dashes and @, and don't start with a dash.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Project folder on that machine"), { target: { value: "papers" } });
    expect(screen.getByText("Use the full path, starting with /.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "70000" } });
    expect(screen.getByText("Use a port from 1 to 65535.")).toBeInTheDocument();
    expect(acpSetHermesSettings).not.toHaveBeenCalled();

    fireEvent.change(host, { target: { value: "lab" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Project folder on that machine"), { target: { value: "/home/ada/paper" } });
    expect(save).toBeEnabled();
    expect(host).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/need valid values for/)).toBeNull();
    expect(screen.getByText("Not saved yet. Until you save, this project keeps using: Default profile (shared).")).toBeInTheDocument();

    fireEvent.click(save);
    await waitFor(() => expect(acpSetHermesSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/Not saved yet/)).toBeNull());
    fireEvent.change(screen.getByLabelText("Hermes command"), { target: { value: "/opt/hermes" } });
    expect(screen.getByText("Not saved yet. Save to use these changes.")).toBeInTheDocument();
  });

  it("reports a failed connection test and saves a valid remote at once", async () => {
    const remote = { host: "lab", port: null, folder: "/home/ada/paper", command: "/opt/hermes/bin/hermes", profile: null };
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes({ remote }));
    vi.mocked(acpHermesStatus).mockResolvedValue(status());
    vi.mocked(acpTestRemoteHermes).mockRejectedValue(new Error("Permission denied (publickey)."));
    vi.mocked(acpSetHermesSettings).mockResolvedValue(status({ mode: "remote" }));
    render(<HermesSection projectId="paper" />);
    await screen.findByText("Gateway running");
    fireEvent.click(screen.getByRole("radio", { name: "Remote over SSH" }));
    await waitFor(() => expect(acpSetHermesSettings).toHaveBeenCalledWith("paper", hermes({ mode: "remote", remote })));
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied (publickey).");
  });

  it("opens on the remote settings without asking the local gateway", async () => {
    const remote = { host: "lab", port: 22, folder: "/srv/paper", command: "hermes", profile: "lab" };
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes({ mode: "remote", remote }));
    render(<HermesSection projectId="paper" />);
    expect(await screen.findByLabelText("Host")).toHaveValue("lab");
    expect(acpHermesStatus).not.toHaveBeenCalled();
    expect(screen.queryByText("Disconnecting Oleafly never stops the gateway.")).toBeNull();
  });

  it("shows why the Hermes settings could not be read", async () => {
    vi.mocked(acpHermesSettings).mockRejectedValue(new Error("Hermes settings are damaged."));
    render(<HermesSection projectId="paper" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Hermes settings are damaged.");
  });

  it("reports a failed save of the Hermes mode", async () => {
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes());
    vi.mocked(acpHermesStatus).mockResolvedValue(status());
    vi.mocked(acpSetHermesSettings).mockRejectedValue(new Error("Could not create the profile."));
    render(<HermesSection projectId="paper" />);
    await screen.findByText("Gateway running");
    fireEvent.click(screen.getByRole("radio", { name: "Project profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the profile.");
  });
});

describe("remote Hermes checks", () => {
  const ok = { host: "lab", port: null, folder: "/home/ada/paper", command: "hermes", profile: null };

  it("accepts a complete remote", () => {
    expect(remoteProblem(ok)).toBe(false);
    expect(remoteProblem({ ...ok, port: 22, profile: "lab-1", command: "/usr/local/bin/hermes" })).toBe(false);
    expect(remoteProblem({ ...ok, profile: "" })).toBe(false);
  });

  it("names the field that is wrong", () => {
    expect(remoteIssues(ok)).toEqual({});
    expect(remoteIssues({ ...ok, host: "", folder: "" })).toEqual({ host: "required", folder: "required" });
    expect(remoteIssues({ ...ok, host: "lab;rm", port: 0, folder: "rel", command: "x", profile: "Bad" })).toEqual({
      host: "invalid", port: "invalid", folder: "invalid", command: "invalid", profile: "invalid",
    });
  });

  it("refuses a bad host, port, folder, command or profile", () => {
    expect(remoteProblem({ ...ok, host: "" })).toBe(true);
    expect(remoteProblem({ ...ok, host: "-oProxyCommand=x" })).toBe(true);
    expect(remoteProblem({ ...ok, host: "lab;rm" })).toBe(true);
    expect(remoteProblem({ ...ok, port: 0 })).toBe(true);
    expect(remoteProblem({ ...ok, port: 70000 })).toBe(true);
    expect(remoteProblem({ ...ok, folder: "relative/path" })).toBe(true);
    expect(remoteProblem({ ...ok, folder: "/home/ada\npaper" })).toBe(true);
    expect(remoteProblem({ ...ok, command: "hermes; rm -rf /" })).toBe(true);
    expect(remoteProblem({ ...ok, profile: "Bad Profile" })).toBe(true);
  });
});

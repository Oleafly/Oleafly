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
  acpSetAgentPreference: vi.fn(),
  acpProviderChoices: vi.fn(),
  acpHermesSettings: vi.fn(),
  acpSetHermesSettings: vi.fn(),
  acpHermesStatus: vi.fn(),
  acpHermesSetOption: vi.fn(),
  acpTestRemoteHermes: vi.fn(),
}));

import {
  acpAgentPreferences, acpHermesSetOption, acpHermesSettings, acpHermesStatus, acpPreferences, acpProviderChoices,
  acpSetAgentPreference, acpSetAgentPreferences, acpSetHermesSettings, acpSetPreferences, acpTestRemoteHermes,
  type AcpAgentPreferences, type AcpHermesSettings, type AcpHermesStatus, type AcpPreferences,
} from "@/lib/acp";
import { chooseOption } from "@/components/ai/acp/tests/ui-fixtures";
import { AcpAgentPreferenceSections } from "./AcpAgentPreferenceSections";
import { AcpExperimentalSection } from "./AcpExperimentalSection";
import { HermesSection, remoteIssues, remoteProblem } from "./HermesSection";

function storeAgentPreferences(initial: AcpAgentPreferences) {
  let stored = initial;
  vi.mocked(acpAgentPreferences).mockImplementation(async () => stored);
  vi.mocked(acpSetAgentPreference).mockImplementation(async (_agent, slot, value) => {
    stored = { ...stored, [slot]: value } as AcpAgentPreferences;
    return stored;
  });
  return () => stored;
}

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

  it("names a saved one-minute limit in the singular", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ inactivityMinutes: 1 }));
    await openExperimental();
    const trigger = screen.getByTestId("acp-inactivity");
    expect(trigger).toHaveTextContent("1 minute");
    expect(trigger).not.toHaveTextContent("1 minutes");
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

  it("keeps a newer switch when the answer to an earlier save arrives late", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    let answerFirst: (value: AcpPreferences) => void = () => {};
    vi.mocked(acpSetPreferences)
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockImplementation(async (value) => value);
    await openExperimental();
    fireEvent.click(screen.getByRole("switch", { name: "Use ACP v2 when available" }));
    await waitFor(() => expect(acpSetPreferences).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" }));
    await waitFor(() => expect(acpSetPreferences).toHaveBeenCalledTimes(2));
    answerFirst(prefs({ experimentalV2: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("switch", { name: "Use ACP v2 when available" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the stored values after two saves in a row fail", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    const failures: ((error: Error) => void)[] = [];
    vi.mocked(acpSetPreferences).mockImplementation(() => new Promise((_resolve, reject) => { failures.push(reject); }));
    await openExperimental();
    fireEvent.click(screen.getByRole("switch", { name: "Use ACP v2 when available" }));
    fireEvent.click(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" }));
    await waitFor(() => expect(failures).toHaveLength(2));
    failures[0](new Error("Disk full."));
    failures[1](new Error("Disk full."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Disk full.");
    await waitFor(() => expect(acpPreferences).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Use ACP v2 when available" })).toHaveAttribute("aria-checked", "false"),
    );
    expect(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("Remembered agent choices", () => {
  it("forgets a remembered effort", async () => {
    const remembered = { effort: { value: "high", name: "High" }, mode: { value: "plan", name: "Plan" }, provider: null };
    storeAgentPreferences(remembered);
    render(<AcpAgentPreferenceSections agentId="claude" providers={false} />);
    expect(await screen.findByText("Effort: High")).toBeInTheDocument();
    expect(screen.getByText("Mode: Plan")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]);
    await waitFor(() => expect(acpSetAgentPreference).toHaveBeenCalledWith("claude", "effort", null));
    await waitFor(() => expect(screen.queryByText("Effort: High")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(acpSetAgentPreference).toHaveBeenLastCalledWith("claude", "mode", null));
    await waitFor(() => expect(screen.getByText("New conversations use the agent's defaults.")).toBeInTheDocument());
    expect(acpSetAgentPreferences).not.toHaveBeenCalled();
  });

  it("reports a failure to read or forget a choice", async () => {
    vi.mocked(acpAgentPreferences).mockRejectedValueOnce(new Error("No such agent."));
    render(<AcpAgentPreferenceSections agentId="ghost" providers={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No such agent.");
    cleanup();
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: { value: "plan", name: "Plan" }, provider: null });
    vi.mocked(acpSetAgentPreference).mockRejectedValue(new Error("Could not save."));
    render(<AcpAgentPreferenceSections agentId="claude" providers={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save.");
    expect(screen.getByText("Mode: Plan")).toBeInTheDocument();
  });
});

describe("One agent card's remembered choices and key routing", () => {
  const high = { value: "high", name: "High" };

  beforeEach(() => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalProviders: true }));
    vi.mocked(acpProviderChoices).mockResolvedValue([{ id: "openai", label: "OpenAI", apiType: "openai" }]);
  });

  it("keeps the chosen key when the effort is forgotten afterwards", async () => {
    const stored = storeAgentPreferences({ effort: high, mode: null, provider: null });
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    const trigger = await screen.findByRole("combobox", { name: "Use my Oleafly API key" });
    await chooseOption(trigger, "OpenAI");
    await waitFor(() => expect(stored().provider).toBe("openai"));

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(screen.getByText("New conversations use the agent's defaults.")).toBeInTheDocument());
    expect(stored()).toEqual({ effort: null, mode: null, provider: "openai" });
    expect(screen.getByRole("combobox", { name: "Use my Oleafly API key" })).toHaveTextContent("OpenAI");
  });

  it("does not bring a forgotten effort back when a key is chosen afterwards", async () => {
    const stored = storeAgentPreferences({ effort: high, mode: null, provider: null });
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget" }));
    await waitFor(() => expect(screen.getByText("New conversations use the agent's defaults.")).toBeInTheDocument());

    await chooseOption(await screen.findByRole("combobox", { name: "Use my Oleafly API key" }), "OpenAI");
    await waitFor(() => expect(stored()).toEqual({ effort: null, mode: null, provider: "openai" }));
    expect(screen.getByText("New conversations use the agent's defaults.")).toBeInTheDocument();
  });
});

describe("Routing an agent through an Oleafly key", () => {
  it("routes an agent through an Oleafly key when the switch is on", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalProviders: true }));
    storeAgentPreferences({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([{ id: "openrouter", label: "OpenRouter", apiType: "openai" }]);
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    const trigger = await screen.findByRole("combobox", { name: "Use my Oleafly API key" });
    expect(trigger).toHaveTextContent("Off (the agent signs in on its own)");
    await chooseOption(trigger, "OpenRouter");
    await waitFor(() => expect(acpSetAgentPreference).toHaveBeenCalledWith("claude", "provider", "openrouter"));
    await chooseOption(trigger, "Off (the agent signs in on its own)");
    await waitFor(() => expect(acpSetAgentPreference).toHaveBeenLastCalledWith("claude", "provider", null));
  });

  it("stays hidden while the experimental switch is off", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs());
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([]);
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    await waitFor(() => expect(acpProviderChoices).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("acp-agent-providers-claude")).toBeNull();
  });

  it("shows and hides the key picker on an open card as the Experimental switch changes", async () => {
    let global = prefs();
    vi.mocked(acpPreferences).mockImplementation(async () => global);
    vi.mocked(acpSetPreferences).mockImplementation(async (value) => {
      global = value;
      return value;
    });
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([{ id: "openrouter", label: "OpenRouter", apiType: "openai" }]);
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    await openExperimental();
    expect(screen.queryByTestId("acp-agent-providers-claude")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" }));
    expect(await screen.findByRole("combobox", { name: "Use my Oleafly API key" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Let agents use my Oleafly API keys" }));
    await waitFor(() => expect(screen.queryByTestId("acp-agent-providers-claude")).toBeNull());
  });

  it("asks for an API key when there is none to route through", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalProviders: true }));
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([]);
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    expect(
      await screen.findByText("Add an API key in Settings, AI Assistant, Providers and keys to use it here."),
    ).toBeInTheDocument();
  });

  it("reports a failure to save the key choice and shows the stored one", async () => {
    vi.mocked(acpPreferences).mockResolvedValue(prefs({ experimentalProviders: true }));
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: "openrouter" });
    vi.mocked(acpProviderChoices).mockResolvedValue([{ id: "openrouter", label: "OpenRouter", apiType: "openai" }, { id: "groq", label: "Groq", apiType: "openai" }]);
    vi.mocked(acpSetAgentPreference).mockRejectedValue(new Error("This agent cannot use Groq."));
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    const trigger = await screen.findByRole("combobox", { name: "Use my Oleafly API key" });
    await chooseOption(trigger, "Groq");
    expect(await screen.findByRole("alert")).toHaveTextContent("This agent cannot use Groq.");
    expect(trigger).toHaveTextContent("OpenRouter");
  });

  it("says why the key choices could not be read", async () => {
    vi.mocked(acpPreferences).mockRejectedValue(new Error("Agent settings are locked."));
    vi.mocked(acpAgentPreferences).mockResolvedValue({ effort: null, mode: null, provider: null });
    vi.mocked(acpProviderChoices).mockResolvedValue([]);
    render(<AcpAgentPreferenceSections agentId="claude" providers />);
    const section = await screen.findByTestId("acp-agent-providers-claude");
    expect(section).toHaveTextContent("Use my Oleafly API key");
    expect(screen.getByRole("alert")).toHaveTextContent("Agent settings are locked.");
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

  it("asks for a newer Hermes when it cannot report its gateway", async () => {
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes());
    vi.mocked(acpHermesStatus).mockResolvedValue(status({ gateway: "outdated" }));
    render(<HermesSection projectId="paper" />);
    expect(await screen.findByText("Update Hermes to see the gateway status")).toBeInTheDocument();
    expect(screen.queryByText("Gateway stopped")).toBeNull();
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

  it("goes back to the mode this project still uses when a mode change fails", async () => {
    vi.mocked(acpHermesSettings).mockResolvedValue(hermes());
    vi.mocked(acpHermesStatus).mockResolvedValue(status());
    vi.mocked(acpSetHermesSettings).mockRejectedValue(new Error("This project is not trusted for external agents."));
    render(<HermesSection projectId="paper" />);
    await screen.findByText("Gateway running");
    fireEvent.click(screen.getByRole("radio", { name: "Project profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This project is not trusted for external agents.");
    expect(screen.getByRole("radio", { name: "Default profile (shared)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Project profile" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("switch", { name: "Project memory" })).toBeNull();
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
    expect(remoteIssues({ ...ok, port: 2222.5 })).toEqual({ port: "invalid" });
    expect(remoteIssues({ ...ok, port: Number.NaN })).toEqual({ port: "invalid" });
    expect(remoteProblem({ ...ok, folder: "relative/path" })).toBe(true);
    expect(remoteProblem({ ...ok, folder: "/home/ada\npaper" })).toBe(true);
    expect(remoteProblem({ ...ok, command: "hermes; rm -rf /" })).toBe(true);
    expect(remoteProblem({ ...ok, profile: "Bad Profile" })).toBe(true);
  });
});

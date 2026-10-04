import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpInstall: vi.fn(),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));

import { acpCatalog, acpInstall, acpReadiness, type AcpAgentStatus, type AcpCliStatus } from "@/lib/acp";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { AssistantShellAcpActions } from "@/components/ai/AssistantShellAcpActions";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import { bridgeSourceLabel, readinessDetail } from "./agent-copy";
import { BridgeInstallCard, ReadinessBadge, openAgentSignInTerminal, signInCommandLine } from "./AgentReadiness";
import { agent } from "./tests/ui-fixtures";

const setup = enAi.acp.setup;
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), template);

const piCli: AcpCliStatus = {
  command: "pi", displayName: "Pi", path: null, version: null, signInCommand: "pi", source: null, rejected: [],
};

function pi(overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return agent("pi", {
    definition: { ...agent().definition, id: "pi", name: "Pi", builtin: true },
    installed: true, managed: true, cliRequired: true, cli: piCli,
    signInHint: "Run pi in your terminal and sign in with /login, then reconnect.",
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  useSettingsStore.setState({
    settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null, terminalOpen: false,
  });
  useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
  useAcpSessionsStore.setState({ catalog: [] });
  vi.mocked(acpCatalog).mockResolvedValue([]);
});
afterEach(() => cleanup());
afterAll(restore);

describe("agent readiness copy", () => {
  it("names the PowerShell script it skipped instead of blaming the search path", () => {
    const status = pi({
      cli: { ...piCli, rejected: [{ path: "C:\\Users\\Ada\\AppData\\Roaming\\npm\\pi.ps1", reason: "unsupported_script" }] },
    });
    expect(acpReadiness(status)).toBe("cli-missing");
    expect(readinessDetail(status)).toBe(fill(setup.rejected.powershellScript, { file: "pi.ps1", name: "pi" }));
    expect(readinessDetail(status)).toBe(
      "Found pi.ps1, but PowerShell scripts can't be started. Choose pi.cmd or pi.exe.",
    );
  });

  it("gives a reason-specific line for other skipped files and a plain line when nothing was found", () => {
    expect(readinessDetail(pi({ cli: { ...piCli, rejected: [{ path: "/opt/tools/pi", reason: "is_directory" }] } })))
      .toBe(fill(setup.rejected.isDirectory, { file: "pi", name: "pi" }));
    expect(readinessDetail(pi({ cli: { ...piCli, rejected: [{ path: "\\\\server\\tools\\pi.exe", reason: "network_path" }] } })))
      .toBe(fill(setup.rejected.networkPath, { file: "pi.exe" }));
    expect(readinessDetail(pi({ cli: { ...piCli, rejected: [{ path: "D:\\bin\\pi.js", reason: "unsupported_script" }] } })))
      .toBe(fill(setup.rejected.script, { file: "pi.js", name: "pi" }));
    expect(readinessDetail(pi())).toBe("Oleafly couldn't find Pi on this computer.");
  });

  it("never says PATH in any readiness line or bridge source", () => {
    const found = { ...piCli, path: "/usr/local/bin/pi", version: "0.81.2" };
    const states: AcpAgentStatus[] = [
      pi(),
      pi({ managed: false }),
      pi({ cli: found, managed: false }),
      pi({ cli: found, managed: false, programOverride: "/usr/local/bin/pi" }),
      pi({ cli: found, installed: false, managed: false }),
      pi({ cli: null, cliRequired: false, installed: false, canInstall: false, reason: null }),
    ];
    for (const status of states) {
      expect(readinessDetail(status)).not.toMatch(/PATH/);
      expect(bridgeSourceLabel(status)).not.toMatch(/PATH/);
    }
    expect(readinessDetail(pi({ cli: found, managed: false }))).toBe(setup.foundOnComputer);
    expect(readinessDetail(pi({ cli: found, managed: false, programOverride: "/usr/local/bin/pi" }))).toBe(setup.usingChosen);
    expect(bridgeSourceLabel(pi({ cli: found, managed: false }))).toBe(setup.bridgeSourceFound);
  });
});

describe("assistant readiness card", () => {
  it("offers only Install when the bridge can be installed", async () => {
    const claude = agent("claude", {
      definition: { ...agent().definition, id: "claude", name: "Claude Code", builtin: true },
      installed: false, executable: null, canInstall: true,
      cli: { command: "claude", displayName: "Claude Code", path: "/usr/local/bin/claude", version: "2.1.258", signInCommand: "claude auth login" },
    });
    vi.mocked(acpInstall).mockResolvedValue(claude);
    const onInstalled = vi.fn();
    const ui = render(<BridgeInstallCard agent={claude} onInstalled={onInstalled} />);
    const card = ui.getByTestId("acp-bridge-card-claude");
    expect(card.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.installBridge }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(1));
    expect(acpInstall).toHaveBeenCalledExactlyOnceWith("claude");
    expect(ui.queryByRole("button", { name: /Set up/ })).not.toBeInTheDocument();
  });

  it.each([
    ["a missing CLI", pi()],
    ["a bridge that cannot be installed", pi({ installed: false, canInstall: false, cli: { ...piCli, path: "/usr/local/bin/pi" } })],
    ["an unavailable agent", pi({ installed: false, canInstall: false, cli: null, cliRequired: false, reason: "Not supported here." })],
  ])("offers one Set up action for %s and opens that agent's card", (_label, status) => {
    const ui = render(<BridgeInstallCard agent={status} />);
    const card = ui.getByTestId("acp-bridge-card-pi");
    expect(card.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(ui.getByRole("button", { name: fill(setup.setUp, { name: "Pi" }) }));
    const settings = useSettingsStore.getState();
    expect(settings.settingsOpen).toBe(true);
    expect(settings.settingsInitialSection).toBe("ai");
    expect(settings.settingsScrollTarget).toBe("ai-agents:pi");
    expect(acpInstall).not.toHaveBeenCalled();
  });

  it("does not repeat the sign-in hint before the CLI is set up", () => {
    const ui = render(<BridgeInstallCard agent={pi()} />);
    expect(ui.getByTestId("acp-bridge-card-pi")).not.toHaveTextContent("sign in with /login");
  });

  it("opens the general agent setup from the gear button", () => {
    const ui = render(<AssistantShellAcpActions />);
    fireEvent.click(ui.getByRole("button", { name: enAi.acp.agentSetup }));
    const settings = useSettingsStore.getState();
    expect(settings.settingsOpen).toBe(true);
    expect(settings.settingsScrollTarget).toBe("ai-agents");
  });
});

describe("terminal sign-in", () => {
  it("quotes the CLI path for the platform shell", () => {
    expect(signInCommandLine("/Users/ada/.local/bin/pi", false)).toBe("'/Users/ada/.local/bin/pi'");
    expect(signInCommandLine("/Users/o'brien/bin/pi", false)).toBe("'/Users/o'\\''brien/bin/pi'");
    expect(signInCommandLine("C:\\Program Files\\nodejs\\pi.cmd", true)).toBe("& 'C:\\Program Files\\nodejs\\pi.cmd'");
    expect(signInCommandLine("D:\\O'Brien\\pi.exe", true)).toBe("& 'D:\\O''Brien\\pi.exe'");
  });

  it("opens a project terminal that runs the CLI and shows the dock", () => {
    expect(openAgentSignInTerminal("paper", "/usr/local/bin/pi")).toBe(true);
    const terminals = useTerminalsStore.getState();
    expect(terminals.projectId).toBe("paper");
    const tab = terminals.tabs.find((value) => value.id === terminals.activeId);
    expect(tab?.initialInput).toMatch(/pi'\r$/);
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
  });
});

describe("readiness states on the card", () => {
  it("shows a ready badge", () => {
    const ui = render(<ReadinessBadge readiness="ready" />);

    expect(ui.container).toHaveTextContent(enCore.acp.readiness.ready);
  });

  it("reports a failed bridge install and lets the user try again", async () => {
    const claude = agent("claude", {
      definition: { ...agent().definition, id: "claude", name: "Claude Code", builtin: true },
      installed: false, executable: null, canInstall: true,
    });
    vi.mocked(acpInstall).mockRejectedValue(new Error("npm could not reach the registry."));
    const onError = vi.fn();
    const onInstalled = vi.fn();
    const ui = render(<BridgeInstallCard agent={claude} onError={onError} onInstalled={onInstalled} />);

    fireEvent.click(ui.getByRole("button", { name: enAi.acp.installBridge }));

    await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith("npm could not reach the registry."));
    expect(onInstalled).not.toHaveBeenCalled();
    expect(ui.getByRole("button", { name: enAi.acp.installBridge })).toBeEnabled();
  });
});


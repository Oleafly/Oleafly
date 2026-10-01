import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCheckAgent: vi.fn(), acpPickAgentProgram: vi.fn(), acpSetAgentProgram: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  acpCheckAgent, acpPickAgentProgram, acpSetAgentProgram,
  type AcpAgentCheck, type AcpAgentStatus, type AcpCheckCode, type AcpCliStatus,
} from "@/lib/acp";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { agent, deferred } from "@/components/ai/acp/tests/ui-fixtures";
import { AgentProgramField, programPlacement } from "./AgentProgramField";

const copy = enSettings.ai.agents.program;
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

function check(code: AcpCheckCode, overrides: Partial<AcpAgentCheck> = {}): AcpAgentCheck {
  return { ok: code === "ready", code, detail: null, program: null, version: null, agentName: null, ...overrides };
}

const PICKED = "D:\\Tools\\Agents\\Pi\\pi.exe";

function fillInput(input: HTMLElement, value: string) {
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
}

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => cleanup());
afterAll(restore);

describe("program placement", () => {
  it("puts the row on the card for Pi, native and custom agents and in the bridge details for bridged vendor CLIs", () => {
    const claudeCli = { ...piCli, command: "claude", displayName: "Claude Code" };
    expect(programPlacement(pi())).toBe("main");
    expect(programPlacement(agent("opencode", {
      definition: { ...agent().definition, id: "opencode", builtin: true },
      bridgeSharedWithCli: true, cli: { ...piCli, command: "opencode" },
    }))).toBe("main");
    expect(programPlacement(agent())).toBe("main");
    expect(programPlacement(agent("claude", {
      definition: { ...agent().definition, id: "claude", builtin: true }, cli: claudeCli,
    }))).toBe("bridge");
    expect(programPlacement(agent("bare", { definition: { ...agent().definition, id: "bare", builtin: true } }))).toBeNull();
  });
});

describe("program row", () => {
  it("shows where the program came from with Choose and Test, and the typed field only when nothing was found", () => {
    const found = render(
      <AgentProgramField agent={pi({ cli: { ...piCli, path: "/usr/local/bin/pi", source: "auto" } })} placement="main" onStatus={vi.fn()} />,
    );
    const row = found.getByTestId("acp-agent-program-pi");
    expect(row).toHaveTextContent("/usr/local/bin/pi");
    // Settings keeps program paths blurred until hovered or focused.
    expect(within(row).getByText("/usr/local/bin/pi")).toHaveAttribute("data-settings-path");
    expect(row).toHaveTextContent(copy.source.auto);
    expect(within(row).getByRole("button", { name: copy.choose })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: copy.test })).toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: copy.useAutomatic })).not.toBeInTheDocument();
    found.unmount();

    const missing = render(<AgentProgramField agent={pi()} placement="main" onStatus={vi.fn()} />);
    const input = missing.getByRole("textbox", { name: fill(copy.inputLabel, { name: "Pi" }) });
    expect(input.className).not.toMatch(/(^|\s)(ring|outline)-/);
    expect(input.className).toContain("focus-visible:border-ring");
  });

  it("tests a chosen file before saving it and reports success with the sign-in hint", async () => {
    const saved = pi({ programOverride: PICKED, cli: { ...piCli, path: PICKED, source: "override", version: "0.81.2" } });
    vi.mocked(acpPickAgentProgram).mockResolvedValue(PICKED);
    const checking = deferred<AcpAgentCheck>();
    vi.mocked(acpCheckAgent).mockReturnValue(checking.promise);
    vi.mocked(acpSetAgentProgram).mockResolvedValue(saved);
    const onStatus = vi.fn();
    const ui = render(<AgentProgramField agent={pi()} placement="main" onStatus={onStatus} />);

    fireEvent.click(ui.getByRole("button", { name: copy.choose }));
    await waitFor(() => expect(acpCheckAgent).toHaveBeenCalledExactlyOnceWith("pi", PICKED));
    expect(acpSetAgentProgram).not.toHaveBeenCalled();
    expect(ui.getByRole("button", { name: copy.testing })).toBeDisabled();

    await act(async () => checking.resolve(check("ready", { program: PICKED, version: "0.81.2" })));

    const status = await ui.findByRole("status");
    expect(status).toHaveTextContent("Pi 0.81.2 started and answered.");
    expect(acpSetAgentProgram).toHaveBeenCalledExactlyOnceWith("pi", PICKED);
    expect(onStatus).toHaveBeenCalledWith(saved);
    expect(ui.getByTestId("acp-agent-program-pi")).toHaveTextContent("sign in with /login");
  });

  it("keeps a failing file unsaved, offers one next action and saves it only on Use anyway", async () => {
    vi.mocked(acpPickAgentProgram).mockResolvedValue(PICKED);
    vi.mocked(acpCheckAgent).mockResolvedValue(check("timeout", { program: PICKED, detail: "No reply within 20 s." }));
    vi.mocked(acpSetAgentProgram).mockResolvedValue(pi({ programOverride: PICKED }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const onOpenTerminal = vi.fn();
    const onStatus = vi.fn();
    const ui = render(<AgentProgramField agent={pi()} placement="main" onStatus={onStatus} onOpenTerminal={onOpenTerminal} />);

    fireEvent.click(ui.getByRole("button", { name: copy.choose }));

    expect(await ui.findByRole("alert")).toHaveTextContent("Pi started but didn't answer in time.");
    expect(acpSetAgentProgram).not.toHaveBeenCalled();
    const result = ui.getByTestId("acp-agent-program-result-pi");
    expect(result).toHaveTextContent("No reply within 20 s.");
    fireEvent.click(within(result).getByRole("button", { name: copy.copyDetails }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain(PICKED);
    expect(writeText.mock.calls[0][0]).toContain("No reply within 20 s.");
    fireEvent.click(within(result).getByRole("button", { name: enSettings.ai.agents.openTerminal }));
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);

    fireEvent.click(within(result).getByRole("button", { name: copy.useAnyway }));
    await waitFor(() => expect(acpSetAgentProgram).toHaveBeenCalledExactlyOnceWith("pi", PICKED));
    expect(await ui.findByRole("status")).toHaveTextContent(copy.saved);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not_found", "No file at D:\\Tools\\Agents\\Pi\\pi.exe.", copy.choose],
    ["is_directory", "D:\\Tools\\Agents\\Pi\\pi.exe is a folder. Choose the program file inside it.", copy.choose],
    ["gui_program", "D:\\Tools\\Agents\\Pi\\pi.exe is a desktop app. Choose the command line program.", copy.choose],
    ["cli_missing", "Oleafly couldn't run Pi. Choose the Pi program.", copy.choose],
    ["node_too_old", "Pi needs a newer version of Node.js.", copy.getNode],
    ["bridge_missing", "The bridge for Pi isn't installed yet.", enSettings.ai.agents.installBridge],
    ["not_acp", "Pi started, but Oleafly couldn't understand its reply.", copy.copyDetails],
  ] as const)("maps %s to its message and next action", async (code, message, action) => {
    vi.mocked(acpPickAgentProgram).mockResolvedValue(PICKED);
    vi.mocked(acpCheckAgent).mockResolvedValue(check(code, { program: PICKED }));
    const ui = render(
      <AgentProgramField agent={pi()} placement="main" onStatus={vi.fn()} onInstallBridge={vi.fn()} onOpenTerminal={vi.fn()} />,
    );
    fireEvent.click(ui.getByRole("button", { name: copy.choose }));
    expect(await ui.findByRole("alert")).toHaveTextContent(message);
    const result = ui.getByTestId("acp-agent-program-result-pi");
    expect(within(result).getByRole("button", { name: action })).toBeInTheDocument();
    const inspected = ["not_found", "is_directory", "gui_program"].includes(code);
    expect(within(result).queryByRole("button", { name: copy.useAnyway }) !== null).toBe(!inspected);
  });

  it("names PowerShell scripts and opens the Node.js download page", async () => {
    vi.mocked(acpPickAgentProgram).mockResolvedValue("C:\\npm\\pi.ps1");
    vi.mocked(acpCheckAgent)
      .mockResolvedValueOnce(check("unsupported_script", { program: "C:\\npm\\pi.ps1" }))
      .mockResolvedValueOnce(check("node_missing"));
    const ui = render(<AgentProgramField agent={pi()} placement="main" onStatus={vi.fn()} />);
    fireEvent.click(ui.getByRole("button", { name: copy.choose }));
    expect(await ui.findByRole("alert")).toHaveTextContent(
      "PowerShell scripts can't be started. Choose pi.cmd or pi.exe.",
    );
    fireEvent.click(ui.getByRole("button", { name: copy.test }));
    expect(await ui.findByText("Pi needs Node.js, and Oleafly couldn't find it.")).toBeInTheDocument();
    fireEvent.click(ui.getByRole("button", { name: copy.getNode }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith("https://nodejs.org/en/download");
  });

  it("tests a typed location on Enter, without quotes, and Test checks the current program otherwise", async () => {
    vi.mocked(acpCheckAgent).mockResolvedValue(check("not_found", { program: "/opt/pi/bin/pi" }));
    const ui = render(<AgentProgramField agent={pi()} placement="main" onStatus={vi.fn()} />);
    const input = ui.getByRole("textbox", { name: fill(copy.inputLabel, { name: "Pi" }) });
    fillInput(input, '  "/opt/pi/bin/pi"  ');
    expect(input).toHaveAttribute("data-settings-path-field");
    const form = input.closest("form");
    if (!form) throw new Error("The typed location is not in a form.");
    fireEvent.submit(form);
    await waitFor(() => expect(acpCheckAgent).toHaveBeenCalledExactlyOnceWith("pi", "/opt/pi/bin/pi"));
    const alert = await ui.findByRole("alert");
    expect(alert).toHaveTextContent("No file at /opt/pi/bin/pi.");
    expect(within(alert).getByText("/opt/pi/bin/pi")).toHaveAttribute("data-settings-path");
    expect(input).toHaveValue('  "/opt/pi/bin/pi"  ');

    fillInput(input, "");
    expect(input).not.toHaveAttribute("data-settings-path-field");
    fireEvent.click(ui.getByRole("button", { name: copy.test }));
    await waitFor(() => expect(acpCheckAgent).toHaveBeenLastCalledWith("pi", null));
  });

  it("tests the current program without saving anything", async () => {
    vi.mocked(acpCheckAgent).mockResolvedValue(check("ready", { version: "0.81.2" }));
    const ui = render(
      <AgentProgramField agent={pi({ cli: { ...piCli, path: "/usr/local/bin/pi" } })} placement="main" onStatus={vi.fn()} />,
    );
    fireEvent.click(ui.getByRole("button", { name: copy.test }));
    expect(await ui.findByRole("status")).toHaveTextContent("Pi 0.81.2 started and answered.");
    expect(acpCheckAgent).toHaveBeenCalledExactlyOnceWith("pi", null);
    expect(acpSetAgentProgram).not.toHaveBeenCalled();
  });

  it("goes back to automatic detection and explains a refused save by its code", async () => {
    const chosen = pi({ programOverride: PICKED, cli: { ...piCli, path: PICKED, source: "override" } });
    const automatic = pi({ cli: { ...piCli, path: "/usr/local/bin/pi", source: "auto" } });
    vi.mocked(acpSetAgentProgram).mockResolvedValueOnce(automatic);
    const onStatus = vi.fn();
    const ui = render(<AgentProgramField agent={chosen} placement="main" onStatus={onStatus} />);
    expect(ui.getByTestId("acp-agent-program-pi")).toHaveTextContent(copy.source.override);
    fireEvent.click(ui.getByRole("button", { name: copy.useAutomatic }));
    await waitFor(() => expect(acpSetAgentProgram).toHaveBeenCalledExactlyOnceWith("pi", null));
    expect(onStatus).toHaveBeenCalledWith(automatic);

    vi.mocked(acpPickAgentProgram).mockResolvedValue("\\\\server\\share\\pi.exe");
    vi.mocked(acpCheckAgent).mockResolvedValue(check("ready"));
    vi.mocked(acpSetAgentProgram).mockRejectedValueOnce(
      '@oleafly/error:{"code":"acp.program.network_path","params":{},"detail":null}',
    );
    fireEvent.click(ui.getByRole("button", { name: copy.choose }));
    expect(await ui.findByRole("alert")).toHaveTextContent(
      "\\\\server\\share\\pi.exe is on a network location. Choose a program on this computer.",
    );
    expect(
      within(ui.getByTestId("acp-agent-program-result-pi")).getByRole("button", { name: copy.choose }),
    ).toBeInTheDocument();
  });

  it("does nothing when the file dialog is cancelled", async () => {
    vi.mocked(acpPickAgentProgram).mockResolvedValue(null);
    const ui = render(<AgentProgramField agent={pi()} placement="main" onStatus={vi.fn()} />);
    fireEvent.click(ui.getByRole("button", { name: copy.choose }));
    await waitFor(() => expect(acpPickAgentProgram).toHaveBeenCalledExactlyOnceWith("pi"));
    expect(acpCheckAgent).not.toHaveBeenCalled();
    expect(ui.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tests again after the bridge is installed", async () => {
    vi.mocked(acpPickAgentProgram).mockResolvedValue(PICKED);
    vi.mocked(acpCheckAgent)
      .mockResolvedValueOnce(check("bridge_missing", { program: PICKED }))
      .mockResolvedValueOnce(check("ready", { program: PICKED, version: "0.81.2" }));
    vi.mocked(acpSetAgentProgram).mockResolvedValue(pi({ programOverride: PICKED }));
    const onInstallBridge = vi.fn();
    const ui = render(<AgentProgramField agent={pi()} placement="main" onStatus={vi.fn()} onInstallBridge={onInstallBridge} />);
    fireEvent.click(ui.getByRole("button", { name: copy.choose }));
    fireEvent.click(await ui.findByRole("button", { name: enSettings.ai.agents.installBridge }));
    expect(onInstallBridge).toHaveBeenCalledTimes(1);

    ui.rerender(<AgentProgramField agent={pi()} placement="main" onStatus={vi.fn()} onInstallBridge={onInstallBridge} retestToken={1} />);

    expect(await ui.findByRole("status")).toHaveTextContent("Pi 0.81.2 started and answered.");
    expect(acpCheckAgent).toHaveBeenLastCalledWith("pi", PICKED);
    expect(acpSetAgentProgram).toHaveBeenCalledExactlyOnceWith("pi", PICKED);
  });

  it("lists the files Oleafly skipped in a collapsed section", () => {
    const ui = render(
      <AgentProgramField
        agent={pi({ cli: { ...piCli, rejected: [{ path: "C:\\npm\\pi.ps1", reason: "unsupported_script" }, { path: "C:\\npm\\pi", reason: "not_executable" }] } })}
        placement="main"
        onStatus={vi.fn()}
      />,
    );
    const toggle = ui.getByRole("button", { name: copy.skippedTitle });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const list = ui.getByRole("list", { name: copy.skippedTitle });
    expect(list).toHaveTextContent("C:\\npm\\pi.ps1");
    expect(list).toHaveTextContent(copy.skippedReason.unsupportedScript);
    expect(list).toHaveTextContent(copy.skippedReason.notExecutable);
  });

  it("describes the bridge's own copy for bridged vendor CLIs and never shows a typed field there", () => {
    const claude = agent("claude", {
      definition: { ...agent().definition, id: "claude", name: "Claude Code", builtin: true },
      cli: { ...piCli, command: "claude", displayName: "Claude Code", path: "/usr/local/bin/claude" },
    });
    const ui = render(<AgentProgramField agent={claude} placement="bridge" onStatus={vi.fn()} />);
    const row = ui.getByTestId("acp-agent-program-claude");
    expect(row).toHaveTextContent(fill(copy.bridgeLabel, { cli: "Claude Code" }));
    expect(row).toHaveTextContent(copy.bridgeDefault);
    expect(row).not.toHaveTextContent("/usr/local/bin/claude");
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reports an unexpected failure as an alert with the error text", async () => {
    vi.mocked(acpCheckAgent).mockRejectedValue(new Error("The check could not start."));
    const ui = render(<AgentProgramField agent={pi({ cli: { ...piCli, path: "/usr/local/bin/pi" } })} placement="main" onStatus={vi.fn()} />);
    fireEvent.click(ui.getByRole("button", { name: copy.test }));
    expect(await ui.findByRole("alert")).toHaveTextContent("The check could not start.");
  });
});

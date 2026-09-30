import { describe, expect, it } from "vitest";
import { acpReadiness, acpReadinessLabel, acpUsable, type AcpAgentStatus } from "./acp";

function status(overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return {
    definition: { id: "claude", name: "Claude Code", version: "0.74.0", description: "", builtin: true, distribution: {} },
    platform: "darwin-aarch64", installed: false, executable: null, installedVersion: null,
    managed: false, canInstall: true, reason: null, signInHint: null, taskUnavailableReason: null,
    cli: null, bridgeSharedWithCli: false,
    ...overrides,
  };
}

const cli = { command: "claude", displayName: "Claude Code", path: "/home/researcher/.local/bin/claude", version: "2.1.258", signInCommand: "claude auth login" };

describe("ACP readiness", () => {
  it("reports a resolvable bridge as ready", () => {
    expect(acpReadiness(status({ installed: true }))).toBe("ready");
    expect(acpReadinessLabel("ready")).toBe("Ready");
  });

  it("separates a present vendor CLI from a missing bridge", () => {
    expect(acpReadiness(status({ cli }))).toBe("bridge-missing");
    expect(acpReadinessLabel("bridge-missing")).toBe("Bridge needed");
  });

  it("reports a missing vendor CLI even when the bridge could be installed", () => {
    expect(acpReadiness(status({ cli: { ...cli, path: null, version: null } }))).toBe("cli-missing");
    expect(acpReadinessLabel("cli-missing")).toBe("CLI not found");
  });

  it("falls back to unavailable when nothing can be installed", () => {
    expect(acpReadiness(status({ canInstall: false }))).toBe("unavailable");
    expect(acpReadinessLabel("unavailable")).toBe("Unavailable");
  });

  it("reports a missing CLI for an agent whose bridge cannot work without it, even with the bridge installed", () => {
    const piCli = { command: "pi", displayName: "Pi", path: null, version: null, signInCommand: "pi" };
    const pi = status({
      definition: { id: "pi", name: "Pi", version: "0.0.34", description: "", builtin: true, distribution: {} },
      installed: true, managed: true, cliRequired: true, cli: piCli,
    });
    expect(acpReadiness(pi)).toBe("cli-missing");
    expect(acpUsable(pi)).toBe(false);
    expect(acpReadiness({ ...pi, cli: null })).toBe("cli-missing");
    expect(acpUsable({ ...pi, cli: { ...piCli, path: "/usr/local/bin/pi" } })).toBe(true);
  });

  it("treats only a ready agent as usable", () => {
    expect(acpUsable(status({ installed: true }))).toBe(true);
    expect(acpUsable(status({ installed: true, cli }))).toBe(true);
    expect(acpUsable(status({ cli }))).toBe(false);
    expect(acpUsable(status({ canInstall: false }))).toBe(false);
  });
});

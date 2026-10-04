import { beforeAll, describe, expect, it } from "vitest";
import type { AcpAgentStatus, AcpCliStatus } from "@/lib/acp";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import { agent, initTestI18n } from "./tests/ui-fixtures";
import { cliLabel, cliMissingDetail, fileName, readinessDetail } from "./agent-copy";

beforeAll(async () => {
  await initTestI18n();
});

const setup = enAi.acp.setup;

function fill(template: string, values: Record<string, string>): string {
  return template.replaceAll(/\{\{(\w+)\}\}/gu, (_match, key: string) => values[key] ?? "");
}

function cli(overrides: Partial<AcpCliStatus> = {}): AcpCliStatus {
  return { command: "gem", displayName: "Gem CLI", path: null, version: null, signInCommand: "gem", ...overrides };
}

function status(overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return agent("gem", overrides);
}

describe("cliLabel", () => {
  it("names the agent, the CLI, or the CLI with its version", () => {
    expect(cliLabel(status())).toBe("Research CLI");
    expect(cliLabel(status({ cli: cli() }))).toBe("Gem CLI");
    expect(cliLabel(status({ cli: cli({ version: "2.1.0" }) }))).toBe("Gem CLI 2.1.0");
  });
});

describe("fileName", () => {
  it("takes the last segment of POSIX and Windows paths and keeps a bare separator", () => {
    expect(fileName("/usr/local/bin/gem")).toBe("gem");
    expect(fileName("C:\\Tools\\gem.exe")).toBe("gem.exe");
    expect(fileName("/opt/gem/")).toBe("gem");
    expect(fileName("/")).toBe("/");
  });
});

describe("cliMissingDetail", () => {
  it.each([
    ["not_executable", "/usr/bin/gem", fill(setup.rejected.notExecutable, { file: "gem" })],
    ["gui_program", "C:\\Apps\\Gem.exe", fill(setup.rejected.guiProgram, { file: "Gem.exe", name: "gem" })],
    ["unsupported_script", "/home/a/gem.sh", fill(setup.rejected.script, { file: "gem.sh", name: "gem" })],
  ] as const)("explains a %s candidate", (reason, path, text) => {
    expect(cliMissingDetail(cli({ rejected: [{ path, reason }] }))).toBe(text);
  });

  it("puts a script ahead of other rejected files and skips reasons it cannot explain", () => {
    const detail = cliMissingDetail(
      cli({
        rejected: [
          { path: "/opt/gem", reason: "is_directory" },
          { path: "/opt/bin/gem.ps1", reason: "unsupported_script" },
        ],
      }),
    );
    expect(detail).toBe(fill(setup.rejected.powershellScript, { file: "gem.ps1", name: "gem" }));

    expect(cliMissingDetail(cli({ rejected: [{ path: "/x/gem", reason: "mystery" as never }] }))).toBe(
      fill(setup.cliNotFound, { cli: "Gem CLI" }),
    );
  });
});

describe("readinessDetail", () => {
  it("names the bundled bridge version, falling back to the catalog version", () => {
    expect(readinessDetail(status({ managed: true, installedVersion: "0.9.0" }))).toBe(
      fill(enAi.acp.readiness.managedBridge, { version: "0.9.0" }),
    );
    expect(readinessDetail(status({ managed: true }))).toBe(
      fill(enAi.acp.readiness.managedBridge, { version: "1.2.3" }),
    );
  });

  it("says when the user chose the program", () => {
    expect(readinessDetail(status({ programOverride: "/custom/gem" }))).toBe(setup.usingChosen);
  });

  it("describes a missing bridge with and without a found CLI", () => {
    expect(readinessDetail(status({ installed: false }), "bridge-missing")).toBe(
      fill(enAi.acp.readiness.bridgeMissing, { version: "1.2.3" }),
    );
    expect(
      readinessDetail(status({ installed: false, cli: cli({ path: "/usr/bin/gem", version: "3.0" }) }), "bridge-missing"),
    ).toBe(fill(enAi.acp.readiness.bridgeMissingWithCli, { cli: "Gem CLI 3.0", path: "/usr/bin/gem", version: "1.2.3" }));
  });

  it("falls back when no CLI is described and when the agent gives no reason", () => {
    expect(readinessDetail(status(), "cli-missing")).toBe(enAi.acp.readiness.cliNotFound);
    expect(readinessDetail(status({ installed: false, canInstall: false }))).toBe(enAi.acp.readiness.unavailable);
    expect(readinessDetail(status({ installed: false, canInstall: false, reason: "Needs macOS 14." }))).toBe("Needs macOS 14.");
  });
});

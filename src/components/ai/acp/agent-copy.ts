import { i18n } from "@/i18n";
import { acpReadiness, type AcpAgentStatus, type AcpCliStatus, type AcpReadiness, type AcpRejectedCandidate } from "@/lib/acp";

export function cliLabel(agent: AcpAgentStatus): string {
  const cli = agent.cli;
  if (!cli) return agent.definition.name;
  return cli.version ? `${cli.displayName} ${cli.version}` : cli.displayName;
}

/** The last segment of a Windows or POSIX path. */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  for (let index = parts.length - 1; index >= 0; index--) {
    if (parts[index]) return parts[index];
  }
  return path;
}

export function isPowerShellScript(path: string): boolean {
  return /\.ps1$/i.test(path);
}

function rejectedLine(candidate: AcpRejectedCandidate, name: string): string | null {
  const file = fileName(candidate.path);
  switch (candidate.reason) {
    case "unsupported_script":
      return isPowerShellScript(candidate.path)
        ? i18n.t(($) => $.ai.acp.setup.rejected.powershellScript, { file, name })
        : i18n.t(($) => $.ai.acp.setup.rejected.script, { file, name });
    case "is_directory":
      return i18n.t(($) => $.ai.acp.setup.rejected.isDirectory, { file, name });
    case "not_executable":
      return i18n.t(($) => $.ai.acp.setup.rejected.notExecutable, { file });
    case "gui_program":
      return i18n.t(($) => $.ai.acp.setup.rejected.guiProgram, { file, name });
    case "network_path":
      return i18n.t(($) => $.ai.acp.setup.rejected.networkPath, { file });
    default:
      return null;
  }
}

/** Why a CLI that was searched for is missing: a skipped file when there is one, else "not found". */
export function cliMissingDetail(cli: AcpCliStatus): string {
  const rejected = cli.rejected ?? [];
  const ordered = [
    ...rejected.filter((candidate) => candidate.reason === "unsupported_script"),
    ...rejected.filter((candidate) => candidate.reason !== "unsupported_script"),
  ];
  for (const candidate of ordered) {
    const line = rejectedLine(candidate, cli.command);
    if (line) return line;
  }
  return i18n.t(($) => $.ai.acp.setup.cliNotFound, { cli: cli.displayName });
}

export function readinessDetail(
  agent: AcpAgentStatus,
  readiness: AcpReadiness = acpReadiness(agent),
): string {
  const cli = agent.cli;
  switch (readiness) {
    case "ready":
      if (agent.managed) {
        return i18n.t(($) => $.ai.acp.readiness.managedBridge, {
          version: agent.installedVersion ?? agent.definition.version,
        });
      }
      return agent.programOverride
        ? i18n.t(($) => $.ai.acp.setup.usingChosen)
        : i18n.t(($) => $.ai.acp.setup.foundOnComputer);
    case "bridge-missing":
      return cli?.path
        ? i18n.t(($) => $.ai.acp.readiness.bridgeMissingWithCli, {
            cli: cliLabel(agent),
            path: cli.path,
            version: agent.definition.version,
          })
        : i18n.t(($) => $.ai.acp.readiness.bridgeMissing, {
            version: agent.definition.version,
          });
    case "cli-missing":
      return cli ? cliMissingDetail(cli) : i18n.t(($) => $.ai.acp.readiness.cliNotFound);
    default:
      return agent.reason ?? i18n.t(($) => $.ai.acp.readiness.unavailable);
  }
}

export function bridgeSourceLabel(agent: AcpAgentStatus): string {
  if (!agent.installed) return i18n.t(($) => $.ai.acp.bridgeSource.notInstalled);
  return agent.managed
    ? i18n.t(($) => $.ai.acp.bridgeSource.managed)
    : i18n.t(($) => $.ai.acp.setup.bridgeSourceFound);
}

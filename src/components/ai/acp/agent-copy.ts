import { i18n } from "@/i18n";
import { acpReadiness, type AcpAgentStatus, type AcpReadiness } from "@/lib/acp";

export function cliLabel(agent: AcpAgentStatus): string {
  const cli = agent.cli;
  if (!cli) return agent.definition.name;
  return cli.version ? `${cli.displayName} ${cli.version}` : cli.displayName;
}

export function readinessDetail(
  agent: AcpAgentStatus,
  readiness: AcpReadiness = acpReadiness(agent),
): string {
  const cli = agent.cli;
  switch (readiness) {
    case "ready":
      return agent.managed
        ? i18n.t(($) => $.ai.acp.readiness.managedBridge, {
            version: agent.installedVersion ?? agent.definition.version,
          })
        : i18n.t(($) => $.ai.acp.readiness.bridgeOnPath);
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
      return cli
        ? i18n.t(($) => $.ai.acp.readiness.cliMissing, {
            cli: cli.displayName,
            command: cli.signInCommand,
          })
        : i18n.t(($) => $.ai.acp.readiness.cliNotFound);
    default:
      return agent.reason ?? i18n.t(($) => $.ai.acp.readiness.unavailable);
  }
}

export function bridgeSourceLabel(agent: AcpAgentStatus): string {
  if (!agent.installed) return i18n.t(($) => $.ai.acp.bridgeSource.notInstalled);
  return agent.managed
    ? i18n.t(($) => $.ai.acp.bridgeSource.managed)
    : i18n.t(($) => $.ai.acp.bridgeSource.onPath);
}

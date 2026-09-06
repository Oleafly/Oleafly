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
        ? `Bridge ${agent.installedVersion ?? agent.definition.version} installed by Oleafly.`
        : "Bridge found on PATH.";
    case "bridge-missing":
      return cli?.path
        ? `${cliLabel(agent)} found at ${cli.path}. Install the ACP bridge ${agent.definition.version} to connect.`
        : `Install the ACP bridge ${agent.definition.version} to connect this agent.`;
    case "cli-missing":
      return cli
        ? `${cli.displayName} is not on your PATH. Install it, then run ${cli.signInCommand}.`
        : "This agent's command line tool was not found.";
    default:
      return agent.reason ?? "This agent cannot run on this computer.";
  }
}

export function bridgeSourceLabel(agent: AcpAgentStatus): string {
  if (!agent.installed) return "Not installed";
  return agent.managed ? "Managed by Oleafly" : "On PATH";
}

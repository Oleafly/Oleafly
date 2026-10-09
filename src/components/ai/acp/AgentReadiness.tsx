import { useState } from "react";
import { Download, Settings2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openCliAgentSettings } from "@/components/ai/AssistantShellAcpActions";
import { acpError, acpInstall, acpReadiness, acpReadinessLabel, type AcpAgentStatus, type AcpReadiness } from "@/lib/acp";
import { isWindows } from "@/lib/utils";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import { useDisplayText } from "@/lib/display-path";
import { AgentLogo } from "./AgentLogo";
import { readinessDetail } from "./agent-copy";
import { Spinner } from "@/components/ui/spinner";
import { CheckBadge } from "@/components/ui/check-badge";

export function ReadinessBadge({ readiness }: Readonly<{ readiness: AcpReadiness }>) {
  const label = acpReadinessLabel(readiness);
  if (readiness === "ready") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckBadge className="size-3.5" /> {label}
      </Badge>
    );
  }
  if (readiness === "unavailable") {
    return (
      <Badge variant="destructive" className="gap-1">
        <TriangleAlert className="size-3 shrink-0" aria-hidden /> {label}
      </Badge>
    );
  }
  return (
    <Badge variant="warning">{label}</Badge>
  );
}

export function useBridgeInstall() {
  const [installing, setInstalling] = useState<string | null>(null);
  const install = async (agentId: string) => {
    setInstalling(agentId);
    try {
      await acpInstall(agentId);
      await useAcpSessionsStore.getState().refreshCatalog(true);
    } finally {
      setInstalling(null);
    }
  };
  return { installing, install };
}

/** A POSIX shell closes a single-quoted string, adds an escaped quote and reopens it. */
const POSIX_ESCAPED_QUOTE = String.raw`'\''`;

/**
 * The shell line that starts a CLI by its absolute path: PowerShell on Windows
 * (the in-app terminal's shell there), a POSIX shell elsewhere. The path is
 * single-quoted so spaces, `$`, `%` and backticks stay literal.
 */
export function signInCommandLine(path: string, windows: boolean = isWindows): string {
  if (windows) return `& '${path.replaceAll(/['‘’‚‛]/g, (quote) => quote + quote)}'`;
  return `'${path.replaceAll("'", POSIX_ESCAPED_QUOTE)}'`;
}

/**
 * Opens a project terminal that runs the agent's CLI, for agents that sign in
 * interactively. Returns false when no terminal could be added (the tab limit).
 */
export function openAgentSignInTerminal(projectId: string, cliPath: string): boolean {
  const terminals = useTerminalsStore.getState();
  terminals.setProject(projectId);
  const tab = useTerminalsStore.getState().addTerminal({ initialInput: `${signInCommandLine(cliPath)}\r` });
  if (!tab) return false;
  useSettingsStore.getState().setTerminalOpen(true);
  return true;
}

export function BridgeInstallCard({
  agent,
  onInstalled,
  onError,
}: Readonly<{
  agent: AcpAgentStatus;
  onInstalled?: () => void;
  onError?: (message: string) => void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  // readinessDetail shows the CLI path with ~; this re-renders the card once
  // the home folder is known, and shortens the hint below the same way.
  const displayText = useDisplayText();
  const { installing, install } = useBridgeInstall();
  const readiness = acpReadiness(agent);
  const busy = installing === agent.definition.id;
  const canInstall = readiness === "bridge-missing" && agent.canInstall;
  const hint = agent.canInstall ? agent.signInHint : agent.reason;
  return (
    <div
      data-testid={`acp-bridge-card-${agent.definition.id}`}
      className="space-y-2 rounded-lg border bg-card p-3"
    >
      <div className="flex items-start gap-2">
        <AgentLogo agentId={agent.definition.id} size={18} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium leading-snug">{agent.definition.name}</p>
          <p className="break-words text-xs leading-relaxed text-muted-foreground">
            {readinessDetail(agent, readiness)}
          </p>
        </div>
        <ReadinessBadge readiness={readiness} />
      </div>
      {canInstall ? (
        <Button
          type="button"
          size="sm"
          data-testid={`acp-install-bridge-${agent.definition.id}`}
          disabled={busy}
          onClick={() => {
            void install(agent.definition.id)
              .then(() => onInstalled?.())
              .catch((error: unknown) => onError?.(acpError(error)));
          }}
        >
          {busy ? <Spinner size="sm" /> : <Download className="size-3.5" />}
          {busy ? t(($) => $.ai.acp.installing) : t(($) => $.ai.acp.installBridge)}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          data-testid={`acp-set-up-${agent.definition.id}`}
          onClick={() => openCliAgentSettings(agent.definition.id)}
        >
          <Settings2 className="size-3.5" />
          {t(($) => $.ai.acp.setup.setUp, { name: agent.definition.name })}
        </Button>
      )}
      {readiness === "bridge-missing" && hint && (
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          {displayText(hint)}
        </p>
      )}
    </div>
  );
}

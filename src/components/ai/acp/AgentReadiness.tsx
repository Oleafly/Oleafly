import { useState } from "react";
import { Check, Download, Loader2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { acpError, acpInstall, acpReadiness, acpReadinessLabel, type AcpAgentStatus, type AcpReadiness } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { AgentLogo } from "./AgentLogo";
import { readinessDetail } from "./agent-copy";

export function ReadinessBadge({ readiness }: Readonly<{ readiness: AcpReadiness }>) {
  const label = acpReadinessLabel(readiness);
  if (readiness === "ready") {
    return (
      <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3 shrink-0" aria-hidden /> {label}
      </Badge>
    );
  }
  if (readiness === "unavailable") {
    return (
      <Badge className="gap-1 border-transparent bg-destructive/10 text-destructive">
        <TriangleAlert className="size-3 shrink-0" aria-hidden /> {label}
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-500">{label}</Badge>
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
  const { installing, install } = useBridgeInstall();
  const readiness = acpReadiness(agent);
  const busy = installing === agent.definition.id;
  return (
    <div
      data-testid={`acp-bridge-card-${agent.definition.id}`}
      className="space-y-2 rounded-lg border bg-card p-3"
    >
      <div className="flex items-start gap-2">
        <AgentLogo agentId={agent.definition.id} size={18} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium leading-snug">{agent.definition.name}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {readinessDetail(agent, readiness)}
          </p>
        </div>
        <ReadinessBadge readiness={readiness} />
      </div>
      {readiness === "bridge-missing" && agent.canInstall && (
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
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {busy ? t(($) => $.ai.acp.installing) : t(($) => $.ai.acp.installBridge)}
        </Button>
      )}
      {agent.signInHint && readiness !== "ready" && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{agent.signInHint}</p>
      )}
    </div>
  );
}

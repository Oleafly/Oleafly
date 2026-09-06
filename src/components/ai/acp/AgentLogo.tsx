import { Bot } from "lucide-react";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { acpLogoId } from "@/lib/acp";

export function AgentLogo({ agentId, size = 18 }: { agentId: string; size?: number }) {
  const providerId = acpLogoId(agentId);
  if (providerId) return <ProviderLogo providerId={providerId} size={size} />;
  return <Bot aria-hidden className="shrink-0 text-muted-foreground" style={{ width: size, height: size }} />;
}

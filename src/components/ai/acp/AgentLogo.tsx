import { Bot } from "@/components/icons/pack";
import { AGENT_MARKS } from "./agent-marks";

export function AgentLogo({
  agentId,
  size = 18,
  title,
}: Readonly<{
  agentId: string;
  size?: number;
  title?: string;
}>) {
  const Mark = AGENT_MARKS[agentId];
  if (Mark) return <Mark size={size} title={title} />;
  return <Bot aria-hidden className="shrink-0 text-muted-foreground" style={{ width: size, height: size }} />;
}

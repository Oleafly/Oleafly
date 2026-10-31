import { AcpAgentChoices } from "./AcpAgentChoices";
import { AcpProvidersSection } from "./AcpProvidersSection";
import { useAgentPreferences } from "./agent-preferences";

export function AcpAgentPreferenceSections({ agentId, providers }: Readonly<{ agentId: string; providers: boolean }>) {
  const preferences = useAgentPreferences(agentId);
  return (
    <>
      <AcpAgentChoices agentId={agentId} preferences={preferences} />
      {providers && <AcpProvidersSection agentId={agentId} preferences={preferences} />}
    </>
  );
}

export default AcpAgentPreferenceSections;

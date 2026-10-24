import { AcpAgentChoices } from "./AcpAgentChoices";
import { AcpProvidersSection } from "./AcpProvidersSection";
import { useAgentPreferences } from "./agent-preferences";

/**
 * The remembered choices and the key routing of one agent card. Both read
 * and save the same record, so a change in one shows in the other.
 */
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

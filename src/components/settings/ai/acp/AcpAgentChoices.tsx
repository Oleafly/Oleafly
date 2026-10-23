import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { acpAgentPreferences, acpError, acpSetAgentPreferences, type AcpAgentPreferences } from "@/lib/acp";

/** The effort and mode an agent's new conversations start with, with "Forget". */
export function AcpAgentChoices({ agentId }: Readonly<{ agentId: string }>) {
  const { t } = useTranslation(["common", "settings"]);
  const [prefs, setPrefs] = useState<AcpAgentPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    acpAgentPreferences(agentId)
      .then((value) => { if (current) setPrefs(value); })
      .catch((error_: unknown) => { if (current) setError(acpError(error_)); });
    return () => { current = false; };
  }, [agentId]);

  const forget = (slot: "effort" | "mode") => {
    if (!prefs) return;
    const next = { ...prefs, [slot]: null };
    setError(null);
    acpSetAgentPreferences(agentId, next)
      .then(setPrefs)
      .catch((error_: unknown) => setError(acpError(error_)));
  };

  const rows = prefs
    ? ([
        prefs.effort ? { slot: "effort" as const, text: t(($) => $.settings.ai.agents.remembered.effort, { name: prefs.effort.name }) } : null,
        prefs.mode ? { slot: "mode" as const, text: t(($) => $.settings.ai.agents.remembered.mode, { name: prefs.mode.name }) } : null,
      ].filter(Boolean) as { slot: "effort" | "mode"; text: string }[])
    : [];
  return (
    <section data-testid={`acp-agent-choices-${agentId}`} className="space-y-1.5">
      <SectionHeading as="h4">{t(($) => $.settings.ai.agents.remembered.title)}</SectionHeading>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.agents.remembered.none)}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.slot} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{row.text}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => forget(row.slot)}>
                {t(($) => $.settings.ai.agents.remembered.forget)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

export default AcpAgentChoices;

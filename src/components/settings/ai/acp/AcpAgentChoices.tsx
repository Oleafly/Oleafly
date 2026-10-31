import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import type { AgentPreferences } from "./agent-preferences";

export function AcpAgentChoices({
  agentId,
  preferences,
}: Readonly<{ agentId: string; preferences: AgentPreferences }>) {
  const { t } = useTranslation(["common", "settings"]);
  const { prefs, loadError } = preferences;
  const [saveError, setSaveError] = useState<string | null>(null);
  const error = saveError ?? loadError;

  const forget = (slot: "effort" | "mode") => {
    if (!prefs) return;
    setSaveError(null);
    void preferences.save(slot, null).then(setSaveError);
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

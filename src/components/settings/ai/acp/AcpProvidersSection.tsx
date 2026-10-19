import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  acpAgentPreferences, acpError, acpPreferences, acpProviderChoices, acpSetAgentPreferences,
  type AcpAgentPreferences, type AcpProviderChoice,
} from "@/lib/acp";

const OFF = "__off__";

/** Routing an agent that supports it through one of the user's Oleafly API keys (Experimental). */
export function AcpProvidersSection({ agentId }: Readonly<{ agentId: string }>) {
  const { t } = useTranslation(["common", "settings"]);
  const [enabled, setEnabled] = useState(false);
  const [prefs, setPrefs] = useState<AcpAgentPreferences | null>(null);
  const [choices, setChoices] = useState<AcpProviderChoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([acpPreferences(), acpAgentPreferences(agentId), acpProviderChoices(agentId)])
      .then(([global, agentPrefs, available]) => {
        if (!current) return;
        setEnabled(global.experimentalProviders);
        setPrefs(agentPrefs);
        setChoices(available);
      })
      .catch((error_: unknown) => { if (current) setError(acpError(error_)); });
    return () => { current = false; };
  }, [agentId]);

  if (!enabled || !prefs) return null;
  const choose = (value: string) => {
    const next = { ...prefs, provider: value === OFF ? null : value };
    setError(null);
    acpSetAgentPreferences(agentId, next)
      .then(setPrefs)
      .catch((error_: unknown) => setError(acpError(error_)));
  };
  return (
    <section data-testid={`acp-agent-providers-${agentId}`} className="space-y-1.5">
      <h5 className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
        {t(($) => $.settings.ai.agents.providers.label)}
      </h5>
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.agents.providers.unavailable)}</p>
      ) : (
        <Select value={prefs.provider ?? OFF} onValueChange={choose}>
          <SelectTrigger aria-label={t(($) => $.settings.ai.agents.providers.label)} className="h-8 w-64 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>{t(($) => $.settings.ai.agents.providers.off)}</SelectItem>
            {choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>{choice.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.settings.ai.agents.providers.note)}</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

export default AcpProvidersSection;

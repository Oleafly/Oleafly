import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { acpError, acpPreferences, acpProviderChoices, type AcpPreferences, type AcpProviderChoice } from "@/lib/acp";
import { ACP_PREFERENCES_CHANGED, type AgentPreferences } from "./agent-preferences";

const OFF = "__off__";

/** Routing an agent that supports it through one of the user's Oleafly API keys (Experimental). */
export function AcpProvidersSection({
  agentId,
  preferences,
}: Readonly<{ agentId: string; preferences: AgentPreferences }>) {
  const { t } = useTranslation(["common", "settings"]);
  const [enabled, setEnabled] = useState(false);
  const [choices, setChoices] = useState<AcpProviderChoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    // The Experimental switch on this tab turns the picker on and off while the card is open.
    let announced = false;
    const onPreferences = (event: Event) => {
      const saved = (event as CustomEvent<AcpPreferences>).detail;
      if (!saved) return;
      announced = true;
      setEnabled(saved.experimentalProviders);
    };
    window.addEventListener(ACP_PREFERENCES_CHANGED, onPreferences);
    Promise.all([acpPreferences(), acpProviderChoices(agentId)])
      .then(([global, available]) => {
        if (!current) return;
        if (!announced) setEnabled(global.experimentalProviders);
        setChoices(available);
      })
      .catch((error_: unknown) => { if (current) setLoadError(acpError(error_)); });
    return () => {
      current = false;
      window.removeEventListener(ACP_PREFERENCES_CHANGED, onPreferences);
    };
  }, [agentId]);

  const prefs = preferences.prefs;
  if (loadError) {
    return (
      <section data-testid={`acp-agent-providers-${agentId}`} className="space-y-1.5">
        <SectionHeading as="h4">{t(($) => $.settings.ai.agents.providers.label)}</SectionHeading>
        <p role="alert" className="text-xs text-destructive">{loadError}</p>
      </section>
    );
  }
  if (!enabled || !prefs || !choices) return null;
  const choose = (value: string) => {
    setError(null);
    void preferences.save("provider", value === OFF ? null : value).then(setError);
  };
  return (
    <section data-testid={`acp-agent-providers-${agentId}`} className="space-y-1.5">
      <SectionHeading as="h4">{t(($) => $.settings.ai.agents.providers.label)}</SectionHeading>
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.agents.providers.unavailable)}</p>
      ) : (
        <Select value={prefs.provider ?? OFF} onValueChange={choose}>
          <SelectTrigger aria-label={t(($) => $.settings.ai.agents.providers.label)} className="h-8 w-64 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
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

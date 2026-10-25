import { useEffect, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { acpError, acpPreferences, acpSetPreferences, type AcpPreferences } from "@/lib/acp";
import { announceAcpPreferences } from "./agent-preferences";

const INACTIVITY_CHOICES = [10, 20, 30, 60, 120] as const;

/** Draft protocol switches and the silent-agent limit (kept with the agents, not in settings sync). */
export function AcpExperimentalSection() {
  const { t } = useTranslation(["common", "settings"]);
  const [prefs, setPrefs] = useState<AcpPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the answer to the latest save is shown; an older one would undo a newer switch.
  const latest = useRef(0);

  useEffect(() => {
    let current = true;
    acpPreferences()
      .then((value) => { if (current) setPrefs(value); })
      .catch((error_: unknown) => { if (current) setError(acpError(error_)); });
    return () => { current = false; };
  }, []);

  const save = (patch: Partial<AcpPreferences>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    const request = ++latest.current;
    const show = (stored: AcpPreferences) => {
      if (request !== latest.current) return;
      setPrefs(stored);
      announceAcpPreferences(stored);
    };
    const saveAndShow = async () => {
      try {
        show(await acpSetPreferences(next));
      } catch (error_: unknown) {
        setError(acpError(error_));
        // A newer save brings the stored values back with it.
        if (request !== latest.current) return;
        try {
          show(await acpPreferences());
        } catch {
          // The error above already says the save failed.
        }
      }
    };
    setPrefs(next);
    setError(null);
    saveAndShow().catch(() => {});
  };

  const minutes = prefs?.inactivityMinutes ?? 20;
  const choices = INACTIVITY_CHOICES.includes(minutes as (typeof INACTIVITY_CHOICES)[number])
    ? INACTIVITY_CHOICES
    : [...INACTIVITY_CHOICES, minutes].sort((a, b) => a - b);
  return (
    <CollapsibleSection
      id="acp-experimental"
      title={t(($) => $.settings.ai.agents.experimental.title)}
      description={t(($) => $.settings.ai.agents.experimental.description)}
      headingLevel="h4"
      icon={FlaskConical}
    >
      <div data-testid="acp-experimental-rows" className="space-y-1">
        <SettingsToggleRow
          label={t(($) => $.settings.ai.agents.experimental.v2)}
          description={t(($) => $.settings.ai.agents.experimental.v2Description)}
          checked={prefs?.experimentalV2 ?? false}
          disabled={!prefs}
          onChange={(value) => save({ experimentalV2: value })}
          testId="acp-experimental-v2"
        />
        <SettingsToggleRow
          label={t(($) => $.settings.ai.agents.experimental.providers)}
          description={t(($) => $.settings.ai.agents.experimental.providersDescription)}
          checked={prefs?.experimentalProviders ?? false}
          disabled={!prefs}
          onChange={(value) => save({ experimentalProviders: value })}
          testId="acp-experimental-providers"
        />
        <SettingsRow
          label={t(($) => $.settings.ai.agents.inactivity.label)}
          description={t(($) => $.settings.ai.agents.inactivity.description)}
          control={
            <Select
              value={String(minutes)}
              disabled={!prefs}
              onValueChange={(value) => save({ inactivityMinutes: Number(value) })}
            >
              <SelectTrigger aria-label={t(($) => $.settings.ai.agents.inactivity.label)} data-testid="acp-inactivity" className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[100]">
                {choices.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t(($) => $.settings.ai.agents.inactivity.minutes, { count: value })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    </CollapsibleSection>
  );
}

export default AcpExperimentalSection;

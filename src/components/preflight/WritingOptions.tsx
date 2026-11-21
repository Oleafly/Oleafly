import { useTranslation } from "react-i18next";
import { ArrowRight, Plus, X } from "lucide-react";
import { WRITING_PROFILE_IDS, type WritingProfileId } from "@oleafly/preflight/writing/settings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveWritingSettings } from "@/features/writing-actions";
import { useFilesStore } from "@/store/files";
import { useStyleRuleDialogStore } from "@/store/style-rule-dialog";
import type { PreflightTranslate } from "./message";

export function WritingOptions() {
  const { t } = useTranslation(["common", "preflight"]);
  const tp = t as unknown as PreflightTranslate;
  const settings = useFilesStore((s) => s.projectWritingSettings);
  const showRuleDialog = useStyleRuleDialogStore((s) => s.show);

  return (
    <div className="mt-3 space-y-3 rounded-md border border-sidebar-border bg-muted/25 p-2.5" data-testid="preflight-writing-options">
      <div>
        <label htmlFor="preflight-writing-profile" className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
          {t(($) => $.preflight.panel.writing.profile)}
        </label>
        <Select
          value={settings.profile}
          onValueChange={(value) => void saveWritingSettings((current) => ({ ...current, profile: value as WritingProfileId }))}
        >
          <SelectTrigger id="preflight-writing-profile" className="mt-1.5 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WRITING_PROFILE_IDS.map((id) => (
              <SelectItem key={id} value={id} className="text-xs">
                {tp(`preflight:writingProfiles.${id}.label`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[0.625rem] leading-relaxed text-muted-foreground">
          {tp(`preflight:writingProfiles.${settings.profile}.description`)}
        </p>
      </div>

      <label htmlFor="preflight-writing-underlines" className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-xs font-medium">{t(($) => $.preflight.panel.writing.underlines)}</span>
          <span className="mt-0.5 block text-[0.625rem] leading-relaxed text-muted-foreground">
            {t(($) => $.preflight.panel.writing.underlinesHint)}
          </span>
        </span>
        <Switch
          id="preflight-writing-underlines"
          checked={settings.underlines}
          onCheckedChange={(underlines) => void saveWritingSettings((current) => ({ ...current, underlines }))}
        />
      </label>

      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
            {t(($) => $.preflight.panel.writing.rules)}
          </p>
          <Button type="button" variant="ghost" size="xs" onClick={() => showRuleDialog()} data-testid="preflight-writing-add-rule">
            <Plus aria-hidden /> {t(($) => $.preflight.panel.writing.addRule)}
          </Button>
        </div>
        {settings.rules.length === 0 ? (
          <p className="mt-1 text-[0.625rem] leading-relaxed text-muted-foreground">{t(($) => $.preflight.panel.writing.noRules)}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {settings.rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono" data-testid="preflight-writing-rule">{rule.find}</span>
                  <span className="text-muted-foreground">
                    <ArrowRight aria-hidden className="mx-1 inline size-3" />
                    {rule.replace === null ? t(($) => $.preflight.panel.writing.flagOnly) : <span className="font-mono text-foreground">{rule.replace}</span>}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={t(($) => $.preflight.panel.writing.removeRule, { find: rule.find })}
                  onClick={() => void saveWritingSettings((current) => ({ ...current, rules: current.rules.filter((entry) => entry.id !== rule.id) }))}
                >
                  <X aria-hidden className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {settings.ignored.length > 0 && (
        <Button type="button" variant="outline" size="xs" onClick={() => void saveWritingSettings((current) => ({ ...current, ignored: [] }))}>
          {t(($) => $.preflight.panel.writing.clearIgnored, { count: settings.ignored.length })}
        </Button>
      )}
    </div>
  );
}

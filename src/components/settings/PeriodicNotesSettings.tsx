import { type KeyboardEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTemplateNote, NOTE_TEMPLATES } from "@/components/notes/note-templates";
import { useOptionalNotesData } from "@/components/notes/notes-data";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  BUILT_IN_TEMPLATE,
  cleanTag,
  FORMAT_LIMIT,
  formatPeriodTitle,
  localeWeekStart,
  NOTE_TEMPLATE,
  PERIODIC_KINDS,
  type PeriodicKind,
  periodStart,
  resolveWeekStart,
  validPeriodFormat,
  WEEK_START_SETTINGS,
  type WeekStartSetting,
  weekdayName,
} from "@/lib/notes-periodic";
import { useSettingsStore } from "@/store/settings";

const BLANK = "blank";

function commitOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.currentTarget.blur();
}

function PeriodRow({ kind }: Readonly<{ kind: PeriodicKind }>) {
  const { t, i18n } = useTranslation(["notes"]);
  const settings = useSettingsStore((state) => state.notesPeriodic[kind]);
  const weekStart = useSettingsStore((state) => state.notesPeriodic.weekStart);
  const setPeriodic = useSettingsStore((state) => state.setNotesPeriodic);
  const data = useOptionalNotesData();
  const [format, setFormat] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const ids = { format: useId(), tag: useId(), template: useId(), error: useId() };
  const shownFormat = format ?? settings.format;
  const valid = validPeriodFormat(shownFormat);
  const first = resolveWeekStart(weekStart, i18n.language);
  const preview = valid ? formatPeriodTitle(shownFormat, periodStart(kind, new Date(), first), i18n.language, first) : "";
  const userTemplates = (data?.notes ?? []).filter(isTemplateNote);
  const known = settings.template === "" || settings.template.startsWith(BUILT_IN_TEMPLATE) || userTemplates.some((note) => `${NOTE_TEMPLATE}${note.id}` === settings.template);
  const label = t(($) => $.notes.periodic[kind].label);
  return (
    <SettingsRow
      testId={`settings-row-notes-periodic-${kind}`}
      label={label}
      description={t(($) => $.notes.periodic[kind].description)}
      control={<Switch checked={settings.enabled} aria-label={label} onCheckedChange={(enabled) => setPeriodic(kind, { enabled })} />}
      className="items-start"
      details={
        settings.enabled && (
          <div className="mt-3 grid gap-3 @min-[34rem]:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={ids.format} className="text-xs text-muted-foreground">
                {t(($) => $.notes.periodic.format)}
              </label>
              <Input
                id={ids.format}
                value={shownFormat}
                maxLength={FORMAT_LIMIT}
                spellCheck={false}
                aria-invalid={!valid}
                aria-describedby={ids.error}
                className="h-8 font-mono text-xs"
                onChange={(event) => setFormat(event.target.value)}
                onKeyDown={commitOnEnter}
                onBlur={() => {
                  if (format !== null && validPeriodFormat(format)) setPeriodic(kind, { format });
                  setFormat(null);
                }}
              />
              <span id={ids.error} className={valid ? "truncate text-xs text-muted-foreground" : "text-xs text-destructive"}>
                {valid ? t(($) => $.notes.periodic.preview, { title: preview }) : t(($) => $.notes.periodic.invalidFormat)}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={ids.template} className="text-xs text-muted-foreground">
                {t(($) => $.notes.periodic.template)}
              </label>
              <Select value={settings.template === "" ? BLANK : settings.template} onValueChange={(value) => setPeriodic(kind, { template: value === BLANK ? "" : value })}>
                <SelectTrigger id={ids.template} className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[100]">
                  <SelectItem value={BLANK}>{t(($) => $.notes.vault.templates.blank)}</SelectItem>
                  <SelectGroup>
                    <SelectLabel>{t(($) => $.notes.vault.templates.builtIn)}</SelectLabel>
                    {NOTE_TEMPLATES.map((template) => (
                      <SelectItem key={template.id} value={`${BUILT_IN_TEMPLATE}${template.id}`}>
                        {t(($) => $.notes.vault.templates.names[template.id])}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {(userTemplates.length > 0 || !known) && (
                    <SelectGroup>
                      <SelectLabel>{t(($) => $.notes.vault.templates.yours)}</SelectLabel>
                      {userTemplates.map((note) => (
                        <SelectItem key={note.id} value={`${NOTE_TEMPLATE}${note.id}`}>
                          {note.title}
                        </SelectItem>
                      ))}
                      {!known && <SelectItem value={settings.template}>{t(($) => $.notes.periodic.savedTemplate)}</SelectItem>}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={ids.tag} className="text-xs text-muted-foreground">
                {t(($) => $.notes.periodic.tag)}
              </label>
              <Input
                id={ids.tag}
                value={tag ?? settings.tag}
                spellCheck={false}
                placeholder={t(($) => $.notes.periodic.noTag)}
                className="h-8 text-xs"
                onChange={(event) => setTag(event.target.value)}
                onKeyDown={commitOnEnter}
                onBlur={() => {
                  if (tag !== null) setPeriodic(kind, { tag: cleanTag(tag) });
                  setTag(null);
                }}
              />
            </div>
          </div>
        )
      }
    />
  );
}

function WeekStartRow() {
  const { t, i18n } = useTranslation(["notes"]);
  const weekStart = useSettingsStore((state) => state.notesPeriodic.weekStart);
  const setWeekStart = useSettingsStore((state) => state.setNotesWeekStart);
  const label = t(($) => $.notes.periodic.weekStart.label);
  const option = (setting: WeekStartSetting) =>
    setting === "locale"
      ? t(($) => $.notes.periodic.weekStart.locale, { day: weekdayName(localeWeekStart(i18n.language), i18n.language) })
      : t(($) => $.notes.periodic.weekStart[setting]);
  return (
    <SettingsRow
      testId="settings-row-notes-week-start"
      label={label}
      description={t(($) => $.notes.periodic.weekStart.description)}
      control={
        <Select value={weekStart} onValueChange={(value) => setWeekStart(WEEK_START_SETTINGS.find((setting) => setting === value) ?? "locale")}>
          <SelectTrigger className="w-[14rem]" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {WEEK_START_SETTINGS.map((setting) => (
              <SelectItem key={setting} value={setting}>
                {option(setting)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

export function PeriodicNotesSettings() {
  const { t } = useTranslation(["notes"]);
  const id = useId();
  return (
    <section className="@container space-y-3 pt-3" aria-labelledby={id} data-testid="settings-notes-periodic">
      <SectionHeading id={id}>{t(($) => $.notes.periodic.title)}</SectionHeading>
      <WeekStartRow />
      {PERIODIC_KINDS.map((kind) => (
        <PeriodRow key={kind} kind={kind} />
      ))}
      <SettingsNote>{t(($) => $.notes.periodic.formatHelp)}</SettingsNote>
    </section>
  );
}

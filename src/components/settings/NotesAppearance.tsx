import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CircleCheck,
  MoveHorizontal,
  RectangleHorizontal,
  RectangleVertical,
  SquareCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import {
  AppearanceTabLayout,
  ChoiceRow,
  ColorChoiceRow,
  FontRow,
  FontSizeRow,
  LineHeightRow,
  ResetSetting,
  SettingsGroup,
  ToggleRow,
  TypefaceCards,
  WidthCards,
  useAppearanceSetting,
  useSettledValue,
} from "@/components/settings/AppearanceControls";
import { NotesAppearancePreview, SampleField } from "@/components/settings/NotesAppearancePreview";
import { PeriodicNotesSettings } from "@/components/settings/PeriodicNotesSettings";
import { SettingsOptionCards } from "@/components/settings/SettingsOptionCards";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { DATE_KEY, DUE_KEY } from "@/components/notes/note-field-values";
import { untrustRemoteImageHost, useTrustedRemoteImageHosts } from "@/lib/remote-image";
import {
  NOTE_WIDTHS,
  NOTES_CALLOUT_STYLES,
  NOTES_CODE_THEMES,
  NOTES_FIELD_STYLES,
  NOTES_INFO_PLACES,
  NOTES_LINE_HEIGHT_OPTIONS,
  NOTES_TASK_BOXES,
  NOTES_TIKZ_PREAMBLE_MAX,
  NOTES_TITLE_SIZES,
  TEXT_REPLACEMENT_LIMITS,
  clampNotesFontSize,
  textReplacementPair,
  type NoteWidth,
  type NotesAppearance,
  type NotesCodeTheme,
  type NotesTaskBox,
} from "@/lib/notes-appearance";
import { NOTES_TYPEFACE_STACKS, notesTextFont } from "@/lib/notes-appearance-style";
import { HEADING_SIZES, HEADING_TYPEFACES, PARAGRAPH_SPACINGS, TEXT_TYPEFACES } from "@/lib/text-appearance";
import { cn } from "@/lib/utils";
import { useEffectiveAccentColor } from "@/hooks/use-theme-preset";
import { EDITOR_THEMES } from "@/store/settings";

const WIDTH_ICONS: Readonly<Record<NoteWidth, LucideIcon>> = {
  standard: RectangleVertical,
  wide: RectangleHorizontal,
  full: MoveHorizontal,
};

const WIDTH_PAGES: Readonly<Record<NoteWidth, string>> = {
  standard: "inset-x-[34%]",
  wide: "inset-x-[20%]",
  full: "inset-x-2",
};

function TikzPreambleRow() {
  const { t } = useTranslation(["settings", "notes"]);
  const id = useId();
  const [preamble, setPreamble] = useAppearanceSetting("notesTikzPreamble");
  const [draft, setDraft] = useSettledValue(setPreamble);
  const label = t(($) => $.notes.appearance.notes.tikzPreamble.label);
  return (
    <SettingsRow
      testId="settings-row-notes-tikz-preamble"
      className="items-start"
      label={<label htmlFor={id}>{label}</label>}
      description={t(($) => $.notes.appearance.notes.tikzPreamble.description)}
      control={<ResetSetting setting={label} settingKey="notesTikzPreamble" />}
      details={
        <Textarea
          id={id}
          rows={4}
          spellCheck={false}
          className="mt-2 font-mono text-xs"
          value={draft ?? preamble}
          maxLength={NOTES_TIKZ_PREAMBLE_MAX}
          placeholder={String.raw`\usetikzlibrary{arrows.meta, positioning}`}
          onChange={(event) => setDraft(event.target.value)}
        />
      }
    />
  );
}

function codeThemeLabel(theme: NotesCodeTheme, sameAsEditor: string): string {
  if (theme === "editor") return sameAsEditor;
  return EDITOR_THEMES.find((option) => option.id === theme)?.name ?? theme;
}

function ChipRow<K extends "notesTaskBox">({
  settingKey,
  testId,
  optionTestId,
  label,
  description,
  options,
  optionLabel,
  sample,
}: Readonly<{
  settingKey: K;
  testId: string;
  optionTestId: string;
  label: string;
  description: string;
  options: readonly NotesAppearance[K][];
  optionLabel: (id: NotesAppearance[K]) => string;
  sample: (id: NotesAppearance[K]) => ReactNode;
}>) {
  const [value, setValue] = useAppearanceSetting(settingKey);
  return (
    <SettingsRow
      testId={testId}
      className="flex-wrap gap-y-2"
      label={label}
      description={description}
      control={
        <div className="flex flex-wrap items-center gap-2">
          <ResetSetting setting={label} settingKey={settingKey} />
          {options.map((id) => {
            const active = value === id;
            return (
              <button
                type="button"
                key={id}
                aria-pressed={active}
                data-testid={`${optionTestId}-${id}`}
                onClick={() => setValue(id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors motion-reduce:transition-none",
                  active ? "border-primary bg-primary/5 focus-visible:bg-primary/15" : "border-border hover:bg-accent focus-visible:bg-accent",
                )}
              >
                {sample(id)}
                {optionLabel(id)}
              </button>
            );
          })}
        </div>
      }
    />
  );
}

const TASK_BOX_ICONS: Readonly<Record<NotesTaskBox, LucideIcon>> = {
  square: SquareCheck,
  round: CircleCheck,
};

function CalloutCards() {
  const { t } = useTranslation(["settings", "notes"]);
  const [style, setStyle] = useAppearanceSetting("notesCalloutStyle");
  const label = t(($) => $.notes.appearance.notes.callouts.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-callouts"
      label={label}
      description={t(($) => $.notes.appearance.notes.callouts.description)}
      value={style}
      onChange={setStyle}
      columns={4}
      optionTestId={(id) => `settings-notes-callout-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesCalloutStyle" />}
      options={NOTES_CALLOUT_STYLES.map((id) => ({
        id,
        label: t(($) => $.notes.appearance.notes.callouts.options[id]),
        preview: (
          <span aria-hidden data-notes-callout={id} className="block w-full">
            <span className="note-callout flex h-14 flex-col justify-center gap-1.5" style={{ margin: 0, padding: "0.5rem 0.75rem" }}>
              <span className="block h-1.5 w-2/3 rounded-full bg-[var(--callout)] opacity-70" />
              <span className="block h-1 w-full rounded-full bg-foreground/20" />
              <span className="block h-1 w-4/5 rounded-full bg-foreground/20" />
            </span>
          </span>
        ),
      }))}
    />
  );
}

function FieldStyleCards() {
  const { t } = useTranslation(["settings", "notes"]);
  const [style, setStyle] = useAppearanceSetting("notesFieldStyle");
  const label = t(($) => $.notes.appearance.notes.fieldStyle.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-field-style"
      label={label}
      description={t(($) => $.notes.appearance.notes.fieldStyle.description)}
      value={style}
      onChange={setStyle}
      optionTestId={(id) => `settings-notes-field-style-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesFieldStyle" />}
      options={NOTES_FIELD_STYLES.map((id) => ({
        id,
        label: t(($) => $.notes.appearance.notes.fieldStyle.options[id]),
        preview: (
          <span aria-hidden data-notes-field-style={id} className="flex h-14 w-full flex-col items-center justify-center gap-1 text-sm">
            <SampleField fieldKey={DATE_KEY} days={5} />
            <SampleField fieldKey={DUE_KEY} days={-1} />
          </span>
        ),
      }))}
    />
  );
}

function removeKeepingFocus(button: HTMLElement, list: HTMLElement | null, fallback: () => HTMLElement | null, remove: () => void): void {
  const buttons = [...(list?.querySelectorAll<HTMLElement>("button") ?? [])];
  const index = buttons.indexOf(button);
  const neighbour = buttons[index + 1] ?? buttons[index - 1];
  flushSync(remove);
  (neighbour?.isConnected ? neighbour : fallback())?.focus();
}

function withoutPair(pairs: NotesAppearance["notesTextReplacements"], from: string): Record<string, string> {
  return Object.fromEntries(Object.entries(pairs).filter(([key]) => key !== from));
}

function TextReplacementPairs() {
  const { t } = useTranslation(["notes"]);
  const [on] = useAppearanceSetting("notesTextReplace");
  const [pairs, setPairs] = useAppearanceSetting("notesTextReplacements");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const limitId = useId();
  if (!on) return null;
  const pair = textReplacementPair(from, to);
  const entries = Object.entries(pairs);
  const full = entries.length >= TEXT_REPLACEMENT_LIMITS.count;
  const addable = pair !== null && (!full || Object.hasOwn(pairs, pair[0]));
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pair || !addable) return;
    setPairs({ ...withoutPair(pairs, pair[0]), [pair[0]]: pair[1] });
    setFrom("");
    setTo("");
    fromRef.current?.focus();
  };
  return (
    <div className="space-y-2 pb-1" data-testid="settings-notes-replacements">
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.notes.appearance.notes.replacements.empty)}</p>
      ) : (
        <ul
          ref={listRef}
          aria-label={t(($) => $.notes.appearance.notes.replacements.list)}
          className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5"
        >
          {entries.map(([key, value]) => (
            <li key={key} className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 pl-2 text-xs">
              <code className="font-mono">{key}</code>
              <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{value}</span>
              <TooltipIconButton
                label={t(($) => $.notes.appearance.notes.replacements.remove, { from: key })}
                tooltip={t(($) => $.notes.appearance.notes.replacements.removeTooltip)}
                side="top"
                className="size-6 shrink-0 text-muted-foreground [&_svg]:size-3"
                onClick={(event) =>
                  removeKeepingFocus(event.currentTarget, listRef.current, () => fromRef.current, () => setPairs(withoutPair(pairs, key)))
                }
              >
                <X aria-hidden />
              </TooltipIconButton>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <Input
          {...LITERAL_INPUT}
          ref={fromRef}
          aria-label={t(($) => $.notes.appearance.notes.replacements.type)}
          placeholder={t(($) => $.notes.appearance.notes.replacements.type)}
          value={from}
          maxLength={TEXT_REPLACEMENT_LIMITS.from}
          onChange={(event) => setFrom(event.target.value)}
          className="h-7 w-28 font-mono text-xs"
        />
        <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          {...LITERAL_INPUT}
          aria-label={t(($) => $.notes.appearance.notes.replacements.becomes)}
          placeholder={t(($) => $.notes.appearance.notes.replacements.becomes)}
          value={to}
          maxLength={TEXT_REPLACEMENT_LIMITS.to}
          onChange={(event) => setTo(event.target.value)}
          className="h-7 w-28 text-xs"
        />
        <Button type="submit" size="xs" variant="outline" disabled={!addable} aria-describedby={full ? limitId : undefined}>
          {t(($) => $.notes.appearance.notes.replacements.add)}
        </Button>
        <ResetSetting setting={t(($) => $.notes.appearance.notes.replacements.list)} settingKey="notesTextReplacements" />
      </form>
      {full && (
        <p id={limitId} className="text-xs text-muted-foreground">
          {t(($) => $.notes.appearance.notes.replacements.full, { limit: TEXT_REPLACEMENT_LIMITS.count })}
        </p>
      )}
    </div>
  );
}

function RemoteImageHosts() {
  const { t } = useTranslation(["common", "settings", "notes"]);
  const hosts = useTrustedRemoteImageHosts();
  const listRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const remove = (host: string, button: HTMLElement) =>
    removeKeepingFocus(button, listRef.current, () => emptyRef.current, () => untrustRemoteImageHost(host));
  if (hosts.length === 0) {
    return (
      <p ref={emptyRef} tabIndex={-1} className="text-xs text-muted-foreground" data-testid="settings-notes-remote-images-empty">
        {t(($) => $.notes.appearance.notes.remoteImages.empty)}
      </p>
    );
  }
  return (
    <div ref={listRef} className="space-y-2" data-testid="settings-notes-remote-images">
      <p className="text-xs text-muted-foreground">{t(($) => $.notes.appearance.notes.remoteImages.description)}</p>
      {hosts.map((host) => (
        <SettingsRow
          key={host}
          label={host}
          control={
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-label={t(($) => $.notes.appearance.notes.remoteImages.remove, { host })}
              onClick={(event) => remove(host, event.currentTarget)}
            >
              {t(($) => $.common.actions.remove)}
            </Button>
          }
        />
      ))}
    </div>
  );
}

function NotesAccentRow() {
  const { t } = useTranslation(["settings", "notes"]);
  const appAccent = useEffectiveAccentColor();
  return (
    <ColorChoiceRow
      settingKey="notesAccentColor"
      testId="settings-row-notes-accent"
      testIdPrefix="settings-notes-accent"
      matchTestId="settings-notes-accent-app"
      label={t(($) => $.notes.appearance.notes.accent.label)}
      description={t(($) => $.notes.appearance.notes.accent.description)}
      matchLabel={t(($) => $.notes.appearance.notes.accent.matchApp)}
      matchColor={appAccent}
      customAriaLabel={t(($) => $.notes.appearance.notes.accent.customAriaLabel)}
    />
  );
}

export function NotesAppearanceTab() {
  const { t } = useTranslation(["core", "settings", "notes"]);
  return (
    <AppearanceTabLayout testId="settings-appearance-notes" preview={<NotesAppearancePreview />}>
      <SettingsGroup title={t(($) => $.notes.appearance.notes.text.title)}>
        <TypefaceCards
          settingKey="notesTypeface"
          testId="settings-row-notes-typeface"
          label={t(($) => $.notes.appearance.notes.typeface.label)}
          description={t(($) => $.notes.appearance.notes.typeface.description)}
          optionTestId={(id) => `settings-notes-typeface-${id}`}
          typefaces={TEXT_TYPEFACES}
          stacks={NOTES_TYPEFACE_STACKS}
        />
        <FontRow
          settingKey="notesFontFamily"
          use="app"
          testId="settings-row-notes-font"
          label={t(($) => $.notes.appearance.notes.font.label)}
          description={t(($) => $.notes.appearance.notes.font.description)}
        />
        <FontSizeRow
          settingKey="notesFontSize"
          testId="notes-font-size"
          label={t(($) => $.notes.appearance.notes.fontSize.label)}
          description={t(($) => $.notes.appearance.notes.fontSize.description)}
          customOption={t(($) => $.notes.appearance.notes.fontSize.custom)}
          customLabel={t(($) => $.notes.appearance.notes.fontSize.customLabel)}
          clamp={clampNotesFontSize}
        />
        <LineHeightRow
          settingKey="notesLineHeight"
          customKey="notesCustomLineHeight"
          testId="notes-line-height"
          label={t(($) => $.notes.appearance.notes.lineHeight.label)}
          description={t(($) => $.notes.appearance.notes.lineHeight.description)}
          customLabel={t(($) => $.notes.appearance.notes.lineHeight.customLabel)}
          options={NOTES_LINE_HEIGHT_OPTIONS}
          optionLabel={(option) => t(($) => $.settings.appearance.editor.lineHeight.options[option])}
        />
        <ChoiceRow
          settingKey="notesParagraphSpacing"
          testId="settings-row-notes-paragraph-spacing"
          label={t(($) => $.notes.appearance.notes.paragraphSpacing.label)}
          description={t(($) => $.notes.appearance.notes.paragraphSpacing.description)}
          options={PARAGRAPH_SPACINGS}
          optionLabel={(option) => t(($) => $.settings.appearance.text.paragraphSpacings[option])}
        />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.notes.appearance.notes.headings.title)}>
        <TypefaceCards
          settingKey="notesHeadingTypeface"
          testId="settings-row-notes-heading-typeface"
          label={t(($) => $.notes.appearance.notes.headingTypeface.label)}
          description={t(($) => $.notes.appearance.notes.headingTypeface.description)}
          optionTestId={(id) => `settings-notes-heading-typeface-${id}`}
          typefaces={HEADING_TYPEFACES}
          stacks={NOTES_TYPEFACE_STACKS}
          textFont={notesTextFont}
        />
        <FontRow
          settingKey="notesHeadingFontFamily"
          use="app"
          testId="settings-row-notes-heading-font"
          label={t(($) => $.notes.appearance.notes.headingFont.label)}
          description={t(($) => $.notes.appearance.notes.headingFont.description)}
        />
        <ChoiceRow
          settingKey="notesHeadingSize"
          testId="settings-row-notes-heading-size"
          label={t(($) => $.notes.appearance.notes.headingSize.label)}
          description={t(($) => $.notes.appearance.notes.headingSize.description)}
          options={HEADING_SIZES}
          optionLabel={(option) => t(($) => $.settings.appearance.text.headingSizes[option])}
        />
        <ChoiceRow
          settingKey="notesTitleSize"
          testId="settings-row-notes-title-size"
          label={t(($) => $.notes.appearance.notes.titleSize.label)}
          description={t(($) => $.notes.appearance.notes.titleSize.description)}
          options={NOTES_TITLE_SIZES}
          optionLabel={(size) => t(($) => $.settings.appearance.fontSizeOption, { size })}
          width="w-[112px]"
        />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.notes.appearance.notes.layout.title)}>
        <WidthCards
          settingKey="notesWidth"
          testId="settings-row-notes-width"
          label={t(($) => $.notes.appearance.notes.width.label)}
          description={t(($) => $.notes.appearance.notes.width.description)}
          optionTestId={(id) => `settings-notes-width-${id}`}
          options={NOTE_WIDTHS.map((id) => ({
            id,
            label: t(($) => $.notes.appearance.notes.width.options[id]),
            inset: WIDTH_PAGES[id],
            icon: WIDTH_ICONS[id],
          }))}
        />
        <ChoiceRow
          settingKey="notesInfo"
          testId="settings-row-notes-info"
          label={t(($) => $.notes.appearance.notes.info.label)}
          description={t(($) => $.notes.appearance.notes.info.description)}
          options={NOTES_INFO_PLACES}
          optionLabel={(place) => t(($) => $.notes.appearance.notes.info.options[place])}
        />
        <ChipRow
          settingKey="notesTaskBox"
          testId="settings-row-notes-task-box"
          optionTestId="settings-notes-task-box"
          label={t(($) => $.notes.appearance.notes.taskBox.label)}
          description={t(($) => $.notes.appearance.notes.taskBox.description)}
          options={NOTES_TASK_BOXES}
          optionLabel={(id) => t(($) => $.notes.appearance.notes.taskBox.options[id])}
          sample={(id) => {
            const Icon = TASK_BOX_ICONS[id];
            return <Icon aria-hidden className="size-3.5 text-primary" />;
          }}
        />
        <ToggleRow
          settingKey="notesShowWordCount"
          testId="settings-row-notes-word-count"
          label={t(($) => $.notes.appearance.notes.wordCount.label)}
          description={t(($) => $.notes.appearance.notes.wordCount.description)}
        />
        <ToggleRow
          settingKey="notesSpellcheck"
          testId="settings-row-notes-spellcheck"
          label={t(($) => $.notes.appearance.notes.spellcheck.label)}
          description={t(($) => $.notes.appearance.notes.spellcheck.description)}
        />
        <ToggleRow
          settingKey="notesTextReplace"
          testId="settings-row-notes-text-replace"
          label={t(($) => $.notes.appearance.notes.replacements.label)}
          description={t(($) => $.notes.appearance.notes.replacements.description)}
        />
        <TextReplacementPairs />
        <ToggleRow
          settingKey="notesKeepUndo"
          testId="settings-row-notes-keep-undo"
          label={t(($) => $.notes.appearance.notes.keepUndo.label)}
          description={t(($) => $.notes.appearance.notes.keepUndo.description)}
        />
        <ToggleRow
          settingKey="notesXPostsLive"
          testId="settings-row-notes-x-posts-live"
          label={t(($) => $.notes.appearance.notes.xPostsLive.label)}
          description={t(($) => $.notes.appearance.notes.xPostsLive.description)}
        />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.notes.appearance.notes.code.title)}>
        <FontRow
          settingKey="notesCodeFontFamily"
          use="editor"
          testId="settings-row-notes-code-font"
          label={t(($) => $.notes.appearance.notes.codeFont.label)}
          description={t(($) => $.notes.appearance.notes.codeFont.description)}
        />
        <ChoiceRow
          settingKey="notesCodeTheme"
          testId="settings-row-notes-code-theme"
          label={t(($) => $.notes.appearance.notes.codeTheme.label)}
          description={t(($) => $.notes.appearance.notes.codeTheme.description)}
          options={NOTES_CODE_THEMES}
          optionLabel={(theme) => codeThemeLabel(theme, t(($) => $.notes.appearance.notes.codeTheme.options.editor))}
          width="w-[168px]"
        />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.notes.appearance.notes.drawings.title)}>
        <TikzPreambleRow />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.notes.appearance.notes.colors.title)}>
        <NotesAccentRow />
        <CalloutCards />
        <FieldStyleCards />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.notes.appearance.notes.remoteImages.title)}>
        <RemoteImageHosts />
      </SettingsGroup>

      <PeriodicNotesSettings />
    </AppearanceTabLayout>
  );
}

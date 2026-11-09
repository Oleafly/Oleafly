import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, MoveHorizontal, RectangleHorizontal, RectangleVertical, RotateCcw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomNumberInput } from "@/components/settings/CustomNumberInput";
import { FontSizeControl } from "@/components/settings/FontSizeControl";
import { NotesAppearancePreview } from "@/components/settings/NotesAppearancePreview";
import { SettingsOptionCards } from "@/components/settings/SettingsOptionCards";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { SystemFontSettingsRow } from "@/components/settings/SystemFontPicker";
import {
  NOTE_WIDTHS,
  NOTES_APPEARANCE_DEFAULTS,
  NOTES_CALLOUT_STYLES,
  NOTES_CODE_THEMES,
  NOTES_CUSTOM_LINE_HEIGHT,
  NOTES_FONT_SIZE_RANGE,
  NOTES_FONT_SIZES,
  NOTES_HEADING_SIZES,
  NOTES_HEADING_TYPEFACES,
  NOTES_HIGHLIGHT_COLORS,
  NOTES_LINE_HEIGHT_OPTIONS,
  NOTES_PARAGRAPH_SPACING_OPTIONS,
  NOTES_TITLE_SIZES,
  NOTES_TYPEFACE_STACKS,
  NOTES_TYPEFACES,
  clampNotesFontSize,
  clampNotesLineHeight,
  notesAppearanceDiffersFromDefaults,
  notesSettingIsDefault,
  notesTextFont,
  type NoteWidth,
  type NotesAppearance,
  type NotesAppearanceKey,
  type NotesCodeTheme,
} from "@/lib/notes-appearance";
import { cn } from "@/lib/utils";
import { ACCENTS, EDITOR_THEMES, useSettingsStore } from "@/store/settings";

function useNotesSetting<K extends NotesAppearanceKey>(key: K): readonly [NotesAppearance[K], (value: NotesAppearance[K]) => void] {
  const value = useSettingsStore((state) => state[key]) as NotesAppearance[K];
  const setAppearance = useSettingsStore((state) => state.setNotesAppearance);
  return [value, (next) => setAppearance(key, next)];
}

function ResetSetting({
  setting,
  settingKey,
  alsoReset = [],
  onReset,
}: Readonly<{
  setting: string;
  settingKey: NotesAppearanceKey;
  alsoReset?: readonly NotesAppearanceKey[];
  onReset?: () => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const isDefault = useSettingsStore((state) => notesSettingIsDefault(state, settingKey));
  const setAppearance = useSettingsStore((state) => state.setNotesAppearance);
  if (isDefault) return null;
  const label = t(($) => $.settings.appearance.notes.resetAriaLabel, { setting });
  return (
    <Tooltip label={label} side="top">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="size-6 shrink-0 px-0"
        aria-label={label}
        data-testid={`settings-notes-reset-${settingKey}`}
        onClick={() => {
          for (const key of [settingKey, ...alsoReset]) setAppearance(key, NOTES_APPEARANCE_DEFAULTS[key]);
          onReset?.();
        }}
      >
        <RotateCcw aria-hidden />
      </Button>
    </Tooltip>
  );
}

const ACCENT_SETTLE_MS = 150;

function useSettledValue(commit: (value: string) => void): readonly [string | null, (value: string) => void] {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef({ draft, commit });
  latest.current = { draft, commit };
  useEffect(() => {
    if (draft === null) return;
    const timer = window.setTimeout(() => {
      latest.current.commit(draft);
      setDraft(null);
    }, ACCENT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);
  useEffect(
    () => () => {
      const pending = latest.current.draft;
      if (pending !== null) latest.current.commit(pending);
    },
    [],
  );
  return [draft, setDraft];
}

function Controls({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex shrink-0 items-center gap-2">{children}</div>;
}

function Group({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const id = useId();
  return (
    <section className="space-y-3 pt-3" aria-labelledby={id}>
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

const TYPE_SAMPLE = "Ag";

function TypeSample({ family }: Readonly<{ family: string }>) {
  return (
    <span
      aria-hidden
      className="flex h-14 w-full items-center justify-center rounded bg-muted text-2xl leading-none text-foreground"
      style={{ fontFamily: family }}
    >
      {TYPE_SAMPLE}
    </span>
  );
}

function TypefaceCards() {
  const { t } = useTranslation(["settings"]);
  const [typeface, setTypeface] = useNotesSetting("notesTypeface");
  const label = t(($) => $.settings.appearance.notes.typeface.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-typeface"
      label={label}
      description={t(($) => $.settings.appearance.notes.typeface.description)}
      value={typeface}
      onChange={setTypeface}
      optionTestId={(id) => `settings-notes-typeface-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesTypeface" />}
      options={NOTES_TYPEFACES.map((id) => ({
        id,
        label: t(($) => $.settings.appearance.notes.typeface.options[id]),
        preview: <TypeSample family={NOTES_TYPEFACE_STACKS[id]} />,
      }))}
    />
  );
}

function HeadingTypefaceCards() {
  const { t } = useTranslation(["settings"]);
  const [typeface, setTypeface] = useNotesSetting("notesHeadingTypeface");
  const textFont = useSettingsStore((state) => notesTextFont(state));
  const label = t(($) => $.settings.appearance.notes.headingTypeface.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-heading-typeface"
      label={label}
      description={t(($) => $.settings.appearance.notes.headingTypeface.description)}
      value={typeface}
      onChange={setTypeface}
      columns={4}
      optionTestId={(id) => `settings-notes-heading-typeface-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesHeadingTypeface" />}
      options={NOTES_HEADING_TYPEFACES.map((id) =>
        id === "text"
          ? {
              id,
              label: t(($) => $.settings.appearance.notes.headingTypeface.options.text),
              preview: <TypeSample family={textFont} />,
            }
          : {
              id,
              label: t(($) => $.settings.appearance.notes.typeface.options[id]),
              preview: <TypeSample family={NOTES_TYPEFACE_STACKS[id]} />,
            },
      )}
    />
  );
}

function FontRow({
  settingKey,
  use,
  testId,
  label,
  description,
}: Readonly<{
  settingKey: "notesFontFamily" | "notesHeadingFontFamily" | "notesCodeFontFamily";
  use: "app" | "editor";
  testId: string;
  label: string;
  description: string;
}>) {
  const [family, setFamily] = useNotesSetting(settingKey);
  return (
    <SystemFontSettingsRow
      testId={testId}
      id={testId}
      use={use}
      label={label}
      description={description}
      value={family}
      onChange={setFamily}
      adornment={<ResetSetting setting={label} settingKey={settingKey} />}
    />
  );
}

function FontSizeRow() {
  const { t } = useTranslation(["settings"]);
  const [size, setSize] = useNotesSetting("notesFontSize");
  const [resets, setResets] = useState(0);
  const label = t(($) => $.settings.appearance.notes.fontSize.label);
  return (
    <SettingsRow
      testId="settings-row-notes-font-size"
      label={label}
      description={t(($) => $.settings.appearance.notes.fontSize.description)}
      control={
        <Controls>
          <ResetSetting setting={label} settingKey="notesFontSize" onReset={() => setResets((count) => count + 1)} />
          <FontSizeControl
            key={resets}
            value={size}
            onChange={setSize}
            presets={NOTES_FONT_SIZES}
            range={NOTES_FONT_SIZE_RANGE}
            clamp={clampNotesFontSize}
            customOption={t(($) => $.settings.appearance.notes.fontSize.custom)}
            customLabel={t(($) => $.settings.appearance.notes.fontSize.customLabel)}
            ariaLabel={label}
            triggerTestId="settings-notes-font-size-trigger"
            customTestId="settings-notes-font-size-custom"
          />
        </Controls>
      }
    />
  );
}

function LineHeightRow() {
  const { t } = useTranslation(["settings"]);
  const [lineHeight, setLineHeight] = useNotesSetting("notesLineHeight");
  const [custom, setCustom] = useNotesSetting("notesCustomLineHeight");
  const label = t(($) => $.settings.appearance.notes.lineHeight.label);
  return (
    <SettingsRow
      testId="settings-row-notes-line-height"
      label={label}
      description={t(($) => $.settings.appearance.notes.lineHeight.description)}
      control={
        <Controls>
          <ResetSetting setting={label} settingKey="notesLineHeight" alsoReset={["notesCustomLineHeight"]} />
          <Select value={lineHeight} onValueChange={(value) => setLineHeight(value as NotesAppearance["notesLineHeight"])}>
            <SelectTrigger className="w-[140px]" aria-label={label} data-testid="settings-notes-line-height-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {NOTES_LINE_HEIGHT_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(($) => $.settings.appearance.editor.lineHeight.options[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {lineHeight === "custom" ? (
            <CustomNumberInput
              value={custom}
              onCommit={setCustom}
              range={NOTES_CUSTOM_LINE_HEIGHT}
              clamp={clampNotesLineHeight}
              ariaLabel={t(($) => $.settings.appearance.notes.lineHeight.customLabel)}
              testId="settings-notes-line-height-custom"
            />
          ) : null}
        </Controls>
      }
    />
  );
}

function ChoiceRow<K extends NotesAppearanceKey>({
  settingKey,
  testId,
  label,
  description,
  options,
  optionLabel,
  width = "w-[140px]",
}: Readonly<{
  settingKey: K;
  testId: string;
  label: string;
  description: string;
  options: readonly NotesAppearance[K][];
  optionLabel: (option: NotesAppearance[K]) => string;
  width?: string;
}>) {
  const [value, setValue] = useNotesSetting(settingKey);
  return (
    <SettingsRow
      testId={testId}
      label={label}
      description={description}
      control={
        <Controls>
          <ResetSetting setting={label} settingKey={settingKey} />
          <Select
            value={String(value)}
            onValueChange={(next) => {
              const picked = options.find((option) => String(option) === next);
              if (picked !== undefined) setValue(picked);
            }}
          >
            <SelectTrigger className={width} aria-label={label} data-testid={`${testId}-trigger`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {options.map((option) => (
                <SelectItem key={String(option)} value={String(option)}>
                  {optionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Controls>
      }
    />
  );
}

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

function WidthCards() {
  const { t } = useTranslation(["settings"]);
  const [width, setWidth] = useNotesSetting("notesWidth");
  const label = t(($) => $.settings.appearance.notes.width.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-width"
      label={label}
      description={t(($) => $.settings.appearance.notes.width.description)}
      value={width}
      onChange={setWidth}
      optionTestId={(id) => `settings-notes-width-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesWidth" />}
      options={NOTE_WIDTHS.map((id) => {
        const Icon = WIDTH_ICONS[id];
        return {
          id,
          label: t(($) => $.settings.appearance.notes.width.options[id]),
          preview: (
            <span aria-hidden className="relative block h-14 w-full overflow-hidden rounded bg-muted">
              <span className={cn("absolute inset-y-2 flex flex-col gap-1 pt-1", WIDTH_PAGES[id])}>
                <span className="h-1.5 w-2/3 rounded-full bg-foreground/35" />
                <span className="h-1 w-full rounded-full bg-foreground/20" />
                <span className="h-1 w-full rounded-full bg-foreground/20" />
                <span className="h-1 w-4/5 rounded-full bg-foreground/20" />
              </span>
              <Icon className="absolute bottom-1 right-1 size-3 text-muted-foreground" />
            </span>
          ),
        };
      })}
    />
  );
}

function ToggleRow({
  settingKey,
  testId,
  label,
  description,
}: Readonly<{
  settingKey: "notesShowWordCount" | "notesSpellcheck";
  testId: string;
  label: string;
  description: string;
}>) {
  const [checked, setChecked] = useNotesSetting(settingKey);
  return <SettingsToggleRow testId={testId} label={label} description={description} checked={checked} onChange={setChecked} />;
}

function codeThemeLabel(theme: NotesCodeTheme, sameAsEditor: string): string {
  if (theme === "editor") return sameAsEditor;
  return EDITOR_THEMES.find((option) => option.id === theme)?.name ?? theme;
}

function AccentRow() {
  const { t } = useTranslation(["settings"]);
  const [accent, setAccent] = useNotesSetting("notesAccentColor");
  const appAccent = useSettingsStore((state) => state.accentColor);
  const label = t(($) => $.settings.appearance.notes.accent.label);
  const matchApp = t(($) => $.settings.appearance.notes.accent.matchApp);
  const preset = ACCENTS.some((option) => option.color === accent);
  const [picking, pick] = useSettledValue(setAccent);
  const pickerColor = picking ?? (accent || appAccent);
  const swatch = (key: string, color: string, name: string, active: boolean, onPick: () => void, testId: string) => (
    <Tooltip key={key} label={name} side="top">
      <button
        type="button"
        aria-label={t(($) => $.settings.appearance.app.accent.swatchAriaLabel, { name })}
        aria-pressed={active}
        data-testid={testId}
        onClick={onPick}
        className={cn(
          "flex size-7 items-center justify-center rounded-full border transition-transform hover:scale-110 focus-visible:scale-110 motion-reduce:transition-none",
          active ? "border-foreground" : "border-border",
        )}
        style={{ backgroundColor: color }}
      >
        {active ? <Check aria-hidden className="size-3.5 text-white drop-shadow" /> : null}
      </button>
    </Tooltip>
  );
  return (
    <SettingsRow
      testId="settings-row-notes-accent"
      className="flex-wrap gap-y-2"
      label={label}
      description={t(($) => $.settings.appearance.notes.accent.description)}
      control={
        <div className="flex flex-wrap items-center gap-2">
          <ResetSetting setting={label} settingKey="notesAccentColor" />
          <button
            type="button"
            aria-pressed={accent === ""}
            data-testid="settings-notes-accent-app"
            onClick={() => setAccent("")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors motion-reduce:transition-none",
              accent === "" ? "border-primary bg-primary/5 focus-visible:bg-primary/15" : "border-border hover:bg-accent focus-visible:bg-accent",
            )}
          >
            <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: appAccent }} />
            {matchApp}
          </button>
          {ACCENTS.map((option) =>
            swatch(option.id, option.color, option.name, accent === option.color, () => setAccent(option.color), `settings-notes-accent-${option.id}`),
          )}
          <span
            data-testid="settings-notes-accent-custom"
            data-active={accent !== "" && !preset ? "true" : "false"}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border",
              accent !== "" && !preset ? "border-foreground" : "border-border",
            )}
          >
            <ColorPicker
              ariaLabel={t(($) => $.settings.appearance.notes.accent.customAriaLabel)}
              value={pickerColor}
              onChange={pick}
            />
          </span>
        </div>
      }
    />
  );
}

function HighlightRow() {
  const { t } = useTranslation(["settings"]);
  const [highlight, setHighlight] = useNotesSetting("notesHighlightColor");
  const label = t(($) => $.settings.appearance.notes.highlight.label);
  return (
    <SettingsRow
      testId="settings-row-notes-highlight"
      className="flex-wrap gap-y-2"
      label={label}
      description={t(($) => $.settings.appearance.notes.highlight.description)}
      control={
        <div className="flex flex-wrap items-center gap-2">
          <ResetSetting setting={label} settingKey="notesHighlightColor" />
          {NOTES_HIGHLIGHT_COLORS.map((id) => {
            const active = highlight === id;
            return (
              <button
                type="button"
                key={id}
                aria-pressed={active}
                data-testid={`settings-notes-highlight-${id}`}
                data-notes-highlight={id}
                onClick={() => setHighlight(id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors motion-reduce:transition-none",
                  active ? "border-primary bg-primary/5 focus-visible:bg-primary/15" : "border-border hover:bg-accent focus-visible:bg-accent",
                )}
              >
                <mark aria-hidden className="note-highlight block h-3.5 w-5" />
                {t(($) => $.settings.appearance.notes.highlight.options[id])}
              </button>
            );
          })}
        </div>
      }
    />
  );
}

function CalloutCards() {
  const { t } = useTranslation(["settings"]);
  const [style, setStyle] = useNotesSetting("notesCalloutStyle");
  const label = t(($) => $.settings.appearance.notes.callouts.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-callouts"
      label={label}
      description={t(($) => $.settings.appearance.notes.callouts.description)}
      value={style}
      onChange={setStyle}
      columns={4}
      optionTestId={(id) => `settings-notes-callout-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesCalloutStyle" />}
      options={NOTES_CALLOUT_STYLES.map((id) => ({
        id,
        label: t(($) => $.settings.appearance.notes.callouts.options[id]),
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

export function NotesAppearanceTab() {
  const { t } = useTranslation(["core", "settings"]);
  const changed = useSettingsStore((state) => notesAppearanceDiffersFromDefaults(state));
  const resetNotesAppearance = useSettingsStore((state) => state.resetNotesAppearance);
  return (
    <div className="space-y-3" data-testid="settings-appearance-notes">
      <NotesAppearancePreview
        actions={
          changed ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              data-testid="settings-notes-reset-all"
              onClick={resetNotesAppearance}
            >
              <RotateCcw aria-hidden />
              {t(($) => $.settings.appearance.notes.resetAll)}
            </Button>
          ) : null
        }
      />

      <Group title={t(($) => $.settings.appearance.notes.text.title)}>
        <TypefaceCards />
        <FontRow
          settingKey="notesFontFamily"
          use="app"
          testId="settings-row-notes-font"
          label={t(($) => $.settings.appearance.notes.font.label)}
          description={t(($) => $.settings.appearance.notes.font.description)}
        />
        <FontSizeRow />
        <LineHeightRow />
        <ChoiceRow
          settingKey="notesParagraphSpacing"
          testId="settings-row-notes-paragraph-spacing"
          label={t(($) => $.settings.appearance.notes.paragraphSpacing.label)}
          description={t(($) => $.settings.appearance.notes.paragraphSpacing.description)}
          options={NOTES_PARAGRAPH_SPACING_OPTIONS}
          optionLabel={(option) => t(($) => $.settings.appearance.notes.paragraphSpacing.options[option])}
        />
      </Group>

      <Group title={t(($) => $.settings.appearance.notes.headings.title)}>
        <HeadingTypefaceCards />
        <FontRow
          settingKey="notesHeadingFontFamily"
          use="app"
          testId="settings-row-notes-heading-font"
          label={t(($) => $.settings.appearance.notes.headingFont.label)}
          description={t(($) => $.settings.appearance.notes.headingFont.description)}
        />
        <ChoiceRow
          settingKey="notesHeadingSize"
          testId="settings-row-notes-heading-size"
          label={t(($) => $.settings.appearance.notes.headingSize.label)}
          description={t(($) => $.settings.appearance.notes.headingSize.description)}
          options={NOTES_HEADING_SIZES}
          optionLabel={(option) => t(($) => $.settings.appearance.notes.headingSize.options[option])}
        />
        <ChoiceRow
          settingKey="notesTitleSize"
          testId="settings-row-notes-title-size"
          label={t(($) => $.settings.appearance.notes.titleSize.label)}
          description={t(($) => $.settings.appearance.notes.titleSize.description)}
          options={NOTES_TITLE_SIZES}
          optionLabel={(size) => t(($) => $.settings.appearance.fontSizeOption, { size })}
          width="w-[112px]"
        />
      </Group>

      <Group title={t(($) => $.settings.appearance.notes.layout.title)}>
        <WidthCards />
        <ToggleRow
          settingKey="notesShowWordCount"
          testId="settings-row-notes-word-count"
          label={t(($) => $.settings.appearance.notes.wordCount.label)}
          description={t(($) => $.settings.appearance.notes.wordCount.description)}
        />
        <ToggleRow
          settingKey="notesSpellcheck"
          testId="settings-row-notes-spellcheck"
          label={t(($) => $.settings.appearance.notes.spellcheck.label)}
          description={t(($) => $.settings.appearance.notes.spellcheck.description)}
        />
      </Group>

      <Group title={t(($) => $.settings.appearance.notes.code.title)}>
        <FontRow
          settingKey="notesCodeFontFamily"
          use="editor"
          testId="settings-row-notes-code-font"
          label={t(($) => $.settings.appearance.notes.codeFont.label)}
          description={t(($) => $.settings.appearance.notes.codeFont.description)}
        />
        <ChoiceRow
          settingKey="notesCodeTheme"
          testId="settings-row-notes-code-theme"
          label={t(($) => $.settings.appearance.notes.codeTheme.label)}
          description={t(($) => $.settings.appearance.notes.codeTheme.description)}
          options={NOTES_CODE_THEMES}
          optionLabel={(theme) => codeThemeLabel(theme, t(($) => $.settings.appearance.notes.codeTheme.options.editor))}
          width="w-[168px]"
        />
      </Group>

      <Group title={t(($) => $.settings.appearance.notes.colors.title)}>
        <AccentRow />
        <HighlightRow />
        <CalloutCards />
      </Group>
    </div>
  );
}

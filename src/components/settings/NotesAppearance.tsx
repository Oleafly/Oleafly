import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CircleCheck,
  MoveHorizontal,
  RectangleHorizontal,
  RectangleVertical,
  RotateCcw,
  SquareCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading } from "@/components/ui/section-heading";
import { Textarea } from "@/components/ui/textarea";
import { ColorDot, ColorSwatch } from "@/components/ui/color-swatch";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { CustomNumberInput } from "@/components/settings/CustomNumberInput";
import { FontSizeControl } from "@/components/settings/FontSizeControl";
import { NotesAppearancePreview, SampleField } from "@/components/settings/NotesAppearancePreview";
import { PeriodicNotesSettings } from "@/components/settings/PeriodicNotesSettings";
import { SettingsOptionCards } from "@/components/settings/SettingsOptionCards";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { useWideSettings } from "@/components/settings/settings-width";
import { SystemFontSettingsRow } from "@/components/settings/SystemFontPicker";
import { DATE_KEY, DUE_KEY } from "@/components/notes/note-fields";
import { untrustRemoteImageHost, useTrustedRemoteImageHosts } from "@/lib/remote-image";
import {
  NOTE_WIDTHS,
  NOTES_APPEARANCE_DEFAULTS,
  NOTES_CALLOUT_STYLES,
  NOTES_CODE_THEMES,
  NOTES_CUSTOM_LINE_HEIGHT,
  NOTES_FIELD_STYLES,
  NOTES_FONT_SIZE_RANGE,
  NOTES_HEADING_SIZES,
  NOTES_HEADING_TYPEFACES,
  NOTES_INFO_PLACES,
  NOTES_LINE_HEIGHT_OPTIONS,
  NOTES_PARAGRAPH_SPACING_OPTIONS,
  NOTES_TASK_BOXES,
  NOTES_TIKZ_PREAMBLE_MAX,
  NOTES_TITLE_SIZES,
  NOTES_TYPEFACES,
  TEXT_REPLACEMENT_LIMITS,
  clampNotesFontSize,
  clampNotesLineHeight,
  textReplacementPair,
  type NoteWidth,
  type NotesAppearance,
  type NotesAppearanceKey,
  type NotesCodeTheme,
  type NotesTaskBox,
} from "@/lib/notes-appearance";
import {
  NOTES_FONT_SIZES,
  NOTES_TYPEFACE_STACKS,
  notesSettingIsDefault,
  notesTextFont,
} from "@/lib/notes-appearance-style";
import { cn } from "@/lib/utils";
import { ACCENTS, EDITOR_THEMES, useSettingsStore } from "@/store/settings";

const SETTING_CONTROL = 'button:not([disabled]), input:not([disabled]), [role="combobox"]';
const NEAREST_ROW_DEPTH = 6;

function controlsIn(scope: Element | null, skip?: Element): HTMLElement[] {
  return [...(scope?.querySelectorAll<HTMLElement>(SETTING_CONTROL) ?? [])].filter((control) => control !== skip);
}

function focusFirstControl(controls: readonly HTMLElement[]): boolean {
  const target = controls.find((control) => control.getAttribute("aria-pressed") === "true") ?? controls[0];
  target?.focus();
  return target !== undefined;
}

function focusNearestControl(from: HTMLElement, reset: () => void): void {
  const scopes: Element[] = [];
  for (let node = from.parentElement; node && scopes.length < NEAREST_ROW_DEPTH; node = node.parentElement) scopes.push(node);
  flushSync(reset);
  for (const scope of scopes) {
    if (scope.isConnected && focusFirstControl(controlsIn(scope, from))) return;
  }
}

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
  const { t } = useTranslation(["settings", "notes"]);
  const isDefault = useSettingsStore((state) => notesSettingIsDefault(state, settingKey));
  const setAppearance = useSettingsStore((state) => state.setNotesAppearance);
  if (isDefault) return null;
  const label = t(($) => $.notes.appearance.notes.resetAriaLabel, { setting });
  return (
    <Tooltip label={label} side="top">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="size-6 shrink-0 px-0"
        aria-label={label}
        data-testid={`settings-notes-reset-${settingKey}`}
        onClick={(event) =>
          focusNearestControl(event.currentTarget, () => {
            for (const key of [settingKey, ...alsoReset]) setAppearance(key, NOTES_APPEARANCE_DEFAULTS[key]);
            onReset?.();
          })
        }
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
  const { t } = useTranslation(["settings", "notes"]);
  const [typeface, setTypeface] = useNotesSetting("notesTypeface");
  const label = t(($) => $.notes.appearance.notes.typeface.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-typeface"
      label={label}
      description={t(($) => $.notes.appearance.notes.typeface.description)}
      value={typeface}
      onChange={setTypeface}
      optionTestId={(id) => `settings-notes-typeface-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesTypeface" />}
      options={NOTES_TYPEFACES.map((id) => ({
        id,
        label: t(($) => $.notes.appearance.notes.typeface.options[id]),
        preview: <TypeSample family={NOTES_TYPEFACE_STACKS[id]} />,
      }))}
    />
  );
}

function HeadingTypefaceCards() {
  const { t } = useTranslation(["settings", "notes"]);
  const [typeface, setTypeface] = useNotesSetting("notesHeadingTypeface");
  const textFont = useSettingsStore((state) => notesTextFont(state));
  const label = t(($) => $.notes.appearance.notes.headingTypeface.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-heading-typeface"
      label={label}
      description={t(($) => $.notes.appearance.notes.headingTypeface.description)}
      value={typeface}
      onChange={setTypeface}
      columns={4}
      optionTestId={(id) => `settings-notes-heading-typeface-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesHeadingTypeface" />}
      options={NOTES_HEADING_TYPEFACES.map((id) =>
        id === "text"
          ? {
              id,
              label: t(($) => $.notes.appearance.notes.headingTypeface.options.text),
              preview: <TypeSample family={textFont} />,
            }
          : {
              id,
              label: t(($) => $.notes.appearance.notes.typeface.options[id]),
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
  const { t } = useTranslation(["settings", "notes"]);
  const [size, setSize] = useNotesSetting("notesFontSize");
  const [resets, setResets] = useState(0);
  const label = t(($) => $.notes.appearance.notes.fontSize.label);
  return (
    <SettingsRow
      testId="settings-row-notes-font-size"
      label={label}
      description={t(($) => $.notes.appearance.notes.fontSize.description)}
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
            customOption={t(($) => $.notes.appearance.notes.fontSize.custom)}
            customLabel={t(($) => $.notes.appearance.notes.fontSize.customLabel)}
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
  const { t } = useTranslation(["settings", "notes"]);
  const [lineHeight, setLineHeight] = useNotesSetting("notesLineHeight");
  const [custom, setCustom] = useNotesSetting("notesCustomLineHeight");
  const label = t(($) => $.notes.appearance.notes.lineHeight.label);
  return (
    <SettingsRow
      testId="settings-row-notes-line-height"
      label={label}
      description={t(($) => $.notes.appearance.notes.lineHeight.description)}
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
              ariaLabel={t(($) => $.notes.appearance.notes.lineHeight.customLabel)}
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
  const { t } = useTranslation(["settings", "notes"]);
  const [width, setWidth] = useNotesSetting("notesWidth");
  const label = t(($) => $.notes.appearance.notes.width.label);
  return (
    <SettingsOptionCards
      testId="settings-row-notes-width"
      label={label}
      description={t(($) => $.notes.appearance.notes.width.description)}
      value={width}
      onChange={setWidth}
      optionTestId={(id) => `settings-notes-width-${id}`}
      adornment={<ResetSetting setting={label} settingKey="notesWidth" />}
      options={NOTE_WIDTHS.map((id) => {
        const Icon = WIDTH_ICONS[id];
        return {
          id,
          label: t(($) => $.notes.appearance.notes.width.options[id]),
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
  settingKey: "notesShowWordCount" | "notesSpellcheck" | "notesTextReplace" | "notesKeepUndo";
  testId: string;
  label: string;
  description: string;
}>) {
  const [checked, setChecked] = useNotesSetting(settingKey);
  return <SettingsToggleRow testId={testId} label={label} description={description} checked={checked} onChange={setChecked} />;
}

function TikzPreambleRow() {
  const { t } = useTranslation(["settings", "notes"]);
  const id = useId();
  const [preamble, setPreamble] = useNotesSetting("notesTikzPreamble");
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

function AccentRow() {
  const { t } = useTranslation(["settings", "notes"]);
  const [accent, setAccent] = useNotesSetting("notesAccentColor");
  const appAccent = useSettingsStore((state) => state.accentColor);
  const label = t(($) => $.notes.appearance.notes.accent.label);
  const matchApp = t(($) => $.notes.appearance.notes.accent.matchApp);
  const preset = ACCENTS.some((option) => option.color === accent);
  const [picking, pick] = useSettledValue(setAccent);
  const pickerColor = picking ?? (accent || appAccent);
  return (
    <SettingsRow
      testId="settings-row-notes-accent"
      className="flex-wrap gap-y-2"
      label={label}
      description={t(($) => $.notes.appearance.notes.accent.description)}
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
            <ColorDot color={appAccent} />
            {matchApp}
          </button>
          {ACCENTS.map((option) => (
            <ColorSwatch
              key={option.id}
              color={option.color}
              name={option.name}
              label={t(($) => $.settings.appearance.app.accent.swatchAriaLabel, { name: option.name })}
              pressed={accent === option.color}
              size="md"
              data-testid={`settings-notes-accent-${option.id}`}
              onClick={() => setAccent(option.color)}
            />
          ))}
          <span
            data-testid="settings-notes-accent-custom"
            data-active={accent !== "" && !preset ? "true" : "false"}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border",
              accent !== "" && !preset ? "border-foreground" : "border-border",
            )}
          >
            <ColorPicker
              ariaLabel={t(($) => $.notes.appearance.notes.accent.customAriaLabel)}
              value={pickerColor}
              onChange={pick}
            />
          </span>
        </div>
      }
    />
  );
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
  const [value, setValue] = useNotesSetting(settingKey);
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
  const [style, setStyle] = useNotesSetting("notesCalloutStyle");
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
  const [style, setStyle] = useNotesSetting("notesFieldStyle");
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
  const [on] = useNotesSetting("notesTextReplace");
  const [pairs, setPairs] = useNotesSetting("notesTextReplacements");
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

export function NotesAppearanceTab() {
  const { t } = useTranslation(["core", "settings", "notes"]);
  const beside = useWideSettings();
  return (
    <div
      data-testid="settings-appearance-notes"
      data-layout={beside ? "beside" : "stacked"}
      className={beside ? "grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-x-5" : "space-y-3"}
    >
      <NotesAppearancePreview beside={beside} className={beside ? "col-start-2 row-start-1" : undefined} />
      <div data-testid="settings-appearance-notes-options" className={cn("space-y-3", beside && "col-start-1 row-start-1")}>
        <Group title={t(($) => $.notes.appearance.notes.text.title)}>
          <TypefaceCards />
          <FontRow
            settingKey="notesFontFamily"
            use="app"
            testId="settings-row-notes-font"
            label={t(($) => $.notes.appearance.notes.font.label)}
            description={t(($) => $.notes.appearance.notes.font.description)}
          />
          <FontSizeRow />
          <LineHeightRow />
          <ChoiceRow
            settingKey="notesParagraphSpacing"
            testId="settings-row-notes-paragraph-spacing"
            label={t(($) => $.notes.appearance.notes.paragraphSpacing.label)}
            description={t(($) => $.notes.appearance.notes.paragraphSpacing.description)}
            options={NOTES_PARAGRAPH_SPACING_OPTIONS}
            optionLabel={(option) => t(($) => $.notes.appearance.notes.paragraphSpacing.options[option])}
          />
        </Group>

        <Group title={t(($) => $.notes.appearance.notes.headings.title)}>
          <HeadingTypefaceCards />
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
            options={NOTES_HEADING_SIZES}
            optionLabel={(option) => t(($) => $.notes.appearance.notes.headingSize.options[option])}
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
        </Group>

        <Group title={t(($) => $.notes.appearance.notes.layout.title)}>
          <WidthCards />
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
        </Group>

        <Group title={t(($) => $.notes.appearance.notes.code.title)}>
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
        </Group>

        <Group title={t(($) => $.notes.appearance.notes.drawings.title)}>
          <TikzPreambleRow />
        </Group>

        <Group title={t(($) => $.notes.appearance.notes.colors.title)}>
          <AccentRow />
          <CalloutCards />
          <FieldStyleCards />
        </Group>

        <Group title={t(($) => $.notes.appearance.notes.remoteImages.title)}>
          <RemoteImageHosts />
        </Group>

        <PeriodicNotesSettings />
      </div>
    </div>
  );
}

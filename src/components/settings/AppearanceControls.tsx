import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { RotateCcw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { ColorDot, ColorSwatch } from "@/components/ui/color-swatch";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomNumberInput } from "@/components/settings/CustomNumberInput";
import { FontSizeControl, type FontSizeAutomatic } from "@/components/settings/FontSizeControl";
import { SettingsOptionCards } from "@/components/settings/SettingsOptionCards";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { SystemFontSettingsRow } from "@/components/settings/SystemFontPicker";
import { NOTES_APPEARANCE_DEFAULTS, type NotesAppearance, type NotesAppearanceKey } from "@/lib/notes-appearance";
import { sameValue } from "@/lib/same-value";
import {
  CUSTOM_LINE_HEIGHT,
  TEXT_FONT_SIZE_RANGE,
  TEXT_FONT_SIZES,
  clampLineHeight,
  type HeadingTypeface,
  type TypefaceStacks,
} from "@/lib/text-appearance";
import {
  VISUAL_APPEARANCE_DEFAULTS,
  isVisualAppearanceKey,
  type VisualAppearance,
  type VisualAppearanceKey,
} from "@/lib/visual-appearance";
import { cn } from "@/lib/utils";
import { ACCENTS, useSettingsStore } from "@/store/settings";

type AppearanceValues = NotesAppearance & VisualAppearance;
type AppearanceKey = keyof AppearanceValues;
type SettingsState = ReturnType<typeof useSettingsStore.getState>;

type KeysOf<T> = { [K in AppearanceKey]: AppearanceValues[K] extends T ? K : never }[AppearanceKey];

const APPEARANCE_DEFAULTS: AppearanceValues = { ...NOTES_APPEARANCE_DEFAULTS, ...VISUAL_APPEARANCE_DEFAULTS };

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

function setAppearanceSetting<K extends AppearanceKey>(key: K, value: AppearanceValues[K]): void {
  const state = useSettingsStore.getState();
  if (isVisualAppearanceKey(key)) state.setVisualAppearance(key as VisualAppearanceKey, value as VisualAppearance[VisualAppearanceKey]);
  else state.setNotesAppearance(key as NotesAppearanceKey, value as NotesAppearance[NotesAppearanceKey]);
}

export function useAppearanceSetting<K extends AppearanceKey>(
  key: K,
): readonly [AppearanceValues[K], (value: AppearanceValues[K]) => void] {
  const value = useSettingsStore((state) => state[key]) as AppearanceValues[K];
  return [value, (next) => setAppearanceSetting(key, next)];
}

export function ResetSetting({
  setting,
  settingKey,
  alsoReset = [],
  onReset,
}: Readonly<{
  setting: string;
  settingKey: AppearanceKey;
  alsoReset?: readonly AppearanceKey[];
  onReset?: () => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const isDefault = useSettingsStore((state) => sameValue(state[settingKey], APPEARANCE_DEFAULTS[settingKey]));
  if (isDefault) return null;
  const label = t(($) => $.settings.appearance.resetSetting, { setting });
  return (
    <Tooltip label={label} side="top">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="size-6 shrink-0 px-0"
        aria-label={label}
        data-testid={`settings-reset-${settingKey}`}
        onClick={(event) =>
          focusNearestControl(event.currentTarget, () => {
            for (const key of [settingKey, ...alsoReset]) setAppearanceSetting(key, APPEARANCE_DEFAULTS[key]);
            onReset?.();
          })
        }
      >
        <RotateCcw aria-hidden />
      </Button>
    </Tooltip>
  );
}

const SETTLE_MS = 150;

export function useSettledValue(commit: (value: string) => void): readonly [string | null, (value: string) => void] {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef({ draft, commit });
  latest.current = { draft, commit };
  useEffect(() => {
    if (draft === null) return;
    const timer = window.setTimeout(() => {
      latest.current.commit(draft);
      setDraft(null);
    }, SETTLE_MS);
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

export function AppearanceTabLayout({
  testId,
  preview,
  children,
}: Readonly<{ testId: string; preview: ReactNode; children: ReactNode }>) {
  return (
    <div data-testid={testId} className="@container">
      <div
        data-testid={`${testId}-layout`}
        className="space-y-3 @min-[52rem]:grid @min-[52rem]:grid-cols-[minmax(0,1fr)_20rem] @min-[52rem]:items-start @min-[52rem]:gap-x-5 @min-[52rem]:space-y-0"
      >
        {preview}
        <div data-testid={`${testId}-options`} className="space-y-3 @min-[52rem]:col-start-1 @min-[52rem]:row-start-1">
          {children}
        </div>
      </div>
    </div>
  );
}

export function AppearancePreviewFrame({
  label,
  testId,
  boxRef,
  boxTestId,
  boxClassName,
  children,
}: Readonly<{
  label: string;
  testId: string;
  boxRef?: Ref<HTMLDivElement>;
  boxTestId?: string;
  boxClassName?: string;
  children: ReactNode;
}>) {
  return (
    <figure
      aria-label={label}
      data-testid={testId}
      className={cn(
        "sticky -top-5 isolate z-10 -mx-1 bg-background px-1 pb-2 pt-2 dark:bg-popover",
        "@min-[52rem]:top-0 @min-[52rem]:isolation-auto @min-[52rem]:z-auto @min-[52rem]:mx-0 @min-[52rem]:self-start @min-[52rem]:bg-transparent @min-[52rem]:p-0 @min-[52rem]:dark:bg-transparent",
        "@min-[52rem]:col-start-2 @min-[52rem]:row-start-1",
      )}
    >
      <span aria-hidden className="absolute inset-0 -z-10 bg-muted/30 @min-[52rem]:hidden" />
      <div
        ref={boxRef}
        data-testid={boxTestId}
        className={cn(
          "max-h-72 overflow-y-auto rounded-lg border @min-[52rem]:max-h-[calc(var(--settings-height)-5.5625rem)]",
          boxClassName,
        )}
      >
        {children}
      </div>
    </figure>
  );
}

export function SettingsGroup({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
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

export function TypefaceCards({
  settingKey,
  typefaces,
  stacks,
  textFont,
  label,
  description,
  testId,
  optionTestId,
}: Readonly<{
  settingKey: KeysOf<HeadingTypeface>;
  typefaces: readonly HeadingTypeface[];
  stacks: TypefaceStacks;
  textFont?: (state: SettingsState) => string;
  label: string;
  description: string;
  testId: string;
  optionTestId: (id: HeadingTypeface) => string;
}>) {
  const { t } = useTranslation(["settings"]);
  const [value, setValue] = useAppearanceSetting(settingKey);
  const sameAsText = useSettingsStore((state) => textFont?.(state) ?? "");
  return (
    <SettingsOptionCards<HeadingTypeface>
      testId={testId}
      label={label}
      description={description}
      value={value}
      onChange={setValue}
      columns={typefaces.length > 3 ? 4 : 3}
      optionTestId={optionTestId}
      adornment={<ResetSetting setting={label} settingKey={settingKey} />}
      options={typefaces.map((id) => ({
        id,
        label: t(($) => $.settings.appearance.text.typefaces[id]),
        preview: <TypeSample family={id === "text" ? sameAsText : stacks[id]} />,
      }))}
    />
  );
}

export function WidthCards<K extends KeysOf<string>>({
  settingKey,
  label,
  description,
  testId,
  optionTestId,
  columns,
  options,
}: Readonly<{
  settingKey: K;
  label: string;
  description: string;
  testId: string;
  optionTestId: (id: AppearanceValues[K]) => string;
  columns?: 3 | 4;
  options: readonly { id: AppearanceValues[K]; label: string; inset: string; icon?: LucideIcon }[];
}>) {
  const [value, setValue] = useAppearanceSetting(settingKey);
  return (
    <SettingsOptionCards
      testId={testId}
      label={label}
      description={description}
      value={value}
      onChange={setValue}
      columns={columns}
      optionTestId={optionTestId}
      adornment={<ResetSetting setting={label} settingKey={settingKey} />}
      options={options.map(({ id, label: optionLabel, inset, icon: Icon }) => ({
        id,
        label: optionLabel,
        preview: (
          <span aria-hidden className="relative block h-14 w-full overflow-hidden rounded bg-muted">
            <span className={cn("absolute inset-y-2 flex flex-col gap-1 pt-1", inset)}>
              <span className="h-1.5 w-2/3 rounded-full bg-foreground/35" />
              <span className="h-1 w-full rounded-full bg-foreground/20" />
              <span className="h-1 w-full rounded-full bg-foreground/20" />
              <span className="h-1 w-4/5 rounded-full bg-foreground/20" />
            </span>
            {Icon ? <Icon className="absolute bottom-1 right-1 size-3 text-muted-foreground" /> : null}
          </span>
        ),
      }))}
    />
  );
}

export function FontRow({
  settingKey,
  use,
  testId,
  label,
  description,
}: Readonly<{
  settingKey: KeysOf<string> & `${string}FontFamily`;
  use: "app" | "editor";
  testId: string;
  label: string;
  description: string;
}>) {
  const [family, setFamily] = useAppearanceSetting(settingKey);
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

export function FontSizeRow({
  settingKey,
  testId,
  label,
  description,
  customOption,
  customLabel,
  clamp,
  automatic,
}: Readonly<{
  settingKey: KeysOf<number>;
  testId: string;
  label: string;
  description: string;
  customOption: string;
  customLabel: string;
  clamp: (value: number) => number;
  automatic?: FontSizeAutomatic;
}>) {
  const [size, setSize] = useAppearanceSetting(settingKey);
  const [resets, setResets] = useState(0);
  return (
    <SettingsRow
      testId={`settings-row-${testId}`}
      label={label}
      description={description}
      control={
        <Controls>
          <ResetSetting setting={label} settingKey={settingKey} onReset={() => setResets((count) => count + 1)} />
          <FontSizeControl
            key={resets}
            value={size}
            onChange={setSize}
            presets={TEXT_FONT_SIZES}
            range={TEXT_FONT_SIZE_RANGE}
            clamp={clamp}
            customOption={customOption}
            customLabel={customLabel}
            automatic={automatic}
            ariaLabel={label}
            triggerTestId={`settings-${testId}-trigger`}
            customTestId={`settings-${testId}-custom`}
          />
        </Controls>
      }
    />
  );
}

export function LineHeightRow<K extends KeysOf<string>>({
  settingKey,
  customKey,
  testId,
  label,
  description,
  customLabel,
  options,
  optionLabel,
  width = "w-[140px]",
}: Readonly<{
  settingKey: K;
  customKey: KeysOf<number>;
  testId: string;
  label: string;
  description: string;
  customLabel: string;
  options: readonly AppearanceValues[K][];
  optionLabel: (option: AppearanceValues[K]) => string;
  width?: string;
}>) {
  const [lineHeight, setLineHeight] = useAppearanceSetting(settingKey);
  const [custom, setCustom] = useAppearanceSetting(customKey);
  return (
    <SettingsRow
      testId={`settings-row-${testId}`}
      label={label}
      description={description}
      control={
        <Controls>
          <ResetSetting setting={label} settingKey={settingKey} alsoReset={[customKey]} />
          <Select
            value={lineHeight}
            onValueChange={(value) => {
              const picked = options.find((option) => option === value);
              if (picked !== undefined) setLineHeight(picked);
            }}
          >
            <SelectTrigger className={width} aria-label={label} data-testid={`settings-${testId}-trigger`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {optionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {lineHeight === "custom" ? (
            <CustomNumberInput
              value={custom}
              onCommit={setCustom}
              range={CUSTOM_LINE_HEIGHT}
              clamp={clampLineHeight}
              ariaLabel={customLabel}
              testId={`settings-${testId}-custom`}
            />
          ) : null}
        </Controls>
      }
    />
  );
}

export function ChoiceRow<K extends AppearanceKey>({
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
  options: readonly AppearanceValues[K][];
  optionLabel: (option: AppearanceValues[K]) => string;
  width?: string;
}>) {
  const [value, setValue] = useAppearanceSetting(settingKey);
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

export function ToggleRow({
  settingKey,
  testId,
  label,
  description,
}: Readonly<{
  settingKey: KeysOf<boolean>;
  testId: string;
  label: string;
  description: string;
}>) {
  const [checked, setChecked] = useAppearanceSetting(settingKey);
  return <SettingsToggleRow testId={testId} label={label} description={description} checked={checked} onChange={setChecked} />;
}

export function ColorChoiceRow({
  settingKey,
  testId,
  testIdPrefix,
  matchTestId,
  label,
  description,
  matchLabel,
  matchColor,
  customAriaLabel,
}: Readonly<{
  settingKey: KeysOf<string>;
  testId: string;
  testIdPrefix: string;
  matchTestId: string;
  label: string;
  description: string;
  matchLabel: string;
  matchColor: string;
  customAriaLabel: string;
}>) {
  const { t } = useTranslation(["settings"]);
  const [color, setColor] = useAppearanceSetting(settingKey);
  const preset = ACCENTS.some((option) => option.color === color);
  const [picking, pick] = useSettledValue(setColor);
  const pickerColor = picking ?? (color || matchColor);
  return (
    <SettingsRow
      testId={testId}
      className="flex-wrap gap-y-2"
      label={label}
      description={description}
      control={
        <div className="flex flex-wrap items-center gap-2">
          <ResetSetting setting={label} settingKey={settingKey} />
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-pressed={color === ""}
            data-testid={matchTestId}
            onClick={() => setColor("")}
            className={cn(
              "h-7 gap-1.5 rounded-full px-2.5 text-xs",
              color === "" && "border-primary bg-primary/5 focus-visible:bg-primary/15",
            )}
          >
            <ColorDot color={matchColor} />
            {matchLabel}
          </Button>
          {ACCENTS.map((option) => (
            <ColorSwatch
              key={option.id}
              color={option.color}
              name={option.name}
              label={t(($) => $.settings.appearance.app.accent.swatchAriaLabel, { name: option.name })}
              pressed={color === option.color}
              size="md"
              data-testid={`${testIdPrefix}-${option.id}`}
              onClick={() => setColor(option.color)}
            />
          ))}
          <span
            data-testid={`${testIdPrefix}-custom`}
            data-active={color !== "" && !preset ? "true" : "false"}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border",
              color !== "" && !preset ? "border-foreground" : "border-border",
            )}
          >
            <ColorPicker ariaLabel={customAriaLabel} value={pickerColor} onChange={pick} />
          </span>
        </div>
      }
    />
  );
}

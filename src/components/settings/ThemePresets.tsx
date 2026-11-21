import { useId } from "react";
import { useTranslation } from "react-i18next";
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group";
import type { Theme } from "@/lib/theme";
import { themePresets, type ThemePalette } from "@/lib/theme-presets";
import { useSettingsStore } from "@/store/settings";

function ThemePreview({ palette, sample }: Readonly<{ palette: ThemePalette; sample: string }>) {
  const swatches = [
    ["text", palette.foreground],
    ["accent", palette.primary],
    ["selected", palette.selected],
    ["muted-text", palette.mutedForeground],
    ["muted", palette.muted],
    ["border", palette.border],
  ] as const;
  return (
    <span
      aria-hidden
      className="flex h-[84px] flex-col justify-between rounded-lg border p-1.5"
      style={{ background: palette.sidebar, borderColor: palette.border }}
    >
      <span
        className="flex h-10 items-center justify-between rounded-md pl-2 pr-1.5"
        style={{ background: palette.background, color: palette.foreground }}
      >
        <span className="text-xl font-semibold leading-none">{sample}</span>
        <span
          className="flex h-7 w-9 flex-col justify-center gap-[3px] rounded border px-1"
          style={{ background: palette.popover, borderColor: palette.border }}
        >
          <span className="h-[3px] w-3.5 rounded-full" style={{ background: palette.foreground }} />
          <span className="h-[3px] w-5 rounded-full" style={{ background: palette.mutedForeground }} />
          <span className="flex items-center gap-[3px]">
            <span className="size-1.5 rounded-[2px]" style={{ background: palette.primary }} />
            <span className="h-[3px] w-3 rounded-full" style={{ background: palette.primary }} />
          </span>
        </span>
      </span>
      <span className="flex pl-[3px]">
        {swatches.map(([role, color]) => (
          <span
            key={role}
            className="-ml-[3px] size-3.5 rounded-full border-2"
            style={{ background: color, borderColor: palette.sidebar }}
          />
        ))}
      </span>
    </span>
  );
}

function ThemePresetRow({ mode }: Readonly<{ mode: Theme }>) {
  const { t } = useTranslation(["settings"]);
  const labelId = useId();
  const value = useSettingsStore((state) => (mode === "dark" ? state.appThemeDark : state.appThemeLight));
  const setAppTheme = useSettingsStore((state) => state.setAppTheme);
  const label =
    mode === "dark"
      ? t(($) => $.settings.appearance.app.themePresets.dark)
      : t(($) => $.settings.appearance.app.themePresets.light);
  const sample = t(($) => $.settings.appearance.app.themePresets.sample);
  return (
    <div className="space-y-2">
      <div id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <RadioGroup
        aria-labelledby={labelId}
        value={value}
        onValueChange={(id) => setAppTheme(mode, id)}
        className="grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3"
      >
        {themePresets(mode).map((preset) => (
          <RadioGroupCard
            key={preset.id}
            value={preset.id}
            label={preset.name}
            data-testid={`theme-preset-${mode}-${preset.id}`}
          >
            <ThemePreview palette={preset.palette} sample={sample} />
          </RadioGroupCard>
        ))}
      </RadioGroup>
    </div>
  );
}

export function ThemePresetSetting() {
  const { t } = useTranslation(["settings"]);
  return (
    <div data-testid="settings-row-theme-presets" className="rounded-lg border bg-card p-3">
      <div className="text-sm font-medium">{t(($) => $.settings.appearance.app.themePresets.label)}</div>
      <div className="mb-3 text-xs text-muted-foreground">
        {t(($) => $.settings.appearance.app.themePresets.description)}
      </div>
      <div className="space-y-4">
        <ThemePresetRow mode="light" />
        <ThemePresetRow mode="dark" />
      </div>
    </div>
  );
}

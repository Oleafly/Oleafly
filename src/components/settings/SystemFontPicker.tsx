import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { FontFamilyCombobox, type FontFamilyOption } from "@/components/editor/FontFamilyPicker";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { fontFamilyName, fontFamilyStack, isSystemFontAlias, primaryFontFamily } from "@/lib/font-families";
import { logError } from "@/lib/log";
import { cachedSystemFonts, listSystemFonts, type SystemFontFamily } from "@/lib/system-fonts";
import { APP_FONTS, EDITOR_FONTS } from "@/store/settings";

type SystemFonts =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly families: readonly SystemFontFamily[] };

export type SystemFontUse = "editor" | "app";

export const FONT_TYPING_DELAY_MS = 250;

function presetFamilies(presets: readonly { value: string }[], monospace: boolean): SystemFontFamily[] {
  return presets
    .filter(({ value }) => value)
    .map(({ value }) => ({ name: primaryFontFamily(value), monospace }));
}

const PRESET_FAMILIES: Readonly<Record<SystemFontUse, readonly SystemFontFamily[]>> = {
  editor: presetFamilies(EDITOR_FONTS, true),
  app: presetFamilies(APP_FONTS, false),
};

export function systemFontOptions(
  families: readonly SystemFontFamily[],
  query: string,
  labels: Readonly<{ systemDefault: string; monospace: string }>,
  preferMonospace: boolean,
): FontFamilyOption[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = families.filter((family) => family.name.toLocaleLowerCase().includes(needle));
  const ordered = preferMonospace
    ? [...matches.filter((family) => family.monospace), ...matches.filter((family) => !family.monospace)]
    : matches;
  const options = ordered.map((family) => ({
    value: family.name,
    preview: fontFamilyStack(family.name, "var(--font-sans-default)"),
    badges:
      preferMonospace && family.monospace ? [{ id: "monospace", label: labels.monospace }] : [],
  }));
  return needle ? options : [{ value: "", label: labels.systemDefault }, ...options];
}

function initialFonts(native: boolean, use: SystemFontUse): SystemFonts {
  const families = native ? cachedSystemFonts() : PRESET_FAMILIES[use];
  return families ? { status: "ready", families } : { status: "loading" };
}

function useSystemFontFamilies(use: SystemFontUse): {
  fonts: SystemFonts;
  native: boolean;
  load: () => void;
} {
  const native = isTauri();
  const [fonts, setFonts] = useState<SystemFonts>(() => initialFonts(native, use));
  const requested = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (!native || requested.current) return;
    requested.current = true;
    listSystemFonts().then(
      (families) => {
        if (live.current) setFonts({ status: "ready", families });
      },
      (error: unknown) => {
        void logError(`list system fonts for the ${use} font`, error);
        if (live.current) {
          setFonts((current) =>
            current.status === "ready" ? current : { status: "ready", families: PRESET_FAMILIES[use] },
          );
        }
      },
    );
  }, [native, use]);

  useEffect(load, [load]);

  return { fonts, native, load };
}

export function isInstalledFont(name: string, families: readonly SystemFontFamily[]): boolean {
  const wanted = fontFamilyName(name).toLocaleLowerCase();
  return (
    !wanted ||
    isSystemFontAlias(wanted) ||
    families.some((family) => family.name.toLocaleLowerCase() === wanted)
  );
}

function useTypedFontName(value: string, onChange: (value: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const commit = useRef(onChange);

  useEffect(() => {
    commit.current = onChange;
  }, [onChange]);

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    commit.current(next);
    setDraft(null);
  }, []);

  useEffect(() => flush, [flush]);

  const type = useCallback(
    (next: string) => {
      pending.current = next;
      setDraft(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, FONT_TYPING_DELAY_MS);
    },
    [flush],
  );

  const choose = useCallback(
    (next: string) => {
      pending.current = next;
      flush();
    },
    [flush],
  );

  return { shown: draft ?? value, type, choose, flush };
}

function SystemFontPicker({
  id,
  use,
  label,
  value,
  fonts,
  load,
  invalid,
  onChange,
  onEditingChange,
}: Readonly<{
  id: string;
  use: SystemFontUse;
  label: string;
  value: string;
  fonts: SystemFonts;
  load: () => void;
  invalid: boolean;
  onChange: (value: string) => void;
  onEditingChange: (editing: boolean) => void;
}>) {
  const { t } = useTranslation(["core", "editor", "settings"]);
  const typed = useTypedFontName(value, onChange);
  const systemDefault = t(($) => $.core.fonts.systemDefault);
  const monospace = t(($) => $.settings.appearance.editor.font.monospace);
  const preferMonospace = use === "editor";
  const optionsFor = useCallback(
    (query: string) =>
      fonts.status === "ready"
        ? systemFontOptions(fonts.families, query, { systemDefault, monospace }, preferMonospace)
        : [],
    [fonts, systemDefault, monospace, preferMonospace],
  );

  return (
    <FontFamilyCombobox
      id={id}
      label={label}
      value={typed.shown}
      placeholder={systemDefault}
      invalid={invalid}
      loading={fonts.status === "loading"}
      listLabel={t(($) => $.editor.documentSettings.availableFonts)}
      loadingLabel={t(($) => $.editor.documentSettings.fontsLoading)}
      optionsFor={optionsFor}
      onLoad={load}
      onChange={typed.choose}
      onInput={typed.type}
      onFocus={() => onEditingChange(true)}
      onBlur={() => {
        typed.flush();
        onEditingChange(false);
      }}
      className="h-9 w-[200px]"
    />
  );
}

export function SystemFontSettingsRow({
  testId,
  id,
  use,
  label,
  description,
  value,
  onChange,
}: Readonly<{
  testId: string;
  id: string;
  use: SystemFontUse;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const { fonts, native, load } = useSystemFontFamilies(use);
  const [editing, setEditing] = useState(false);
  const missing =
    native && !editing && fonts.status === "ready" && !isInstalledFont(value, fonts.families);

  return (
    <SettingsRow
      testId={testId}
      label={label}
      description={description}
      details={
        missing ? (
          <p className="text-xs text-amber-700 dark:text-amber-300" data-testid={`${testId}-missing`}>
            {t(($) => $.settings.appearance.fontNotInstalled, { font: fontFamilyName(value) })}
          </p>
        ) : null
      }
      control={
        <SystemFontPicker
          id={id}
          use={use}
          label={label}
          value={value}
          fonts={fonts}
          load={load}
          invalid={missing}
          onChange={onChange}
          onEditingChange={setEditing}
        />
      }
    />
  );
}

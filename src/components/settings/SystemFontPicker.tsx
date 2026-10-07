import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import {
  FontFamilyCombobox,
  MAX_FONT_CHOICES,
  type FontFamilyOption,
} from "@/components/editor/FontFamilyPicker";
import { primaryFontFamily } from "@/lib/font-families";
import { logError } from "@/lib/log";
import { cachedSystemFonts, listSystemFonts, type SystemFontFamily } from "@/lib/system-fonts";
import { APP_FONTS, EDITOR_FONTS } from "@/store/settings";

type SystemFonts =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly families: readonly SystemFontFamily[] };

export type SystemFontUse = "editor" | "app";

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
  const options = ordered.slice(0, MAX_FONT_CHOICES).map((family) => ({
    value: family.name,
    badges:
      preferMonospace && family.monospace ? [{ id: "monospace", label: labels.monospace }] : [],
  }));
  return needle ? options : [{ value: "", label: labels.systemDefault }, ...options];
}

function initialFonts(native: boolean, use: SystemFontUse): SystemFonts {
  const families = native ? cachedSystemFonts() : PRESET_FAMILIES[use];
  return families ? { status: "ready", families } : { status: "loading" };
}

function useSystemFontFamilies(use: SystemFontUse): { fonts: SystemFonts; load: () => void } {
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

  return { fonts, load };
}

export function SystemFontPicker({
  id,
  use,
  label,
  value,
  onChange,
}: Readonly<{
  id: string;
  use: SystemFontUse;
  label: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  const { t } = useTranslation(["core", "editor", "settings"]);
  const { fonts, load } = useSystemFontFamilies(use);
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
      value={value}
      placeholder={systemDefault}
      loading={fonts.status === "loading"}
      listLabel={t(($) => $.editor.documentSettings.availableFonts)}
      loadingLabel={t(($) => $.editor.documentSettings.fontsLoading)}
      optionsFor={optionsFor}
      onLoad={load}
      onChange={onChange}
      className="h-9 w-[200px]"
    />
  );
}

import type {
  JsonValue,
  LanguageServiceKind,
  LanguageServiceRuntimeProfile,
} from "@/lib/language-service";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";

export const TINYMIST_PIN_MAIN_COMMAND = "tinymist.pinMain";

export interface TypstLanguageServiceSettings {
  formatterPrintWidth: number;
  formatterIndentSize: number;
  lint: boolean;
  fontPaths?: readonly string[];
  systemFonts?: boolean;
}

export interface LanguageServiceSettingsSource {
  get(): TypstLanguageServiceSettings;
  subscribe(listener: () => void): () => void;
}

export const DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS: TypstLanguageServiceSettings =
  Object.freeze({
    formatterPrintWidth: 120,
    formatterIndentSize: 2,
    lint: false,
  });

type JsonObject = { readonly [key: string]: JsonValue };

export function tinymistConfiguration(
  base: JsonObject | null,
  settings: TypstLanguageServiceSettings,
): { [key: string]: JsonValue } {
  return {
    ...(base ?? {}),
    formatterMode: "typstyle",
    formatterPrintWidth: settings.formatterPrintWidth,
    formatterIndentSize: settings.formatterIndentSize,
    lint: { enabled: settings.lint, when: "onSave" },
    ...(settings.fontPaths?.length ? { fontPaths: [...settings.fontPaths] } : {}),
    ...(settings.systemFonts === false ? { systemFonts: false } : {}),
  };
}

function fontKey(settings: TypstLanguageServiceSettings): string {
  const paths = settings.fontPaths?.join("\n") ?? "";
  const system = settings.systemFonts === false ? 0 : 1;
  return paths || system === 0 ? `|fonts:${system}:${paths}` : "";
}

export function languageServiceStartupKey(
  kind: LanguageServiceKind,
  settings: TypstLanguageServiceSettings,
): string {
  return kind === "tinymist" ? `lint:${settings.lint ? 1 : 0}${fontKey(settings)}` : "";
}

export function runtimeProfileForSettings(
  profile: LanguageServiceRuntimeProfile,
  settings: TypstLanguageServiceSettings,
): LanguageServiceRuntimeProfile {
  if (profile.kind !== "tinymist") return profile;
  return Object.freeze({
    ...profile,
    initializationOptions: tinymistConfiguration(
      profile.initializationOptions,
      settings,
    ),
  });
}

export function liveLanguageServiceConfiguration(
  profile: LanguageServiceRuntimeProfile,
  settings: TypstLanguageServiceSettings,
): { [key: string]: JsonValue } | null {
  return profile.kind === "tinymist"
    ? tinymistConfiguration(profile.initializationOptions, settings)
    : null;
}

export function typstMainDocument(
  mainDoc: string | null | undefined,
): string | null {
  if (!mainDoc || !/\.typ$/i.test(mainDoc)) return null;
  return mainDoc.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function absoluteProjectPath(root: string, path: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const relative = path
    .replace(/^[\\/]+/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .join(separator);
  return `${trimmedRoot}${separator}${relative}`;
}

type FontOptions = { readonly font_dirs: readonly string[]; readonly system_fonts: boolean; readonly reproducible: boolean };

function projectFontOptions(): FontOptions | null {
  const engine = useFilesStore.getState().engine;
  return engine.source_format === "typst" ? (engine.typst_options ?? null) : null;
}

export function typstFontSettings(
  options: FontOptions | null,
): Pick<TypstLanguageServiceSettings, "fontPaths" | "systemFonts"> {
  if (!options) return {};
  return {
    ...(options.font_dirs.length > 0 ? { fontPaths: options.font_dirs } : {}),
    ...(!options.system_fonts || options.reproducible ? { systemFonts: false } : {}),
  };
}

function typstSettingsFromStore(): TypstLanguageServiceSettings {
  const settings = useSettingsStore.getState();
  return {
    formatterPrintWidth: settings.typstFormatterLineWidth,
    formatterIndentSize: settings.typstFormatterIndent,
    lint: settings.typstLint,
    ...typstFontSettings(projectFontOptions()),
  };
}

function sameFontOptions(left: FontOptions | null, right: FontOptions | null): boolean {
  return (
    (left?.font_dirs.join("\n") ?? "") === (right?.font_dirs.join("\n") ?? "") &&
    (left?.system_fonts ?? true) === (right?.system_fonts ?? true) &&
    (left?.reproducible ?? false) === (right?.reproducible ?? false)
  );
}

export const settingsStoreLanguageServiceSettings: LanguageServiceSettingsSource = {
  get: typstSettingsFromStore,
  subscribe: (listener) => {
    const stopSettings = useSettingsStore.subscribe((state, previous) => {
      if (
        state.typstFormatterLineWidth !== previous.typstFormatterLineWidth ||
        state.typstFormatterIndent !== previous.typstFormatterIndent ||
        state.typstLint !== previous.typstLint
      ) {
        listener();
      }
    });
    let fonts = projectFontOptions();
    const stopFonts = useFilesStore.subscribe(() => {
      const next = projectFontOptions();
      if (sameFontOptions(fonts, next)) return;
      fonts = next;
      listener();
    });
    return () => {
      stopSettings();
      stopFonts();
    };
  },
};

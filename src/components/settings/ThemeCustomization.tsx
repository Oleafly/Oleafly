import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Palette, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { i18n } from "@/i18n";
import { cssColorToHex, readClassVariables, readCssVariable } from "@/lib/css-color";
import { downloadBlob } from "@/lib/download-blob";
import { useTheme, type Theme } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";
import {
  MAX_THEME_IMPORT_BYTES,
  THEME_CUSTOMIZATION_CHANGED_EVENT,
  THEME_TOKEN_NAMES,
  accentTokenDefaults,
  applyThemeCustomization,
  parseThemeCustomizationImport,
  readThemeCustomization,
  resetThemeCustomization,
  serializeThemeCustomization,
  writeThemeCustomization,
  type ThemeCustomization as ThemeCustomizationState,
  type ThemeTokenName,
} from "@/lib/theme-customization";

const TOKEN_LABELS: Record<ThemeTokenName, () => string> = {
  background: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.background),
  foreground: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.foreground),
  card: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.card),
  "card-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.cardForeground),
  popover: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.popover),
  "popover-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.popoverForeground),
  primary: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.primary),
  "primary-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.primaryForeground),
  secondary: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.secondary),
  "secondary-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.secondaryForeground),
  muted: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.muted),
  "muted-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.mutedForeground),
  accent: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.accent),
  "accent-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.accentForeground),
  destructive: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.destructive),
  "destructive-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.destructiveForeground),
  border: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.border),
  input: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.input),
  ring: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.ring),
  sidebar: () => i18n.t(($) => $.settings.appearance.customTheme.tokens.sidebar),
  "sidebar-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.sidebarForeground),
  "sidebar-border": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.sidebarBorder),
  "sidebar-accent": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.sidebarAccent),
  "sidebar-accent-foreground": () =>
    i18n.t(($) => $.settings.appearance.customTheme.tokens.sidebarAccentForeground),
  "pdf-dark-page": () => i18n.t(($) => $.settings.appearance.customTheme.tokens.pdfDarkPage),
  "pdf-dark-text": () => i18n.t(($) => $.settings.appearance.customTheme.tokens.pdfDarkText),
};

function downloadTheme(customization: ThemeCustomizationState) {
  const { editorThemeLight, editorThemeDark, editorColors } = useSettingsStore.getState();
  const editor = { themes: { light: editorThemeLight, dark: editorThemeDark }, colors: editorColors };
  downloadBlob(
    new Blob([serializeThemeCustomization(customization, editor)], { type: "application/json" }),
    "oleafly-theme.json",
  );
}

type TokenDrafts = Record<Theme, Partial<Record<ThemeTokenName, string>>>;

export function useThemeTokenEditor(onReset?: () => void) {
  const { theme } = useTheme();
  const accentColor = useSettingsStore((state) => state.accentColor);
  const [customization, setCustomization] = useState<ThemeCustomizationState>(() => readThemeCustomization());
  const [tokenDrafts, setTokenDrafts] = useState<TokenDrafts>({ light: {}, dark: {} });
  const [message, setMessage] = useState<string | null>(null);
  const reload = useEffectEvent(() => {
    setCustomization(readThemeCustomization());
    setTokenDrafts({ light: {}, dark: {} });
    onReset?.();
  });

  useEffect(() => {
    const onChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.reset === true) reload();
    };
    window.addEventListener(THEME_CUSTOMIZATION_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(THEME_CUSTOMIZATION_CHANGED_EVENT, onChange);
  }, []);

  const save = (next: ThemeCustomizationState, notice?: string) => {
    const saved = writeThemeCustomization(next);
    setCustomization(saved);
    applyThemeCustomization(theme, saved);
    setMessage(notice ?? null);
  };

  const updateToken = (mode: Theme, token: ThemeTokenName, value: string, reportError = false) => {
    setTokenDrafts((current) => ({ ...current, [mode]: { ...current[mode], [token]: value } }));
    const nextTokens = { ...customization[mode] };
    if (value.trim()) nextTokens[token] = value.trim();
    else delete nextTokens[token];
    try {
      save({ ...customization, [mode]: nextTokens });
    } catch (error) {
      if (reportError) setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const otherMode: Theme = theme === "light" ? "dark" : "light";
  const otherModeDefaults = useMemo(
    () => ({
      ...readClassVariables(otherMode, THEME_TOKEN_NAMES.map((token) => `--${token}`)),
      ...accentTokenDefaults(otherMode, accentColor),
    }),
    [otherMode, accentColor],
  );

  const effectiveColor = (mode: Theme, token: ThemeTokenName): string => {
    const override = (tokenDrafts[mode][token] ?? customization[mode][token] ?? "").trim();
    if (override) return override;
    return mode === theme ? readCssVariable(`--${token}`) : (otherModeDefaults[`--${token}`] ?? "");
  };

  return { theme, customization, tokenDrafts, setTokenDrafts, message, setMessage, save, updateToken, effectiveColor };
}

type ThemeTokenEditor = ReturnType<typeof useThemeTokenEditor>;

export function ThemeTokenField({
  editor,
  mode,
  token,
}: Readonly<{
  editor: ThemeTokenEditor;
  mode: Theme;
  token: ThemeTokenName;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const current = editor.effectiveColor(mode, token);
  const tokenLabel = TOKEN_LABELS[token]();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] items-center gap-2 text-xs">
      <span className="truncate text-muted-foreground" title={token}>{tokenLabel}</span>
      <ColorPicker
        ariaLabel={
          mode === "light"
            ? t(($) => $.settings.appearance.customTheme.pickColorLight, { token: tokenLabel })
            : t(($) => $.settings.appearance.customTheme.pickColorDark, { token: tokenLabel })
        }
        value={cssColorToHex(current) ?? current}
        onChange={(value) => editor.updateToken(mode, token, value, true)}
      />
      <Input
        {...LITERAL_INPUT}
        aria-label={
          mode === "light"
            ? t(($) => $.settings.appearance.customTheme.tokenInputLight, { token: tokenLabel })
            : t(($) => $.settings.appearance.customTheme.tokenInputDark, { token: tokenLabel })
        }
        value={editor.tokenDrafts[mode][token] ?? editor.customization[mode][token] ?? ""}
        onChange={(event) => editor.updateToken(mode, token, event.target.value)}
        onBlur={(event) => editor.updateToken(mode, token, event.target.value, true)}
        placeholder={t(($) => $.common.state.default)}
        className="h-8 font-mono text-[0.6875rem]"
      />
    </div>
  );
}

export function ThemeCustomization() {
  const { t } = useTranslation(["common", "settings"]);
  const [radiusDraft, setRadiusDraft] = useState<string | null>(null);
  const [customCssDraft, setCustomCssDraft] = useState<string | null>(null);
  const editor = useThemeTokenEditor(() => {
    setRadiusDraft(null);
    setCustomCssDraft(null);
  });
  const { theme, customization, save, message, setMessage, setTokenDrafts } = editor;
  const [editMode, setEditMode] = useState<Theme>(theme);
  const importInput = useRef<HTMLInputElement>(null);

  const resetMode = () => {
    setTokenDrafts((current) => ({ ...current, [editMode]: {} }));
    save(
      { ...customization, [editMode]: {} },
      editMode === "light"
        ? t(($) => $.settings.appearance.customTheme.lightRestored)
        : t(($) => $.settings.appearance.customTheme.darkRestored),
    );
  };

  const resetAll = () => {
    applyThemeCustomization(theme, resetThemeCustomization());
    setMessage(t(($) => $.settings.appearance.customTheme.cleared));
  };

  const importTheme = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_THEME_IMPORT_BYTES) {
      setMessage(t(($) => $.settings.appearance.customTheme.fileTooLarge));
      return;
    }
    try {
      const { customization: imported, skippedTokens, editor: editorThemes } = parseThemeCustomizationImport(await file.text());
      if (editorThemes) useSettingsStore.getState().importEditorThemes(editorThemes);
      const shownTokens = skippedTokens.slice(0, 6).join(", ");
      const skippedNotice =
        skippedTokens.length > 6
          ? t(($) => $.settings.appearance.customTheme.importedSkippedMore, {
              count: skippedTokens.length,
              tokens: shownTokens,
            })
          : t(($) => $.settings.appearance.customTheme.importedSkipped, {
              count: skippedTokens.length,
              tokens: shownTokens,
            });
      const notice =
        skippedTokens.length === 0
          ? t(($) => $.settings.appearance.customTheme.imported)
          : skippedNotice;
      save(imported, notice);
      setTokenDrafts({ light: {}, dark: {} });
      setRadiusDraft(null);
      setCustomCssDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  return (
    <CollapsibleSection
      id="theme-customization"
      icon={Palette}
      title={t(($) => $.settings.appearance.customTheme.title)}
      description={t(($) => $.settings.appearance.customTheme.description)}
    >
      <fieldset
        className="flex flex-wrap items-center gap-2"
        aria-label={t(($) => $.settings.appearance.customTheme.modeFieldsetAriaLabel)}
      >
        {(["light", "dark"] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            size="xs"
            variant={editMode === mode ? "default" : "outline"}
            aria-pressed={editMode === mode}
            onClick={() => setEditMode(mode)}
          >
            {mode === "light"
              ? t(($) => $.settings.appearance.customTheme.modeLight)
              : t(($) => $.settings.appearance.customTheme.modeDark)}
          </Button>
        ))}
        <Button type="button" size="xs" variant="ghost" onClick={resetMode}>
          <RotateCcw aria-hidden />
          {t(($) => $.settings.appearance.customTheme.resetMode)}
        </Button>
      </fieldset>

      <div className="grid gap-2 sm:grid-cols-2">
        {THEME_TOKEN_NAMES.map((token) => (
          <ThemeTokenField key={token} editor={editor} mode={editMode} token={token} />
        ))}
      </div>

      <div className="space-y-1 text-xs">
        <span className="font-medium">
          {t(($) => $.settings.appearance.customTheme.radius.label)}
        </span>
        <span className="block text-muted-foreground">
          {t(($) => $.settings.appearance.customTheme.radius.description)}
        </span>
        <Input
          {...LITERAL_INPUT}
          aria-label={t(($) => $.settings.appearance.customTheme.radius.label)}
          value={radiusDraft ?? customization.radius ?? ""}
          onChange={(event) => {
            setRadiusDraft(event.target.value);
            try {
              save({ ...customization, radius: event.target.value || null });
            } catch {
              setMessage(null);
            }
          }}
          onBlur={(event) => {
            try {
              save({ ...customization, radius: event.target.value || null });
              setRadiusDraft(null);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
          placeholder={"0.625rem"}
          className="h-8 max-w-44 font-mono text-[0.6875rem]"
        />
      </div>

      <div className="space-y-1 text-xs">
        <span className="font-medium">
          {t(($) => $.settings.appearance.customTheme.customCss.label)}
        </span>
        <span className="block text-muted-foreground">
          {t(($) => $.settings.appearance.customTheme.customCss.description)}
        </span>
        <Textarea
          aria-label={t(($) => $.settings.appearance.customTheme.customCss.label)}
          value={customCssDraft ?? customization.customCss ?? ""}
          onChange={(event) => {
            setCustomCssDraft(event.target.value);
            try {
              save({ ...customization, customCss: event.target.value || null });
            } catch {
              setMessage(null);
            }
          }}
          onBlur={(event) => {
            try {
              save({ ...customization, customCss: event.target.value || null });
              setCustomCssDraft(null);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
          placeholder={"color: #202020; --oleafly-note: #f6d365"}
          className="min-h-20 font-mono text-[0.6875rem]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="xs" variant="outline" onClick={() => downloadTheme(customization)}>
          <Download aria-hidden />
          {t(($) => $.settings.appearance.customTheme.exportTheme)}
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={() => importInput.current?.click()}>
          <Upload aria-hidden />
          {t(($) => $.settings.appearance.customTheme.importTheme)}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={resetAll}>
          <RotateCcw aria-hidden />
          {t(($) => $.settings.appearance.customTheme.resetAll)}
        </Button>
        <input
          ref={importInput}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label={t(($) => $.settings.appearance.customTheme.importFileAriaLabel)}
          onChange={(event) => void importTheme(event.currentTarget.files?.[0])}
        />
      </div>
      {message ? <output className="block text-xs text-muted-foreground">{message}</output> : null}
    </CollapsibleSection>
  );
}

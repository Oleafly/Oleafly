import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { RotateCcw } from "lucide-react";
import {
  SURFACE_COLORS,
  SYNTAX_ROLES,
  languageForPath,
  type EditorColorId,
} from "@oleafly/editor";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ColorPicker } from "@/components/ui/color-picker";
import { editorTheme } from "@/components/editor/cm/theme";
import {
  editorColorKey,
  editorColorPreviewStyle,
  readEditorThemeColors,
  type EditorColorOverrides,
  type EditorThemeId,
} from "@/lib/editor-themes";
import { useTheme, type Theme } from "@/lib/theme";
import { accentTokenDefaults } from "@/lib/theme-customization";
import { EDITOR_THEMES, useSettingsStore } from "@/store/settings";

type PreviewSample = "latex" | "typst" | "markdown";

const PREVIEW_SAMPLES: Readonly<Record<PreviewSample, { label: string; path: string; source: string }>> = {
  latex: {
    label: "LaTeX",
    path: "preview.tex",
    source: [
      String.raw`\documentclass[12pt]{article}`,
      String.raw`\usepackage{amsmath}`,
      "% A comment",
      String.raw`\section{Results}`,
      String.raw`Energy is \textbf{conserved} \cite{noether1918}, see \ref{eq:energy}.`,
      String.raw`\begin{equation}`,
      String.raw`  E = mc^2 \label{eq:energy}`,
      String.raw`\end{equation}`,
      String.raw`\href{https://oleafly.com}{Oleafly}`,
    ].join("\n"),
  },
  typst: {
    label: "Typst",
    path: "preview.typ",
    source: [
      `#import "@preview/cetz:0.3.2": canvas`,
      `#set page(margin: 2cm)`,
      `// A comment`,
      `= Results`,
      `Energy is *conserved* @noether1918, see @eq-energy.`,
      `$ E = m c^2 $ <eq-energy>`,
      `#let width = 12pt`,
      `#link("https://oleafly.com")[Oleafly]`,
    ].join("\n"),
  },
  markdown: {
    label: "Markdown",
    path: "preview.md",
    source: [
      `<!-- A comment -->`,
      `# Results`,
      `Energy is **conserved** [@noether1918].`,
      `$E = mc^2$`,
      "[Oleafly](https://oleafly.com) and `code`",
    ].join("\n"),
  },
};

const PREVIEW_ORDER: readonly PreviewSample[] = ["latex", "typst", "markdown"];
const MODES: readonly Theme[] = ["light", "dark"];

function EditorColorPreview({
  sample,
  theme,
  style,
  mode,
}: Readonly<{
  sample: PreviewSample;
  theme: EditorThemeId;
  style: CSSProperties;
  mode: Theme;
}>) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const { path, source } = PREVIEW_SAMPLES[sample];
    const language = languageForPath(path);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          ...(language ? [language] : []),
          editorTheme(),
        ],
      }),
    });
    return () => view.destroy();
  }, [sample]);

  return (
    <div className={mode} style={style}>
      <div
        ref={hostRef}
        data-testid="settings-editor-colors-preview"
        data-editor-theme={theme}
        className="overflow-hidden rounded-md border"
      />
    </div>
  );
}

export function EditorColors() {
  const { t } = useTranslation(["settings"]);
  const { theme: appMode } = useTheme();
  const accentColor = useSettingsStore((state) => state.accentColor);
  const editorThemeLight = useSettingsStore((state) => state.editorThemeLight);
  const editorThemeDark = useSettingsStore((state) => state.editorThemeDark);
  const editorColors = useSettingsStore((state) => state.editorColors);
  const setEditorColor = useSettingsStore((state) => state.setEditorColor);
  const resetEditorColors = useSettingsStore((state) => state.resetEditorColors);
  const [mode, setMode] = useState<Theme>(appMode);
  const [sample, setSample] = useState<PreviewSample>("latex");
  const theme = mode === "dark" ? editorThemeDark : editorThemeLight;
  const key = editorColorKey(theme, mode);
  const overrides: EditorColorOverrides = editorColors[key] ?? {};
  const modeStyle = useMemo(() => accentTokenDefaults(mode, accentColor), [mode, accentColor]);
  const themeColors = useMemo(
    () => readEditorThemeColors(theme, mode, modeStyle),
    [theme, mode, modeStyle],
  );
  const previewStyle = useMemo(
    () => ({ ...modeStyle, ...editorColorPreviewStyle(overrides) }) as CSSProperties,
    [modeStyle, overrides],
  );
  const themeName = EDITOR_THEMES.find((option) => option.id === theme)?.name ?? theme;
  const customized = Object.keys(overrides).length > 0;

  const colorRow = (id: EditorColorId) => {
    const label = t(($) => $.settings.appearance.editor.colors.names[id]);
    const custom = overrides[id];
    return (
      <div
        key={id}
        data-testid={`settings-editor-color-${id}`}
        data-custom={custom ? "true" : "false"}
        className="flex min-w-0 select-none items-center gap-2 text-xs"
      >
        <ColorPicker
          ariaLabel={t(($) => $.settings.appearance.editor.colors.pick, { color: label })}
          value={custom ?? themeColors[id]}
          onChange={(color) => setEditorColor(key, id, color)}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {custom ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="size-6 px-0"
            aria-label={t(($) => $.settings.appearance.editor.colors.useThemeColor, { color: label })}
            onClick={() => setEditorColor(key, id, "")}
          >
            <RotateCcw aria-hidden />
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <CollapsibleSection
      id="editor-colors"
      title={t(($) => $.settings.appearance.editor.colors.title)}
      description={t(($) => $.settings.appearance.editor.colors.description)}
    >
      <fieldset
        className="flex select-none flex-wrap items-center gap-2"
        aria-label={t(($) => $.settings.appearance.editor.colors.modeAriaLabel)}
      >
        {MODES.map((option) => (
          <Button
            key={option}
            type="button"
            size="xs"
            variant={mode === option ? "default" : "outline"}
            aria-pressed={mode === option}
            data-testid={`settings-editor-colors-mode-${option}`}
            onClick={() => setMode(option)}
          >
            {t(($) => $.settings.appearance.editor.colors.mode[option])}
          </Button>
        ))}
        {customized ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid="settings-editor-colors-reset"
            onClick={() => resetEditorColors(key)}
          >
            <RotateCcw aria-hidden />
            {t(($) => $.settings.appearance.editor.colors.reset)}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground" data-testid="settings-editor-colors-theme">
          {t(($) => $.settings.appearance.editor.colors.editing, { theme: themeName })}
        </span>
      </fieldset>

      <fieldset
        className="flex select-none flex-wrap gap-1"
        aria-label={t(($) => $.settings.appearance.editor.colors.previewAriaLabel)}
      >
        {PREVIEW_ORDER.map((option) => (
          <Button
            key={option}
            type="button"
            size="xs"
            variant={sample === option ? "secondary" : "ghost"}
            aria-pressed={sample === option}
            data-testid={`settings-editor-colors-sample-${option}`}
            onClick={() => setSample(option)}
          >
            {PREVIEW_SAMPLES[option].label}
          </Button>
        ))}
      </fieldset>

      <EditorColorPreview sample={sample} theme={theme} style={previewStyle} mode={mode} />

      <div className="space-y-2">
        <h4 className="select-none text-xs font-medium">{t(($) => $.settings.appearance.editor.colors.editorGroup)}</h4>
        <div className="grid gap-2 sm:grid-cols-2">{SURFACE_COLORS.map(colorRow)}</div>
      </div>
      <div className="space-y-2">
        <h4 className="select-none text-xs font-medium">{t(($) => $.settings.appearance.editor.colors.syntaxGroup)}</h4>
        <div className="grid gap-2 sm:grid-cols-2">{SYNTAX_ROLES.map(colorRow)}</div>
      </div>
    </CollapsibleSection>
  );
}

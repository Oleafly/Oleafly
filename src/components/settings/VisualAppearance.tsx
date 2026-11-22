import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolvedEditorColor } from "@oleafly/editor/color-roles";
import { VISUAL_TEXT_SCALE, type VisualTextWidth } from "@oleafly/editor/visual/appearance";
import { escapeLatexText } from "@oleafly/latex";
import {
  AppearancePreviewFrame,
  AppearanceTabLayout,
  ChoiceRow,
  ColorChoiceRow,
  FontRow,
  FontSizeRow,
  LineHeightRow,
  SettingsGroup,
  ToggleRow,
  TypefaceCards,
  WidthCards,
} from "@/components/settings/AppearanceControls";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { ReadOnlyLatex } from "@/components/editor/cm/ReadOnlyLatex";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import { HEADING_SIZES, HEADING_TYPEFACES, PARAGRAPH_SPACINGS, TEXT_TYPEFACES } from "@/lib/text-appearance";
import {
  VISUAL_LINE_HEIGHT_OPTIONS,
  VISUAL_MATCH_EDITOR_SIZE,
  VISUAL_PARAGRAPH_INDENTS,
  VISUAL_TEXT_ALIGNS,
  VISUAL_TEXT_WIDTHS,
  clampVisualFontSize,
} from "@/lib/visual-appearance";
import { VISUAL_TYPEFACE_STACKS, visualTextFont } from "@/lib/visual-appearance-style";
import { useSettingsStore } from "@/store/settings";

const NO_IMAGES = { resolveImage: () => Promise.resolve(null) };

const WIDTH_PAGES: Readonly<Record<VisualTextWidth, string>> = {
  narrow: "inset-x-[36%]",
  standard: "inset-x-[26%]",
  wide: "inset-x-[14%]",
  full: "inset-x-2",
};

type VisualModule = typeof import("@oleafly/editor/visual");

function usePreviewSource(): string {
  const { t } = useTranslation(["settings"]);
  return useMemo(
    () =>
      [
        String.raw`\section{${escapeLatexText(t(($) => $.settings.appearance.visual.preview.heading))}}`,
        escapeLatexText(t(($) => $.settings.appearance.visual.preview.first)),
        "",
        escapeLatexText(t(($) => $.settings.appearance.visual.preview.second)),
        "",
        String.raw`\subsection{${escapeLatexText(t(($) => $.settings.appearance.visual.preview.subheading))}}`,
        escapeLatexText(t(($) => $.settings.appearance.visual.preview.third)),
      ].join("\n"),
    [t],
  );
}

function useVisualModule(): VisualModule | null {
  const [visual, setVisual] = useState<VisualModule | null>(null);
  useEffect(() => {
    let active = true;
    import("@oleafly/editor/visual")
      .then((module) => {
        if (active) setVisual(module);
      })
      .catch((error: unknown) => logError("settings.visual-preview", error));
    return () => {
      active = false;
    };
  }, []);
  return visual;
}

function VisualAppearancePreview() {
  const { t } = useTranslation(["settings"]);
  const source = usePreviewSource();
  const visual = useVisualModule();
  const language = useMemo(() => visual?.latexTreeSupport(), [visual]);
  const extensions = useMemo(() => (visual ? [visual.visualMode(NO_IMAGES)] : []), [visual]);
  return (
    <AppearancePreviewFrame label={t(($) => $.settings.appearance.visual.preview.label)} testId="settings-visual-preview">
      <div aria-hidden inert className="pointer-events-none select-none">
        {visual ? (
          <ReadOnlyLatex
            source={source}
            language={language}
            extensions={extensions}
            testId="settings-visual-preview-editor"
          />
        ) : null}
      </div>
    </AppearancePreviewFrame>
  );
}

function VisualFontSizeRow() {
  const { t } = useTranslation(["settings"]);
  const editorSize = useSettingsStore((state) => (state.editorUsesAppFont ? state.appFontSize : state.editorFontSize));
  return (
    <FontSizeRow
      settingKey="visualFontSize"
      testId="visual-font-size"
      label={t(($) => $.settings.appearance.visual.fontSize.label)}
      description={t(($) => $.settings.appearance.visual.fontSize.description)}
      customOption={t(($) => $.settings.appearance.editor.fontSize.custom)}
      customLabel={t(($) => $.settings.appearance.visual.fontSize.customLabel)}
      clamp={clampVisualFontSize}
      automatic={{
        label: t(($) => $.settings.appearance.visual.matchEditor),
        value: VISUAL_MATCH_EDITOR_SIZE,
        size: Math.round(editorSize * VISUAL_TEXT_SCALE),
      }}
    />
  );
}

export function VisualAppearanceTab() {
  const { t } = useTranslation(["settings"]);
  return (
    <AppearanceTabLayout testId="settings-appearance-visual" preview={<VisualAppearancePreview />}>
      <SettingsNote testId="settings-visual-intro">{t(($) => $.settings.appearance.visual.intro)}</SettingsNote>
      <SettingsGroup title={t(($) => $.settings.appearance.visual.text.title)}>
        <TypefaceCards
          settingKey="visualTypeface"
          testId="settings-row-visual-typeface"
          label={t(($) => $.settings.appearance.visual.typeface.label)}
          description={t(($) => $.settings.appearance.visual.typeface.description)}
          optionTestId={(id) => `settings-visual-typeface-${id}`}
          typefaces={TEXT_TYPEFACES}
          stacks={VISUAL_TYPEFACE_STACKS}
        />
        <FontRow
          settingKey="visualFontFamily"
          use="app"
          testId="settings-row-visual-font"
          label={t(($) => $.settings.appearance.visual.font.label)}
          description={t(($) => $.settings.appearance.visual.font.description)}
        />
        <VisualFontSizeRow />
        <LineHeightRow
          settingKey="visualLineHeight"
          customKey="visualCustomLineHeight"
          testId="visual-line-height"
          label={t(($) => $.settings.appearance.visual.lineHeight.label)}
          description={t(($) => $.settings.appearance.visual.lineHeight.description)}
          customLabel={t(($) => $.settings.appearance.visual.lineHeight.customLabel)}
          options={VISUAL_LINE_HEIGHT_OPTIONS}
          width="w-[168px]"
          optionLabel={(option) =>
            option === "editor"
              ? t(($) => $.settings.appearance.visual.matchEditor)
              : t(($) => $.settings.appearance.editor.lineHeight.options[option])
          }
        />
        <ChoiceRow
          settingKey="visualParagraphSpacing"
          testId="settings-row-visual-paragraph-spacing"
          label={t(($) => $.settings.appearance.visual.paragraphSpacing.label)}
          description={t(($) => $.settings.appearance.visual.paragraphSpacing.description)}
          options={PARAGRAPH_SPACINGS}
          optionLabel={(option) => t(($) => $.settings.appearance.text.paragraphSpacings[option])}
        />
        <ChoiceRow
          settingKey="visualParagraphIndent"
          testId="settings-row-visual-paragraph-indent"
          label={t(($) => $.settings.appearance.visual.paragraphIndent.label)}
          description={t(($) => $.settings.appearance.visual.paragraphIndent.description)}
          options={VISUAL_PARAGRAPH_INDENTS}
          optionLabel={(indent) =>
            indent === 0
              ? t(($) => $.settings.appearance.visual.paragraphIndent.none)
              : t(($) => $.settings.appearance.visual.paragraphIndent.option, { value: formatNumber(indent) })
          }
        />
        <ChoiceRow
          settingKey="visualTextAlign"
          testId="settings-row-visual-text-align"
          label={t(($) => $.settings.appearance.visual.textAlign.label)}
          description={t(($) => $.settings.appearance.visual.textAlign.description)}
          options={VISUAL_TEXT_ALIGNS}
          optionLabel={(align) => t(($) => $.settings.appearance.visual.textAlign.options[align])}
        />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.settings.appearance.visual.headings.title)}>
        <TypefaceCards
          settingKey="visualHeadingTypeface"
          testId="settings-row-visual-heading-typeface"
          label={t(($) => $.settings.appearance.visual.headingTypeface.label)}
          description={t(($) => $.settings.appearance.visual.headingTypeface.description)}
          optionTestId={(id) => `settings-visual-heading-typeface-${id}`}
          typefaces={HEADING_TYPEFACES}
          stacks={VISUAL_TYPEFACE_STACKS}
          textFont={visualTextFont}
        />
        <FontRow
          settingKey="visualHeadingFontFamily"
          use="app"
          testId="settings-row-visual-heading-font"
          label={t(($) => $.settings.appearance.visual.headingFont.label)}
          description={t(($) => $.settings.appearance.visual.headingFont.description)}
        />
        <ChoiceRow
          settingKey="visualHeadingSize"
          testId="settings-row-visual-heading-size"
          label={t(($) => $.settings.appearance.visual.headingSize.label)}
          description={t(($) => $.settings.appearance.visual.headingSize.description)}
          options={HEADING_SIZES}
          optionLabel={(option) => t(($) => $.settings.appearance.text.headingSizes[option])}
        />
        <ColorChoiceRow
          settingKey="visualHeadingColor"
          testId="settings-row-visual-heading-color"
          testIdPrefix="settings-visual-heading-color"
          matchTestId="settings-visual-heading-color-theme"
          label={t(($) => $.settings.appearance.visual.headingColor.label)}
          description={t(($) => $.settings.appearance.visual.headingColor.description)}
          matchLabel={t(($) => $.settings.appearance.visual.headingColor.matchTheme)}
          matchColor={resolvedEditorColor("heading")}
          customAriaLabel={t(($) => $.settings.appearance.visual.headingColor.customAriaLabel)}
        />
      </SettingsGroup>

      <SettingsGroup title={t(($) => $.settings.appearance.visual.layout.title)}>
        <WidthCards
          settingKey="visualTextWidth"
          testId="settings-row-visual-width"
          label={t(($) => $.settings.appearance.visual.width.label)}
          description={t(($) => $.settings.appearance.visual.width.description)}
          columns={4}
          optionTestId={(id) => `settings-visual-width-${id}`}
          options={VISUAL_TEXT_WIDTHS.map((id) => ({
            id,
            label: t(($) => $.settings.appearance.visual.width.options[id]),
            inset: WIDTH_PAGES[id],
          }))}
        />
        <ToggleRow
          settingKey="visualMarkdown"
          testId="settings-row-visual-markdown"
          label={t(($) => $.settings.appearance.visual.markdown.label)}
          description={t(($) => $.settings.appearance.visual.markdown.description)}
        />
      </SettingsGroup>
    </AppearanceTabLayout>
  );
}

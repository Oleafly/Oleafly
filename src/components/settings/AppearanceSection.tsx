import { useEffect, useRef, useState, type FormEvent, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { DotPattern } from "@/components/ui/dot-pattern";
import { GridPattern } from "@/components/ui/grid-pattern";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { i18n } from "@/i18n";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  ACCENTS,
  APP_FONTS,
  BROWSER_SEARCH_ENGINES,
  EDITOR_FONTS,
  EDITOR_THEMES,
  TERMINAL_COLOR_THEMES,
  TERMINAL_FONTS,
  type BrowserSearchEngineId,
  type TerminalColorThemeId,
  type TerminalCursorStyle,
  useSettingsStore,
} from "@/store/settings";
import { LAYOUT_OPTIONS } from "@/components/layout/TopToolbar";
import { ThemeSegmentedControl } from "@/components/layout/ThemeControls";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { BrowserCookieImport } from "@/components/settings/BrowserCookieImport";
import { SearchEngineIcon } from "@/components/settings/SearchEngineIcon";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import { ThemeCustomization } from "@/components/settings/ThemeCustomization";

const APPEARANCE_TABS = [
  { id: "app", label: () => i18n.t(($) => $.settings.appearance.tabs.app) },
  { id: "editor", label: () => i18n.t(($) => $.settings.appearance.tabs.editor) },
  { id: "terminal", label: () => i18n.t(($) => $.settings.appearance.tabs.terminal) },
  { id: "pdf", label: () => i18n.t(($) => $.settings.appearance.tabs.pdf) },
  { id: "browser", label: () => i18n.t(($) => $.settings.appearance.tabs.browser) },
  { id: "files", label: () => i18n.t(($) => $.settings.appearance.tabs.files) },
] as const;

type AppearanceTabId = (typeof APPEARANCE_TABS)[number]["id"];

function AppAppearanceTab() {
  const { t } = useTranslation(["common", "settings"]);
  const { preference, setPreference } = useTheme();
  const dockPlacement = useSettingsStore((state) => state.dockPlacement);
  const setDockPlacement = useSettingsStore((state) => state.setDockPlacement);
  const bgPattern = useSettingsStore((state) => state.bgPattern);
  const setBgPattern = useSettingsStore((state) => state.setBgPattern);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const setAccentColor = useSettingsStore((state) => state.setAccentColor);
  const appFontSize = useSettingsStore((state) => state.appFontSize);
  const setAppFontSize = useSettingsStore((state) => state.setAppFontSize);
  const appFontFamily = useSettingsStore((state) => state.appFontFamily);
  const setAppFontFamily = useSettingsStore((state) => state.setAppFontFamily);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="text-sm font-medium">
          {t(($) => $.settings.appearance.app.dock.label)}
        </div>
        <div className="mb-2 text-xs text-muted-foreground">
          {t(($) => $.settings.appearance.app.dock.description)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "left", label: t(($) => $.settings.appearance.app.dock.left) },
              { id: "bottom", label: t(($) => $.settings.appearance.app.dock.bottom) },
              { id: "right", label: t(($) => $.settings.appearance.app.dock.right) },
            ] as const
          ).map((option) => {
            const active = dockPlacement === option.id;
            return (
              <button
                type="button"
                key={option.id}
                data-testid={`settings-dock-placement-${option.id}`}
                onClick={() => setDockPlacement(option.id)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-md border p-3 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent",
                )}
              >
                <div className="relative h-14 w-full overflow-hidden rounded bg-muted">
                  {option.id === "left" ? (
                    <div className="absolute inset-y-1 left-1 w-2 rounded bg-foreground/30" />
                  ) : null}
                  {option.id === "right" ? (
                    <div className="absolute inset-y-1 right-1 w-2 rounded bg-foreground/30" />
                  ) : null}
                  {option.id === "bottom" ? (
                    <div className="absolute inset-x-0 bottom-1 mx-auto h-2 w-10 rounded bg-foreground/30" />
                  ) : null}
                </div>
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="text-sm font-medium">
          {t(($) => $.settings.appearance.app.bgPattern.label)}
        </div>
        <div className="mb-2 text-xs text-muted-foreground">
          {t(($) => $.settings.appearance.app.bgPattern.description)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "dots", label: t(($) => $.settings.appearance.app.bgPattern.dots) },
              { id: "grid", label: t(($) => $.settings.appearance.app.bgPattern.grid) },
              { id: "none", label: t(($) => $.common.state.none) },
            ] as const
          ).map((option) => {
            const active = bgPattern === option.id;
            return (
              <button
                type="button"
                key={option.id}
                data-testid={`settings-bg-pattern-${option.id}`}
                onClick={() => setBgPattern(option.id)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-md border p-3 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent",
                )}
              >
                <div className="relative h-14 w-full overflow-hidden rounded bg-[var(--home-background)]">
                  {option.id === "dots" ? (
                    <DotPattern width={10} height={10} radius={0.75} />
                  ) : option.id === "grid" ? (
                    <GridPattern width={10} height={10} />
                  ) : null}
                </div>
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="text-sm font-medium">
          {t(($) => $.settings.appearance.app.accent.label)}
        </div>
        <div className="mb-2 text-xs text-muted-foreground">
          {t(($) => $.settings.appearance.app.accent.description)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((accent) => {
            const active = accentColor === accent.color;
            return (
              <button
                type="button"
                key={accent.id}
                title={accent.name}
                aria-label={t(($) => $.settings.appearance.app.accent.swatchAriaLabel, {
                  name: accent.name,
                })}
                aria-pressed={active}
                onClick={() => setAccentColor(accent.color)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border transition-transform hover:scale-110",
                  active
                    ? "border-foreground ring-1 ring-foreground/20"
                    : "border-border",
                )}
                style={{ backgroundColor: accent.color }}
              >
                {active ? <Check className="size-3.5 text-white drop-shadow" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-testid="settings-row-appearance"
        className="rounded-lg border bg-card p-3"
      >
        <div className="text-sm font-medium">
          {t(($) => $.settings.appearance.app.theme.label)}
        </div>
        <div className="mb-2 text-xs text-muted-foreground">
          {t(($) => $.settings.appearance.app.theme.description)}
        </div>
        <ThemeSegmentedControl
          preference={preference}
          onChange={setPreference}
          testIdPrefix="settings-appearance"
        />
      </div>

      <div
        data-testid="settings-row-app-font-size"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.app.fontSize.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.app.fontSize.description)}
          </div>
        </div>
        <Select
          value={String(appFontSize)}
          onValueChange={(value) => setAppFontSize(Number(value))}
        >
          <SelectTrigger className="w-[88px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {[13, 14, 15, 16, 17, 18, 20].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t(($) => $.settings.appearance.fontSizeOption, { size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        data-testid="settings-row-app-font"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.app.font.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.app.font.description)}
          </div>
        </div>
        <Select
          value={appFontFamily || "__default__"}
          onValueChange={(value) =>
            setAppFontFamily(value === "__default__" ? "" : value)
          }
        >
          <SelectTrigger className="w-[168px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {APP_FONTS.map((font) => (
              <SelectItem
                key={font.name}
                value={font.value || "__default__"}
              >
                {font.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ThemeCustomization />
    </div>
  );
}

function EditorAppearanceTab() {
  const { t } = useTranslation(["common", "settings"]);
  const vim = useSettingsStore((state) => state.vim);
  const toggleVim = useSettingsStore((state) => state.toggleVim);
  const editorAutocomplete = useSettingsStore((state) => state.editorAutocomplete);
  const setEditorAutocomplete = useSettingsStore((state) => state.setEditorAutocomplete);
  const editorAutoCloseBrackets = useSettingsStore(
    (state) => state.editorAutoCloseBrackets,
  );
  const setEditorAutoCloseBrackets = useSettingsStore(
    (state) => state.setEditorAutoCloseBrackets,
  );
  const editorAutoCloseMath = useSettingsStore(
    (state) => state.editorAutoCloseMath,
  );
  const setEditorAutoCloseMath = useSettingsStore(
    (state) => state.setEditorAutoCloseMath,
  );
  const editorAutoCloseEnvironments = useSettingsStore(
    (state) => state.editorAutoCloseEnvironments,
  );
  const setEditorAutoCloseEnvironments = useSettingsStore(
    (state) => state.setEditorAutoCloseEnvironments,
  );
  const editorGhostCompletion = useSettingsStore(
    (state) => state.editorGhostCompletion,
  );
  const setEditorGhostCompletion = useSettingsStore(
    (state) => state.setEditorGhostCompletion,
  );
  const editorNonBlinkingCursor = useSettingsStore(
    (state) => state.editorNonBlinkingCursor,
  );
  const setEditorNonBlinkingCursor = useSettingsStore(
    (state) => state.setEditorNonBlinkingCursor,
  );
  const editorStickyScroll = useSettingsStore((state) => state.editorStickyScroll);
  const setEditorStickyScroll = useSettingsStore(
    (state) => state.setEditorStickyScroll,
  );
  const editorFontSize = useSettingsStore((state) => state.editorFontSize);
  const setEditorFontSize = useSettingsStore((state) => state.setEditorFontSize);
  const editorFontFamily = useSettingsStore((state) => state.editorFontFamily);
  const setEditorFontFamily = useSettingsStore((state) => state.setEditorFontFamily);
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const setEditorTheme = useSettingsStore((state) => state.setEditorTheme);

  return (
    <div className="space-y-3">
      <div
        data-testid="settings-row-editor-font-size"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.editor.fontSize.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.editor.fontSize.description)}
          </div>
        </div>
        <Select
          value={String(editorFontSize)}
          onValueChange={(value) => setEditorFontSize(Number(value))}
        >
          <SelectTrigger className="w-[88px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {[11, 12, 13, 14, 15, 16, 18, 20].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t(($) => $.settings.appearance.fontSizeOption, { size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        data-testid="settings-row-editor-font"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.editor.font.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.editor.font.description)}
          </div>
        </div>
        <Select
          value={editorFontFamily || "__default__"}
          onValueChange={(value) =>
            setEditorFontFamily(value === "__default__" ? "" : value)
          }
        >
          <SelectTrigger className="w-[168px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {EDITOR_FONTS.map((font) => (
              <SelectItem
                key={font.name}
                value={font.value || "__default__"}
              >
                {font.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        data-testid="settings-row-editor-theme"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.editor.theme.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.editor.theme.description)}
          </div>
        </div>
        <Select
          value={editorTheme}
          onValueChange={(value) => setEditorTheme(value as typeof editorTheme)}
        >
          <SelectTrigger className="w-[168px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {EDITOR_THEMES.map((editorThemeOption) => (
              <SelectItem
                key={editorThemeOption.id}
                value={editorThemeOption.id}
              >
                {editorThemeOption.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.vim.label)}
        description={t(($) => $.settings.appearance.editor.vim.description)}
        checked={vim}
        onChange={toggleVim}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.autocomplete.label)}
        description={t(($) => $.settings.appearance.editor.autocomplete.description)}
        checked={editorAutocomplete}
        onChange={setEditorAutocomplete}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.autoCloseBrackets.label)}
        description={t(($) => $.settings.appearance.editor.autoCloseBrackets.description)}
        checked={editorAutoCloseBrackets}
        onChange={setEditorAutoCloseBrackets}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.autoCloseMath.label)}
        description={t(($) => $.settings.appearance.editor.autoCloseMath.description)}
        checked={editorAutoCloseMath}
        onChange={setEditorAutoCloseMath}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.autoCloseEnvironments.label)}
        description={t(($) => $.settings.appearance.editor.autoCloseEnvironments.description)}
        checked={editorAutoCloseEnvironments}
        onChange={setEditorAutoCloseEnvironments}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.ghostCompletion.label)}
        description={t(($) => $.settings.appearance.editor.ghostCompletion.description)}
        checked={editorGhostCompletion}
        onChange={setEditorGhostCompletion}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.nonBlinkingCursor.label)}
        description={t(($) => $.settings.appearance.editor.nonBlinkingCursor.description)}
        checked={editorNonBlinkingCursor}
        onChange={setEditorNonBlinkingCursor}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.editor.stickyScroll.label)}
        description={t(($) => $.settings.appearance.editor.stickyScroll.description)}
        checked={editorStickyScroll}
        onChange={setEditorStickyScroll}
      />
    </div>
  );
}

function TerminalAppearanceTab() {
  const { t } = useTranslation(["common", "settings"]);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore(
    (state) => state.setTerminalFontSize,
  );
  const terminalFontFamily = useSettingsStore(
    (state) => state.terminalFontFamily,
  );
  const setTerminalFontFamily = useSettingsStore(
    (state) => state.setTerminalFontFamily,
  );
  const terminalFontWeight = useSettingsStore(
    (state) => state.terminalFontWeight,
  );
  const setTerminalFontWeight = useSettingsStore(
    (state) => state.setTerminalFontWeight,
  );
  const terminalFontWeightBold = useSettingsStore(
    (state) => state.terminalFontWeightBold,
  );
  const setTerminalFontWeightBold = useSettingsStore(
    (state) => state.setTerminalFontWeightBold,
  );
  const terminalCursorStyle = useSettingsStore(
    (state) => state.terminalCursorStyle,
  );
  const setTerminalCursorStyle = useSettingsStore(
    (state) => state.setTerminalCursorStyle,
  );
  const terminalCursorBlink = useSettingsStore(
    (state) => state.terminalCursorBlink,
  );
  const setTerminalCursorBlink = useSettingsStore(
    (state) => state.setTerminalCursorBlink,
  );
  const terminalStartWithProject = useSettingsStore(
    (state) => state.terminalStartWithProject,
  );
  const setTerminalStartWithProject = useSettingsStore(
    (state) => state.setTerminalStartWithProject,
  );
  const terminalColorTheme = useSettingsStore(
    (state) => state.terminalColorTheme,
  );
  const followsAppTheme = terminalColorTheme === "system";
  const setTerminalColorTheme = useSettingsStore(
    (state) => state.setTerminalColorTheme,
  );
  const terminalBackground = useSettingsStore(
    (state) => state.terminalBackground,
  );
  const setTerminalBackground = useSettingsStore(
    (state) => state.setTerminalBackground,
  );
  const terminalForeground = useSettingsStore(
    (state) => state.terminalForeground,
  );
  const setTerminalForeground = useSettingsStore(
    (state) => state.setTerminalForeground,
  );
  const terminalCursorColor = useSettingsStore(
    (state) => state.terminalCursorColor,
  );
  const setTerminalCursorColor = useSettingsStore(
    (state) => state.setTerminalCursorColor,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.terminal.fontSize.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.terminal.fontSize.description)}
          </div>
        </div>
        <Select
          value={String(terminalFontSize)}
          onValueChange={(value) => setTerminalFontSize(Number(value))}
        >
          <SelectTrigger
            className="w-[88px]"
            aria-label={t(($) => $.settings.appearance.terminal.fontSize.label)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {[11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t(($) => $.settings.appearance.fontSizeOption, { size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.terminal.font.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.terminal.font.description)}
          </div>
        </div>
        <Select value={terminalFontFamily} onValueChange={setTerminalFontFamily}>
          <SelectTrigger
            className="w-[168px]"
            aria-label={t(($) => $.settings.appearance.terminal.font.ariaLabel)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {TERMINAL_FONTS.map((font) => (
              <SelectItem key={font.name} value={font.value}>
                {font.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.terminal.fontWeight.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.terminal.fontWeight.description)}
          </div>
        </div>
        <Select
          value={String(terminalFontWeight)}
          onValueChange={(value) => setTerminalFontWeight(Number(value))}
        >
          <SelectTrigger
            className="w-[100px]"
            aria-label={t(($) => $.settings.appearance.terminal.fontWeight.label)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {[400, 500, 600, 700].map((weight) => (
              <SelectItem key={weight} value={String(weight)}>
                {weight}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.terminal.fontWeightBold.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.terminal.fontWeightBold.description)}
          </div>
        </div>
        <Select
          value={String(terminalFontWeightBold)}
          onValueChange={(value) => setTerminalFontWeightBold(Number(value))}
        >
          <SelectTrigger
            className="w-[100px]"
            aria-label={t(($) => $.settings.appearance.terminal.fontWeightBold.label)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {[600, 700, 800, 900].map((weight) => (
              <SelectItem key={weight} value={String(weight)}>
                {weight}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.terminal.cursorStyle.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.terminal.cursorStyle.description)}
          </div>
        </div>
        <Select
          value={terminalCursorStyle}
          onValueChange={(value) =>
            setTerminalCursorStyle(value as TerminalCursorStyle)
          }
        >
          <SelectTrigger
            className="w-[120px]"
            aria-label={t(($) => $.settings.appearance.terminal.cursorStyle.ariaLabel)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value="block">
              {t(($) => $.settings.appearance.terminal.cursorStyle.block)}
            </SelectItem>
            <SelectItem value="underline">
              {t(($) => $.settings.appearance.terminal.cursorStyle.underline)}
            </SelectItem>
            <SelectItem value="bar">
              {t(($) => $.settings.appearance.terminal.cursorStyle.bar)}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <SettingsToggleRow
        label={t(($) => $.settings.appearance.terminal.cursorBlink.label)}
        description={t(($) => $.settings.appearance.terminal.cursorBlink.description)}
        checked={terminalCursorBlink}
        onChange={setTerminalCursorBlink}
      />

      <SettingsToggleRow
        label={t(($) => $.settings.appearance.terminal.startWithProject.label)}
        description={t(($) => $.settings.appearance.terminal.startWithProject.description)}
        checked={terminalStartWithProject}
        onChange={setTerminalStartWithProject}
      />

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.terminal.colorTheme.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.terminal.colorTheme.description)}
          </div>
        </div>
        <Select
          value={terminalColorTheme}
          onValueChange={(value) =>
            setTerminalColorTheme(value as TerminalColorThemeId)
          }
        >
          <SelectTrigger
            className="w-[180px]"
            aria-label={t(($) => $.settings.appearance.terminal.colorTheme.ariaLabel)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {Object.values(TERMINAL_COLOR_THEMES).map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.appearance === "system"
                  ? theme.name
                  : theme.appearance === "light"
                    ? t(($) => $.settings.appearance.terminal.colorTheme.optionLight, {
                        name: theme.name,
                      })
                    : t(($) => $.settings.appearance.terminal.colorTheme.optionDark, {
                        name: theme.name,
                      })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="text-sm font-medium">
          {t(($) => $.settings.appearance.terminal.colors.label)}
        </div>
        <div className="mb-3 text-xs text-muted-foreground">
          {followsAppTheme
            ? t(($) => $.settings.appearance.terminal.colors.followingAppTheme)
            : t(($) => $.settings.appearance.terminal.colors.description)}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>{t(($) => $.settings.appearance.terminal.colors.background)}</span>
            <input
              type="color"
              aria-label={t(
                ($) => $.settings.appearance.terminal.colors.backgroundAriaLabel,
              )}
              disabled={followsAppTheme}
              value={terminalBackground}
              onChange={(event) => setTerminalBackground(event.target.value)}
              className="size-8 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>{t(($) => $.settings.appearance.terminal.colors.foreground)}</span>
            <input
              type="color"
              aria-label={t(
                ($) => $.settings.appearance.terminal.colors.foregroundAriaLabel,
              )}
              disabled={followsAppTheme}
              value={terminalForeground}
              onChange={(event) => setTerminalForeground(event.target.value)}
              className="size-8 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>{t(($) => $.settings.appearance.terminal.colors.cursor)}</span>
            <input
              type="color"
              aria-label={t(($) => $.settings.appearance.terminal.colors.cursorAriaLabel)}
              disabled={followsAppTheme}
              value={terminalCursorColor}
              onChange={(event) => setTerminalCursorColor(event.target.value)}
              className="size-8 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function BrowserAppearanceTab() {
  const { t } = useTranslation(["common", "settings"]);
  const browserSearchEngine = useSettingsStore(
    (state) => state.browserSearchEngine,
  );
  const setBrowserSearchEngine = useSettingsStore(
    (state) => state.setBrowserSearchEngine,
  );
  const browserHomePage = useSettingsStore((state) => state.browserHomePage);
  const setBrowserHomePage = useSettingsStore(
    (state) => state.setBrowserHomePage,
  );
  const [homePageDraft, setHomePageDraft] = useState(browserHomePage);
  useEffect(() => {
    setHomePageDraft(browserHomePage);
  }, [browserHomePage]);
  const selectedSearchEngine =
    BROWSER_SEARCH_ENGINES.find(({ id }) => id === browserSearchEngine) ??
    BROWSER_SEARCH_ENGINES[0];
  const saveHomePage = () => {
    setBrowserHomePage(homePageDraft);
    setHomePageDraft(useSettingsStore.getState().browserHomePage);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.browser.searchEngine.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.browser.searchEngine.description)}
          </div>
        </div>
        <Select
          value={browserSearchEngine}
          onValueChange={(value) =>
            setBrowserSearchEngine(value as BrowserSearchEngineId)
          }
        >
          <SelectTrigger
            className="w-44"
            aria-label={t(($) => $.settings.appearance.browser.searchEngine.label)}
          >
            <SelectValue>
              <span className="flex items-center gap-2">
                <SearchEngineIcon engine={selectedSearchEngine.id} />
                <span>{selectedSearchEngine.name}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {BROWSER_SEARCH_ENGINES.map((engine) => (
              <SelectItem
                key={engine.id}
                value={engine.id}
                data-testid={`search-engine-option-${engine.id}`}
                icon={<SearchEngineIcon engine={engine.id} />}
              >
                {engine.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <label htmlFor="browser-home-page" className="text-sm font-medium">
          {t(($) => $.settings.appearance.browser.homePage.label)}
        </label>
        <div className="mb-2 text-xs text-muted-foreground">
          {t(($) => $.settings.appearance.browser.homePage.description)}
        </div>
        <Input
          id="browser-home-page"
          aria-label={t(($) => $.settings.appearance.browser.homePage.ariaLabel)}
          value={homePageDraft}
          onChange={(event) => setHomePageDraft(event.target.value)}
          onBlur={saveHomePage}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            saveHomePage();
          }}
          placeholder={"https://www.google.com/"}
        />
      </div>

      <BrowserCookieImport />
    </div>
  );
}

function PdfPreviewTab() {
  const { t } = useTranslation(["common", "settings"]);
  const pdfDarkMode = useSettingsStore((state) => state.pdfDarkMode);
  const setPdfDarkMode = useSettingsStore((state) => state.setPdfDarkMode);
  const pdfZoomShortcuts = useSettingsStore((state) => state.pdfZoomShortcuts);
  const setPdfZoomShortcuts = useSettingsStore(
    (state) => state.setPdfZoomShortcuts,
  );
  const hoverPreview = useSettingsStore((state) => state.hoverPreview);
  const setHoverPreview = useSettingsStore((state) => state.setHoverPreview);

  return (
    <div className="space-y-3">
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.preview.darkMode.label)}
        description={t(($) => $.settings.appearance.preview.darkMode.description)}
        checked={pdfDarkMode}
        onChange={setPdfDarkMode}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.preview.zoomShortcuts.label)}
        description={t(($) => $.settings.appearance.preview.zoomShortcuts.description)}
        checked={pdfZoomShortcuts}
        onChange={setPdfZoomShortcuts}
      />
      <SettingsToggleRow
        label={t(($) => $.settings.appearance.preview.hoverPreview.label)}
        description={t(($) => $.settings.appearance.preview.hoverPreview.description)}
        checked={hoverPreview}
        onChange={setHoverPreview}
      />
    </div>
  );
}

function FileManagementTab() {
  const { t } = useTranslation(["common", "settings"]);
  const homeProjectLayout = useSettingsStore((state) => state.homeProjectLayout);
  const setHomeProjectLayout = useSettingsStore(
    (state) => state.setHomeProjectLayout,
  );
  const defaultView = useSettingsStore((state) => state.defaultView);
  const setDefaultView = useSettingsStore((state) => state.setDefaultView);
  const openInTree = useSettingsStore((state) => state.openInTree);
  const setOpenInTree = useSettingsStore((state) => state.setOpenInTree);
  const hiddenFilePatterns = useSettingsStore((state) => state.hiddenFilePatterns);
  const addHiddenFilePattern = useSettingsStore(
    (state) => state.addHiddenFilePattern,
  );
  const removeHiddenFilePattern = useSettingsStore(
    (state) => state.removeHiddenFilePattern,
  );
  const [pattern, setPattern] = useState("");

  const submitPattern = (event: FormEvent) => {
    event.preventDefault();
    const nextPattern = pattern.trim();
    if (!nextPattern) return;
    addHiddenFilePattern(nextPattern);
    setPattern("");
  };

  return (
    <div className="space-y-3">
      <div
        data-testid="settings-row-default-home-view"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.files.homeView.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.files.homeView.description)}
          </div>
        </div>
        <Select
          value={homeProjectLayout}
          onValueChange={(value) =>
            setHomeProjectLayout(value as typeof homeProjectLayout)
          }
        >
          <SelectTrigger
            className="w-[140px]"
            aria-label={t(($) => $.settings.appearance.files.homeView.label)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value="grid">
              {t(($) => $.settings.appearance.files.homeView.grid)}
            </SelectItem>
            <SelectItem value="list">
              {t(($) => $.settings.appearance.files.homeView.list)}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        data-testid="settings-row-open-projects-in"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {t(($) => $.settings.appearance.files.openIn.label)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(($) => $.settings.appearance.files.openIn.description)}
          </div>
        </div>
        <Select
          value={defaultView}
          onValueChange={(value) => setDefaultView(value as typeof defaultView)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {LAYOUT_OPTIONS.map((option) => (
              <SelectItem key={option.preset} value={option.preset}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SettingsToggleRow
        label={t(($) => $.settings.appearance.files.showTree.label)}
        description={t(($) => $.settings.appearance.files.showTree.description)}
        checked={openInTree}
        onChange={setOpenInTree}
      />

      <section className="rounded-lg border bg-card p-4" aria-labelledby="hidden-files-heading">
        <h3 id="hidden-files-heading" className="text-sm font-medium">
          {t(($) => $.settings.appearance.files.hidden.title)}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(($) => $.settings.appearance.files.hidden.description)}
        </p>

        <form onSubmit={submitPattern} className="mt-4 flex gap-2">
          <Input
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder={t(($) => $.settings.appearance.files.hidden.placeholder)}
            aria-label={t(($) => $.settings.appearance.files.hidden.inputAriaLabel)}
          />
          <Button
            type="submit"
            variant="outline"
            size="icon"
            aria-label={t(($) => $.settings.appearance.files.hidden.addAriaLabel)}
            disabled={!pattern.trim()}
            className="shrink-0 text-muted-foreground"
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </form>

        <div className="mt-4 divide-y" data-testid="hidden-file-pattern-list">
          {hiddenFilePatterns.map((hiddenPattern) => (
            <div
              key={hiddenPattern}
              className="flex min-h-9 items-center justify-between gap-3 py-2 text-sm"
            >
              <code className="break-all text-xs text-muted-foreground">
                {hiddenPattern}
              </code>
              <Button
                type="button"
                variant="ghostPrimary"
                size="xs"
                onClick={() => removeHiddenFilePattern(hiddenPattern)}
                className="shrink-0"
                aria-label={t(
                  ($) => $.settings.appearance.files.hidden.removeAriaLabel,
                  { pattern: hiddenPattern },
                )}
              >
                {t(($) => $.common.actions.remove)}
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function isAppearanceTab(value: unknown): value is AppearanceTabId {
  return APPEARANCE_TABS.some((tab) => tab.id === value);
}

export function AppearanceSection() {
  const { t } = useTranslation(["common", "settings"]);
  const requestedTab = useSettingsStore((state) => state.settingsInitialAppearanceTab);
  const setRequestedTab = useSettingsStore((state) => state.setSettingsInitialAppearanceTab);
  const [activeTab, setActiveTab] = useState<AppearanceTabId>(() =>
    isAppearanceTab(requestedTab) ? requestedTab : "app",
  );
  useEffect(() => {
    if (!isAppearanceTab(requestedTab)) return;
    setActiveTab(requestedTab);
    setRequestedTab(null);
  }, [requestedTab, setRequestedTab]);
  const resetAppearancePreferences = useSettingsStore(
    (state) => state.resetAppearancePreferences,
  );
  const { setPreference } = useTheme();
  const tabRefs = useRef<
    Partial<Record<AppearanceTabId, HTMLButtonElement | null>>
  >({});

  useEffect(() => {
    tabRefs.current[activeTab]?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTab]);

  const scrollTabs = (event: WheelEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    if (
      list.scrollWidth <= list.clientWidth ||
      Math.abs(event.deltaX) >= Math.abs(event.deltaY)
    ) {
      return;
    }
    list.scrollLeft += event.deltaY;
  };

  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as AppearanceTabId)}
        className="space-y-4"
      >
        <TabsList
          className="flex h-auto w-fit max-w-full justify-start gap-1 overflow-x-auto no-scrollbar"
          data-testid="appearance-tab-strip"
          onWheel={scrollTabs}
        >
          {APPEARANCE_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              value={tab.id}
              data-testid={`appearance-tab-${tab.id}`}
              className="shrink-0"
            >
              {tab.label()}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="app">
          <AppAppearanceTab />
        </TabsContent>
        <TabsContent value="editor">
          <EditorAppearanceTab />
        </TabsContent>
        <TabsContent value="terminal">
          <TerminalAppearanceTab />
        </TabsContent>
        <TabsContent value="pdf">
          <PdfPreviewTab />
        </TabsContent>
        <TabsContent value="browser">
          <BrowserAppearanceTab />
        </TabsContent>
        <TabsContent value="files">
          <FileManagementTab />
        </TabsContent>
      </Tabs>
      <ResetToDefaults
        sectionName={t(($) => $.settings.appearance.sectionName)}
        onReset={() => {
          resetAppearancePreferences();
          setPreference("system");
        }}
      />
    </div>
  );
}

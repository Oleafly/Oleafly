import { useEffect, useRef, useState, type FormEvent, type WheelEvent } from "react";
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
  { id: "app", label: "App" },
  { id: "editor", label: "Editor" },
  { id: "terminal", label: "Terminal" },
  { id: "pdf", label: "PDF Preview" },
  { id: "browser", label: "Browser" },
  { id: "files", label: "Project" },
] as const;

type AppearanceTabId = (typeof APPEARANCE_TABS)[number]["id"];

function AppAppearanceTab() {
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
        <div className="text-sm font-medium">Dock placement</div>
        <div className="mb-2 text-xs text-muted-foreground">
          Choose where the home screen dock sits.
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "left", label: "Left" },
              { id: "bottom", label: "Bottom" },
              { id: "right", label: "Right" },
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
        <div className="text-sm font-medium">Background pattern</div>
        <div className="mb-2 text-xs text-muted-foreground">
          Pick the pattern behind the project shelf.
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "dots", label: "Dots" },
              { id: "grid", label: "Grid" },
              { id: "none", label: "None" },
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
        <div className="text-sm font-medium">Accent color</div>
        <div className="mb-2 text-xs text-muted-foreground">
          Used for buttons, selections, and the editor cursor.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((accent) => {
            const active = accentColor === accent.color;
            return (
              <button
                type="button"
                key={accent.id}
                title={accent.name}
                aria-label={`${accent.name} accent`}
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
        <div className="text-sm font-medium">Appearance</div>
        <div className="mb-2 text-xs text-muted-foreground">
          System follows the operating system and changes when it does.
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
          <div className="text-sm font-medium">App font size</div>
          <div className="text-xs text-muted-foreground">
            Scale text across menus, panels, and buttons.
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
                {size}px
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
          <div className="text-sm font-medium">App font</div>
          <div className="text-xs text-muted-foreground">
            Uses the system fallback when a font is not installed.
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
          <div className="text-sm font-medium">Editor font size</div>
          <div className="text-xs text-muted-foreground">
            Set the source editor's text size.
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
                {size}px
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
          <div className="text-sm font-medium">Editor font</div>
          <div className="text-xs text-muted-foreground">
            Choose the monospace font used for source files.
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
          <div className="text-sm font-medium">Editor theme</div>
          <div className="text-xs text-muted-foreground">
            Set source syntax colors separately from the app theme.
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
        label="Vim mode"
        description="Use Vim keybindings in the source editor."
        checked={vim}
        onChange={toggleVim}
      />
      <SettingsToggleRow
        label="Auto-complete"
        description="Show code completions as you type. Ctrl+Space still opens them when this is off."
        checked={editorAutocomplete}
        onChange={setEditorAutocomplete}
      />
      <SettingsToggleRow
        label="Auto-close brackets"
        description="Insert closing brackets and parentheses automatically."
        checked={editorAutoCloseBrackets}
        onChange={setEditorAutoCloseBrackets}
      />
      <SettingsToggleRow
        label="Inline suggestion"
        description="Show the likely completion after the cursor. Press Tab to accept it."
        checked={editorGhostCompletion}
        onChange={setEditorGhostCompletion}
      />
      <SettingsToggleRow
        label="Non-blinking cursor"
        description="Keep the editor cursor solid."
        checked={editorNonBlinkingCursor}
        onChange={setEditorNonBlinkingCursor}
      />
      <SettingsToggleRow
        label="Sticky scroll"
        description="Keep the current LaTeX sections and environments at the top while you scroll."
        checked={editorStickyScroll}
        onChange={setEditorStickyScroll}
      />
    </div>
  );
}

function TerminalAppearanceTab() {
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
          <div className="text-sm font-medium">Terminal font size</div>
          <div className="text-xs text-muted-foreground">
            Set the text size in the terminal.
          </div>
        </div>
        <Select
          value={String(terminalFontSize)}
          onValueChange={(value) => setTerminalFontSize(Number(value))}
        >
          <SelectTrigger className="w-[88px]" aria-label="Terminal font size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {[11, 12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">Terminal font</div>
          <div className="text-xs text-muted-foreground">
            Choose the monospace font used by the terminal.
          </div>
        </div>
        <Select value={terminalFontFamily} onValueChange={setTerminalFontFamily}>
          <SelectTrigger className="w-[168px]" aria-label="Terminal font family">
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
          <div className="text-sm font-medium">Regular font weight</div>
          <div className="text-xs text-muted-foreground">
            Set the weight for regular terminal text.
          </div>
        </div>
        <Select
          value={String(terminalFontWeight)}
          onValueChange={(value) => setTerminalFontWeight(Number(value))}
        >
          <SelectTrigger className="w-[100px]" aria-label="Regular font weight">
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
          <div className="text-sm font-medium">Bold font weight</div>
          <div className="text-xs text-muted-foreground">
            Set the weight for bold terminal text.
          </div>
        </div>
        <Select
          value={String(terminalFontWeightBold)}
          onValueChange={(value) => setTerminalFontWeightBold(Number(value))}
        >
          <SelectTrigger className="w-[100px]" aria-label="Bold font weight">
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
          <div className="text-sm font-medium">Cursor style</div>
          <div className="text-xs text-muted-foreground">
            Choose the shape of the terminal cursor.
          </div>
        </div>
        <Select
          value={terminalCursorStyle}
          onValueChange={(value) =>
            setTerminalCursorStyle(value as TerminalCursorStyle)
          }
        >
          <SelectTrigger className="w-[120px]" aria-label="Terminal cursor style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value="block">Block</SelectItem>
            <SelectItem value="underline">Underline</SelectItem>
            <SelectItem value="bar">Bar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <SettingsToggleRow
        label="Blink cursor"
        description="Make the terminal cursor blink."
        checked={terminalCursorBlink}
        onChange={setTerminalCursorBlink}
      />

      <SettingsToggleRow
        label="Start shell with project"
        description="Start the shell when a project opens rather than the first time you show the terminal."
        checked={terminalStartWithProject}
        onChange={setTerminalStartWithProject}
      />

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-medium">Color theme</div>
          <div className="text-xs text-muted-foreground">
            Choose the terminal's ANSI color palette.
          </div>
        </div>
        <Select
          value={terminalColorTheme}
          onValueChange={(value) =>
            setTerminalColorTheme(value as TerminalColorThemeId)
          }
        >
          <SelectTrigger className="w-[180px]" aria-label="Terminal color theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {Object.values(TERMINAL_COLOR_THEMES).map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.name}
                {theme.appearance === "system"
                  ? ""
                  : theme.appearance === "light"
                    ? " · light"
                    : " · dark"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <div className="text-sm font-medium">Terminal colors</div>
        <div className="mb-3 text-xs text-muted-foreground">
          {followsAppTheme
            ? "Following the app theme: dark palette in dark mode, light palette in light mode. Pick a specific palette above to customize these."
            : "Adjust the base colors while keeping the selected ANSI palette."}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Background</span>
            <input
              type="color"
              aria-label="Terminal background color"
              disabled={followsAppTheme}
              value={terminalBackground}
              onChange={(event) => setTerminalBackground(event.target.value)}
              className="size-8 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Text</span>
            <input
              type="color"
              aria-label="Terminal foreground color"
              disabled={followsAppTheme}
              value={terminalForeground}
              onChange={(event) => setTerminalForeground(event.target.value)}
              className="size-8 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Cursor</span>
            <input
              type="color"
              aria-label="Terminal cursor color"
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
          <div className="text-sm font-medium">Default search engine</div>
          <div className="text-xs text-muted-foreground">
            Choose the search engine used for text searches.
          </div>
        </div>
        <Select
          value={browserSearchEngine}
          onValueChange={(value) =>
            setBrowserSearchEngine(value as BrowserSearchEngineId)
          }
        >
          <SelectTrigger className="w-44" aria-label="Default search engine">
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
          Home page
        </label>
        <div className="mb-2 text-xs text-muted-foreground">
          Choose the page that opens with the browser dock.
        </div>
        <Input
          id="browser-home-page"
          aria-label="Browser home page"
          value={homePageDraft}
          onChange={(event) => setHomePageDraft(event.target.value)}
          onBlur={saveHomePage}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            saveHomePage();
          }}
          placeholder="https://www.google.com/"
        />
      </div>

      <BrowserCookieImport />
    </div>
  );
}

function PdfPreviewTab() {
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
        label="PDF dark mode"
        description="Invert PDF colors by default. You can still switch colors from the preview toolbar."
        checked={pdfDarkMode}
        onChange={setPdfDarkMode}
      />
      <SettingsToggleRow
        label="PDF zoom shortcuts"
        description="Use Cmd/Ctrl +, -, and 0 to zoom the PDF instead of the app window."
        checked={pdfZoomShortcuts}
        onChange={setPdfZoomShortcuts}
      />
      <SettingsToggleRow
        label="Preview PDF on hover"
        description="Show the last compiled page when you hover over a project in the library."
        checked={hoverPreview}
        onChange={setHoverPreview}
      />
    </div>
  );
}

function FileManagementTab() {
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
          <div className="text-sm font-medium">Default home view</div>
          <div className="text-xs text-muted-foreground">
            Choose how projects are arranged in the library.
          </div>
        </div>
        <Select
          value={homeProjectLayout}
          onValueChange={(value) =>
            setHomeProjectLayout(value as typeof homeProjectLayout)
          }
        >
          <SelectTrigger className="w-[140px]" aria-label="Default home view">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            <SelectItem value="grid">Grid</SelectItem>
            <SelectItem value="list">List</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        data-testid="settings-row-open-projects-in"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
      >
        <div>
          <div className="text-sm font-medium">Open projects in</div>
          <div className="text-xs text-muted-foreground">
            Choose the layout used when a project opens.
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
        label="Show file tree on open"
        description="Open the source file tree whenever you enter a project."
        checked={openInTree}
        onChange={setOpenInTree}
      />

      <section className="rounded-lg border bg-card p-4" aria-labelledby="hidden-files-heading">
        <h3 id="hidden-files-heading" className="text-sm font-medium">
          Hide files from file tree
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose which generated files and folders stay out of the project tree.
        </p>

        <form onSubmit={submitPattern} className="mt-4 flex gap-2">
          <Input
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder="Add a file name or pattern"
            aria-label="File name or pattern to hide"
          />
          <Button
            type="submit"
            variant="outline"
            size="icon"
            aria-label="Add hidden file pattern"
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
                aria-label={`Remove ${hiddenPattern} from hidden files`}
              >
                Remove
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
              {tab.label}
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
        sectionName="Appearance"
        onReset={() => {
          resetAppearancePreferences();
          setPreference("system");
        }}
      />
    </div>
  );
}

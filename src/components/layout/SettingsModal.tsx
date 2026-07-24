import { useEffect, useState } from "react";
import {
  BookMarked,
  BookOpen,
  Bug,
  Check,
  ChevronRight,
  Cloud,
  Compass,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  FolderOpen,
  Github,
  Globe,
  HardDriveDownload,
  Keyboard,
  LifeBuoy,
  Palette,
  Plug,
  RotateCcw,
  RefreshCw,
  Scale,
  ScrollText,
  Settings,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { reportCrashToGithub } from "@/lib/crash-report";
import { isTauri } from "@tauri-apps/api/core";
import { platform as osPlatform, arch as osArch, version as osVersion } from "@tauri-apps/plugin-os";
import { Button } from "@/components/ui/button";
import { DotPattern } from "@/components/ui/dot-pattern";
import { GridPattern } from "@/components/ui/grid-pattern";
import { Tooltip } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { UpdateChecker } from "@/components/layout/UpdateChecker";
import { EngineSection } from "@/components/settings/EngineSection";
import { DownloadsSection } from "@/components/settings/DownloadsSection";
import { AISection } from "@/components/settings/AISection";
import { GitHubSection } from "@/components/settings/GitHubSection";
import { AlphaXivSection } from "@/components/settings/AlphaXivSection";
import { McpSection } from "@/components/settings/McpSection";
import { ShortcutsSection } from "@/components/settings/ShortcutsSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore, ACCENTS, APP_FONTS, EDITOR_FONTS, EDITOR_THEMES } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useDictionary } from "@/lib/dictionary";
import { useTheme } from "@/lib/theme";
import { appVersion, libraryRoot } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { LAYOUT_OPTIONS } from "@/components/layout/TopToolbar";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { startTour } from "@/lib/tour";
import { TOUR_IDS } from "@/lib/tours/registry";
import { useTourStore } from "@/store/tours";

type Section =
  | "appearance"
  | "general"
  | "dictionary"
  | "data"
  | "ai"
  | "engine"
  | "downloads"
  | "github"
  | "shortcuts"
  | "mcp"
  | "help";

const NAV: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "dictionary", label: "Dictionary", icon: BookMarked },
  { id: "data", label: "Data Storage", icon: Database },
  { id: "ai", label: "AI Assistant", icon: Sparkles },
  { id: "engine", label: "LaTeX Engine", icon: Cpu },
  { id: "downloads", label: "Offline & Downloads", icon: HardDriveDownload },
  { id: "github", label: "GitHub", icon: Github },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "help", label: "Help & About", icon: LifeBuoy },
];
const ADVANCED: Section[] = ["dictionary", "engine", "downloads", "data"];
const TOUR_SECTION_TARGETS: Partial<Record<Section, string>> = {
  general: "settings-general",
  appearance: "settings-appearance",
  dictionary: "settings-dictionary",
  data: "settings-data",
  ai: "settings-ai",
  engine: "settings-compiler",
  downloads: "settings-downloads",
  github: "settings-github",
  shortcuts: "settings-shortcuts",
  mcp: "settings-mcp",
  help: "settings-help",
};
const TOUR_LABELS = {
  home: "Home and project creation",
  workspace: "Project workspace",
  settings: "Settings",
  ai: "AI Assistant",
  diagram: "Diagram Composer",
} as const;

function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-600"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-1"
        )}
      />
    </span>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-background p-3 hover:bg-accent"
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
      </div>
      <Switch checked={checked} />
    </div>
  );
}

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen);
  const setOpen = useSettingsStore((s) => s.setSettingsOpen);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const { theme, setTheme, toggleTheme } = useTheme();
  const vim = useSettingsStore((s) => s.vim);
  const toggleVim = useSettingsStore((s) => s.toggleVim);
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const toggleSpellcheck = useSettingsStore((s) => s.toggleSpellcheck);
  const harper = useSettingsStore((s) => s.harper);
  const setHarper = useSettingsStore((s) => s.setHarper);
  const showRegionalism = useSettingsStore((s) => s.showRegionalism);
  const setShowRegionalism = useSettingsStore((s) => s.setShowRegionalism);
  const showWordChoice = useSettingsStore((s) => s.showWordChoice);
  const setShowWordChoice = useSettingsStore((s) => s.setShowWordChoice);
  const offline = useSettingsStore((s) => s.offline);
  const setOffline = useSettingsStore((s) => s.setOffline);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const setAppFontSize = useSettingsStore((s) => s.setAppFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const setAppFontFamily = useSettingsStore((s) => s.setAppFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const setEditorFontFamily = useSettingsStore((s) => s.setEditorFontFamily);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const setEditorTheme = useSettingsStore((s) => s.setEditorTheme);
  const defaultView = useSettingsStore((s) => s.defaultView);
  const setDefaultView = useSettingsStore((s) => s.setDefaultView);
  const openInTree = useSettingsStore((s) => s.openInTree);
  const hoverPreview = useSettingsStore((s) => s.hoverPreview);
  const setHoverPreview = useSettingsStore((s) => s.setHoverPreview);
  const setOpenInTree = useSettingsStore((s) => s.setOpenInTree);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  const dockPlacement = useSettingsStore((s) => s.dockPlacement);
  const setDockPlacement = useSettingsStore((s) => s.setDockPlacement);
  const bgPattern = useSettingsStore((s) => s.bgPattern);
  const setBgPattern = useSettingsStore((s) => s.setBgPattern);

  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshTree = useFilesStore((s) => s.refreshTree);

  const [section, setSection] = useState<Section>("general");
  const [libRoot, setLibRoot] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [tourConfirmation, setTourConfirmation] = useState<"disable" | "dismiss-all" | null>(
    null,
  );
  const [tourGuidesOpen, setTourGuidesOpen] = useState(false);
  const toursEnabled = useTourStore((s) => s.enabled);
  const tours = useTourStore((s) => s.tours);
  const completedTours = TOUR_IDS.filter((id) => tours[id].status === "completed").length;
  const dismissedTours = TOUR_IDS.filter((id) => tours[id].status === "dismissed").length;
  const [showAdvanced, setShowAdvanced] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("ol-settings-advanced") === "1",
  );
  const setAdvanced = (v: boolean) => {
    setShowAdvanced(v);
    try { localStorage.setItem("ol-settings-advanced", v ? "1" : "0"); } catch { /* ignore */ }
    if (!v && ADVANCED.includes(section)) setSection("general");
  };
  const settingsInitialSection = useSettingsStore((s) => s.settingsInitialSection);
  const closeSettings = () => {
    if (useTourStore.getState().activeTourId === "settings") return;
    setOpen(false);
    useSettingsStore.getState().setSettingsInitialSection("general");
  };
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(
    open,
    closeSettings,
  );

  const doReset = () => {
    resetToDefaults();
    setTheme(
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
    setConfirmReset(false);
  };

  useEffect(() => {
    if (!open) return;
    const next = NAV.some((item) => item.id === settingsInitialSection)
      ? (settingsInitialSection as Section)
      : "general";
    setSection(next);
    // Deep-links into advanced sections must surface them in the nav.
    if (ADVANCED.includes(next)) {
      setShowAdvanced(true);
      try { localStorage.setItem("ol-settings-advanced", "1"); } catch {}
    }
    void libraryRoot().then(setLibRoot).catch(() => {});
  }, [open, settingsInitialSection]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <button type="button" aria-label="Close settings" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        data-modal-initial-focus
        aria-modal="true"
        aria-label="Settings"
        className="relative flex h-[min(620px,86vh)] w-[min(820px,94vw)] overflow-hidden rounded-xl border bg-background shadow-2xl outline-none"
      >
        <nav
          aria-label="Settings sections"
          data-tour="settings-navigation-panel"
          className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-3"
        >
          <div className="flex flex-col gap-0.5">
            <div data-tour="settings-navigation" className="mb-2 px-2 text-sm font-semibold">Settings</div>
            {NAV.filter(({ id }) => showAdvanced || !ADVANCED.includes(id)).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              data-testid={`settings-section-${id}`}
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                section === id
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
            ))}
          </div>
          <div
            role="switch"
            aria-checked={showAdvanced}
            aria-label="Show advanced settings"
            data-testid="settings-toggle-advanced"
            tabIndex={0}
            onClick={() => setAdvanced(!showAdvanced)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAdvanced(!showAdvanced);
              }
            }}
            className="mt-auto flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          >
            <span>Show Advanced</span>
            <Switch checked={showAdvanced} />
          </div>
        </nav>

        <div
          data-tour={
            TOUR_SECTION_TARGETS[section]
              ? `${TOUR_SECTION_TARGETS[section]}-panel`
              : undefined
          }
          className="flex min-w-0 flex-1 flex-col bg-muted/30"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-5">
            <h2
              data-tour={TOUR_SECTION_TARGETS[section]}
              className="text-sm font-semibold"
            >
              {NAV.find((n) => n.id === section)?.label}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Close settings"
              onClick={closeSettings}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-5">
            {section === "appearance" && (
              <div className="space-y-3 [&>*]:bg-card">
                <ToggleRow
                  label="Dark mode"
                  desc="Switch between light and dark themes."
                  checked={theme === "dark"}
                  onChange={toggleTheme}
                />

                <div
                  data-testid="settings-row-editor-font-size"
                  className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3"
                >
                  <div>
                    <div className="text-sm font-medium">Editor font size</div>
                    <div className="text-xs text-muted-foreground">
                      The code editor's text size.
                    </div>
                  </div>
                  <Select
                    value={String(editorFontSize)}
                    onValueChange={(v) => setEditorFontSize(Number(v))}
                  >
                    <SelectTrigger className="w-[88px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {[11, 12, 13, 14, 15, 16, 18, 20].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}px
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div
                  data-testid="settings-row-app-font-size"
                  className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3"
                >
                  <div>
                    <div className="text-sm font-medium">App font size</div>
                    <div className="text-xs text-muted-foreground">
                      Scales the whole interface (menus, panels, and buttons).
                    </div>
                  </div>
                  <Select value={String(appFontSize)} onValueChange={(v) => setAppFontSize(Number(v))}>
                    <SelectTrigger className="w-[88px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {[13, 14, 15, 16, 17, 18, 20].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}px
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div
                  data-testid="settings-row-app-font"
                  className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3"
                >
                  <div>
                    <div className="text-sm font-medium">App font</div>
                    <div className="text-xs text-muted-foreground">
                      The interface font. Falls back if a font is not installed.
                    </div>
                  </div>
                  <Select
                    value={appFontFamily || "__default__"}
                    onValueChange={(v) => setAppFontFamily(v === "__default__" ? "" : v)}
                  >
                    <SelectTrigger className="w-[168px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {APP_FONTS.map((f) => (
                        <SelectItem key={f.name} value={f.value || "__default__"}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div
                  data-testid="settings-row-editor-font"
                  className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3"
                >
                  <div>
                    <div className="text-sm font-medium">Editor font</div>
                    <div className="text-xs text-muted-foreground">
                      The monospace font used in the code editor.
                    </div>
                  </div>
                  <Select
                    value={editorFontFamily || "__default__"}
                    onValueChange={(v) => setEditorFontFamily(v === "__default__" ? "" : v)}
                  >
                    <SelectTrigger className="w-[168px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {EDITOR_FONTS.map((f) => (
                        <SelectItem key={f.name} value={f.value || "__default__"}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div
                  data-testid="settings-row-editor-theme"
                  className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3"
                >
                  <div>
                    <div className="text-sm font-medium">Editor theme</div>
                    <div className="text-xs text-muted-foreground">
                      Syntax colors for the code editor, independent of the app's theme.
                    </div>
                  </div>
                  <Select
                    value={editorTheme}
                    onValueChange={(v) => setEditorTheme(v as typeof editorTheme)}
                  >
                    <SelectTrigger className="w-[168px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {EDITOR_THEMES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div
                  data-testid="settings-row-open-projects-in"
                  className="flex items-center justify-between gap-4 rounded-lg border bg-background p-3"
                >
                  <div>
                    <div className="text-sm font-medium">Open projects in</div>
                    <div className="text-xs text-muted-foreground">
                      The layout a project lands in when you open it.
                    </div>
                  </div>
                  <Select value={defaultView} onValueChange={(v) => setDefaultView(v as typeof defaultView)}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {LAYOUT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.preset} value={opt.preset}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <ToggleRow
                  label="Show file tree on open"
                  desc="Reveal the source-file tree whenever you open a project."
                  checked={openInTree}
                  onChange={() => setOpenInTree(!openInTree)}
                />

                <ToggleRow
                  label="Preview PDF on hover"
                  desc="Slide the last compiled page over a project card when you hover it in the library."
                  checked={hoverPreview}
                  onChange={setHoverPreview}
                />

                <div className="rounded-lg border bg-background p-3">
                  <div className="text-sm font-medium">Accent color</div>
                  <div className="mb-2 text-xs text-muted-foreground">
                    The app's primary highlight color (buttons, selections, cursor).
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENTS.map((a) => {
                      const active = accentColor === a.color;
                      return (
                        <button type="button"
                          key={a.id}
                          title={a.name}
                          onClick={() => setAccentColor(a.color)}
                          className={cn(
                            "flex size-8 items-center justify-center rounded-full border transition-transform hover:scale-110",
                            active
                              ? "border-foreground ring-1 ring-foreground/20"
                              : "border-border"
                          )}
                          style={{ backgroundColor: a.color }}
                        >
                          {active && (
                            <Check className="size-3.5 text-white drop-shadow" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-3">
                  <div className="text-sm font-medium">Dock placement</div>
                  <div className="mb-2 text-xs text-muted-foreground">
                    Where the floating home-screen dock sits.
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: "left", label: "Left" },
                        { id: "bottom", label: "Bottom" },
                        { id: "right", label: "Right" },
                      ] as const
                    ).map((opt) => {
                      const active = dockPlacement === opt.id;
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          data-testid={`settings-dock-placement-${opt.id}`}
                          onClick={() => setDockPlacement(opt.id)}
                          className={cn(
                            "flex flex-col items-center gap-2 rounded-md border p-3 text-xs font-medium transition-colors",
                            active ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                          )}
                        >
                          <div className="relative h-14 w-full overflow-hidden rounded bg-muted">
                            {opt.id === "left" && (
                              <div className="absolute inset-y-1 left-1 w-2 rounded bg-foreground/30" />
                            )}
                            {opt.id === "right" && (
                              <div className="absolute inset-y-1 right-1 w-2 rounded bg-foreground/30" />
                            )}
                            {opt.id === "bottom" && (
                              <div className="absolute inset-x-0 bottom-1 mx-auto h-2 w-10 rounded bg-foreground/30" />
                            )}
                          </div>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-3">
                  <div className="text-sm font-medium">Background pattern</div>
                  <div className="mb-2 text-xs text-muted-foreground">
                    The pattern behind your project shelf.
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: "dots", label: "Dots" },
                        { id: "grid", label: "Grid" },
                      ] as const
                    ).map((opt) => {
                      const active = bgPattern === opt.id;
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          data-testid={`settings-bg-pattern-${opt.id}`}
                          onClick={() => setBgPattern(opt.id)}
                          className={cn(
                            "flex flex-col items-center gap-2 rounded-md border p-3 text-xs font-medium transition-colors",
                            active ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                          )}
                        >
                          <div className="relative h-14 w-full overflow-hidden rounded bg-muted">
                            {opt.id === "dots" ? (
                              <DotPattern width={10} height={10} radius={0.75} />
                            ) : (
                              <GridPattern width={10} height={10} />
                            )}
                          </div>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {section === "general" && (
              <div className="space-y-2 [&>[role=switch]]:bg-card">
                <div className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      aria-expanded={tourGuidesOpen}
                      aria-controls="tour-guides-panel"
                      onClick={() => setTourGuidesOpen((value) => !value)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          tourGuidesOpen && "rotate-90",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">Enable tour guides</span>
                        <span className="block text-xs text-muted-foreground">
                          {completedTours} completed · {dismissedTours} dismissed ·{" "}
                          {TOUR_IDS.length} total
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={toursEnabled}
                      aria-label="Enable all tour guides"
                      onClick={() => {
                        if (toursEnabled) {
                          setTourConfirmation("disable");
                          return;
                        }
                        useTourStore.getState().resetAll();
                        setOpen(false);
                        window.requestAnimationFrame(() =>
                          startTour(projectId ? "workspace" : "home"),
                        );
                      }}
                      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Switch checked={toursEnabled} />
                    </button>
                  </div>
                  {tourGuidesOpen && (
                    <div id="tour-guides-panel" className="space-y-2 border-t p-3">
                      {TOUR_IDS.map((id) => {
                        const status = tours[id].status;
                        const checked = status === "pending";
                        return (
                          <div
                            key={id}
                            className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{TOUR_LABELS[id]}</p>
                              <p className="text-xs capitalize text-muted-foreground">{status}</p>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={checked}
                              aria-label={`Enable ${TOUR_LABELS[id]} tour`}
                              onClick={() =>
                                useTourStore.getState().setTourEnabled(id, !checked)
                              }
                              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Switch checked={checked} />
                            </button>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between gap-3 border-t pt-3">
                        <div>
                          <p className="text-sm font-medium">Tour progress</p>
                          <p className="text-xs text-muted-foreground">
                            {completedTours} completed and {dismissedTours} dismissed.
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!toursEnabled && dismissedTours === TOUR_IDS.length}
                          onClick={() => setTourConfirmation("dismiss-all")}
                        >
                          Dismiss all tours
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <ToggleRow
                  label="Vim mode"
                  desc="Enable Vim keybindings in the editor."
                  checked={vim}
                  onChange={toggleVim}
                />
                <ToggleRow
                  label="Spellcheck"
                  desc="Underline misspelled words (English, WASM Hunspell). Used when Grammar & style is off."
                  checked={spellcheck}
                  onChange={toggleSpellcheck}
                />
                <ToggleRow
                  label="Spelling, grammar & style (Harper)"
                  desc="Offline spelling, grammar, and style suggestions on .tex prose (not code or math), with one-click fixes."
                  checked={harper}
                  onChange={setHarper}
                />
                {harper && (
                  <>
                    <ToggleRow
                      label="Regionalism suggestions"
                      desc="Flag British vs. American usage (e.g. suggests “wrench” for “spanner”). Turn off if you use such terms as product or code names."
                      checked={showRegionalism}
                      onChange={setShowRegionalism}
                    />
                    <ToggleRow
                      label="Word-choice suggestions"
                      desc="Suggest alternative words (e.g. “too” vs. “to”). Turn off to keep only spelling and grammar."
                      checked={showWordChoice}
                      onChange={setShowWordChoice}
                    />
                  </>
                )}
                <ToggleRow
                  label="Offline mode"
                  desc="Compile with --only-cached; never fetch packages over the network."
                  checked={offline}
                  onChange={setOffline}
                />
                <div className="mt-2 flex items-center justify-between gap-3 border-t pt-4">
                  <div>
                    <p className="text-sm">Reset settings</p>
                    <p className="text-xs text-muted-foreground">
                      Restore Appearance &amp; General preferences to defaults.
                    </p>
                  </div>
                  {confirmReset ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="destructive" size="sm" onClick={doReset}>
                        Reset
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setConfirmReset(true)}
                    >
                      <RotateCcw className="size-3.5" />
                      Reset to defaults
                    </Button>
                  )}
                </div>
              </div>
            )}

            {section === "dictionary" && <DictionarySection />}

            {section === "data" && (
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Oleafly is local-first. All projects live on your disk:
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border bg-background p-3 text-xs">
                    {libRoot || "~/.oleafly/projects"}
                  </code>
                  {import.meta.env.DEV && isTauri() && libRoot ? (
                    <Tooltip label="Reveal projects folder in Finder">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Reveal projects folder in Finder"
                        onClick={() => void openExternal(libRoot)}
                      >
                        <FolderOpen className="size-4" />
                      </Button>
                    </Tooltip>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Each project is a plain folder with a <code>.git</code> history. Nothing leaves
                  your machine unless you push to GitHub.
                </p>
                <div className="flex items-start gap-2 rounded-lg border border-dashed bg-card p-3 text-xs text-muted-foreground">
                  <Github className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Back up or sync a project across devices: connect GitHub, then use{" "}
                    <strong className="font-medium text-foreground">Push</strong> /{" "}
                    <strong className="font-medium text-foreground">Pull</strong> in Source Control.{" "}
                    <button type="button"
                      onClick={() => setSection("github")}
                      className="font-medium text-primary hover:underline"
                    >
                      Set up GitHub →
                    </button>
                  </span>
                </div>
                <Separator className="my-5" />
                <div className="rounded-xl border bg-card p-5">
                  <div className="flex max-w-xl flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="relative size-6 shrink-0 text-primary" aria-hidden>
                        <Cloud className="absolute left-0 top-0 size-5" />
                        <RefreshCw className="absolute bottom-0 right-0 size-3 rounded-full bg-card stroke-[2.5]" />
                      </span>
                      <h3 className="font-semibold text-foreground">Cloud sync</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Coming soon
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Keep projects synchronized across your devices without configuring a Git
                      remote. Your local project folders will remain the source of truth.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {section === "ai" && <AISection />}

            {section === "engine" && <EngineSection />}
            {section === "downloads" && <DownloadsSection />}

            {section === "github" && (
              <>
                <GitHubSection
                  projectId={projectId}
                  projectName={projectName}
                  onRemoteChanged={() => void refreshTree()}
                />
                <AlphaXivSection />
              </>
            )}

            {section === "shortcuts" && <ShortcutsSection />}

            {section === "mcp" && <McpSection />}

            {section === "help" && <HelpSection />}
          </div>
        </div>
      </div>
      <ConfirmationDialog
        open={tourConfirmation !== null}
        title={tourConfirmation === "disable" ? "Disable tour guides?" : "Dismiss all tours?"}
        description="This dismisses every remaining tour and turns tour guides off. You can enable them again from General settings to start over."
        confirmLabel={tourConfirmation === "disable" ? "Disable tours" : "Dismiss all"}
        destructive
        onCancel={() => setTourConfirmation(null)}
        onConfirm={() => {
          useTourStore.getState().dismissAll();
          setTourConfirmation(null);
        }}
      />
    </div>
  );
}

function IgnoreChips({
  words,
  onRemove,
}: {
  words: string[];
  onRemove: (w: string) => void;
}) {
  if (words.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing ignored yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {words.map((w) => (
        <span
          key={w}
          className="inline-flex items-center gap-1 rounded-md border bg-background py-1 pl-2 pr-1 text-xs"
        >
          <span className="font-mono">{w}</span>
          <button type="button"
            onClick={() => onRemove(w)}
            aria-label={`Stop ignoring ${w}`}
            title={`Stop ignoring “${w}”`}
            className="rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function DictionarySection() {
  const global = useDictionary((s) => s.global);
  const ignored = useDictionary((s) => s.ignored);
  const unignore = useDictionary((s) => s.unignore);
  const unignoreGlobal = useDictionary((s) => s.unignoreGlobal);
  const projects = useFilesStore((s) => s.projects);
  const projectEntries = Object.entries(ignored).filter(([, words]) => words.length > 0);

  return (
    <div className="space-y-5 text-sm">
      <p className="text-muted-foreground">
        Words you told the spell &amp; grammar checker to ignore. Remove one to
        start flagging it again.
      </p>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Global ignore
        </h3>
        <IgnoreChips words={global} onRemove={(w) => unignoreGlobal(w)} />
      </div>
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Project level ignores
        </h3>
        {projectEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing ignored yet.</p>
        ) : (
          <div className="space-y-4">
            {projectEntries.map(([id, words]) => (
              <div key={id} className="space-y-2">
                <h4 className="text-xs font-medium text-foreground">
                  {projects.find((p) => p.id === id)?.name ?? id}
                </h4>
                <IgnoreChips words={words} onRemove={(w) => unignore(id, w)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



const REPO_URL = "https://github.com/Oleafly/Oleafly";
const AUTHOR_URL = "https://prajwal.me";
const DOCS_URL = "https://oleafly.com/docs/";
const ISSUES_URL = `${REPO_URL}/issues/new`;
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

function HelpSection() {
  const [version, setVersion] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void appVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
  const ext = (url: string) => () => void openExternal(url);

  const setOpen = useSettingsStore((s) => s.setSettingsOpen);
  const projectId = useFilesStore((s) => s.projectId);
  const beginTour = () => {
    setOpen(false);
    window.requestAnimationFrame(() => startTour(projectId ? "workspace" : "home"));
  };

  const copyDiagnostics = async () => {
    const parts = [`Oleafly v${version || "?"}`];
    if (isTauri()) {
      try {
        parts.push(`${osPlatform()} ${osArch()}`, `OS ${osVersion()}`);
      } catch {
        /* os plugin unavailable */
      }
    }
    try {
      await navigator.clipboard.writeText(parts.join(" · "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const resources: {
    icon: typeof BookOpen;
    label: string;
    onClick: () => void;
    external: boolean;
  }[] = [
    { icon: Compass, label: "Start tour", onClick: beginTour, external: false },
    { icon: BookOpen, label: "Documentation", onClick: ext(DOCS_URL), external: true },
    { icon: Bug, label: "Report a bug", onClick: ext(ISSUES_URL), external: true },
    {
      icon: TriangleAlert,
      label: "Report a crash (attach logs)",
      onClick: () => void reportCrashToGithub(),
      external: true,
    },
    { icon: ScrollText, label: "What's new", onClick: ext(CHANGELOG_URL), external: true },
    { icon: Scale, label: "License", onClick: ext(LICENSE_URL), external: true },
  ];

  return (
    <div className="space-y-5">
      <div className="relative min-h-14">
        <img
          data-testid="about-oleafly-logo"
          src="/oleafly-tile-gradient.png"
          alt="Oleafly"
          className="absolute -top-2 right-0 size-14 rounded-xl"
        />
        <h3 className="pr-20 text-sm font-semibold">About Oleafly</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A local-first, cross-platform LaTeX &amp; resume authoring app.
          {version && <span className="ml-1">· v{version}</span>}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <UpdateChecker />
          <button
            type="button"
            onClick={copyDiagnostics}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy version & system info"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Author</p>
          <button type="button"
            onClick={ext(AUTHOR_URL)}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">Prajwal Murthy</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project</p>
          <button type="button"
            onClick={ext(REPO_URL)}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Github className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">GitHub</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Resources</p>
        {resources.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={r.onClick}
            className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <r.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{r.label}</span>
            {r.external ? (
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

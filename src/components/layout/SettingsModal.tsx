import { useEffect, useState } from "react";
import {
  AtSign,
  Blocks,
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
  FlaskConical,
  FolderOpen,
  GitFork,
  Github,
  // Globe, (only used by the commented-out Author row)
  GraduationCap,
  HardDriveDownload,
  Keyboard,
  LifeBuoy,
  MessageCircle,
  Palette,
  RotateCcw,
  RefreshCw,
  Scale,
  ScrollText,
  Settings,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { reportCrashToGithub } from "@/lib/crash-report";
import { isTauri } from "@tauri-apps/api/core";
import { platform as osPlatform, arch as osArch, version as osVersion } from "@tauri-apps/plugin-os";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { UpdateChecker } from "@/components/layout/UpdateChecker";
import { EngineSection } from "@/components/settings/EngineSection";
import { DownloadsSection } from "@/components/settings/DownloadsSection";
import { AISection } from "@/components/settings/AISection";
import { IntegrationsSection } from "@/components/settings/IntegrationsSection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShortcutsSection } from "@/components/settings/ShortcutsSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useSettingsStore,
  GRAMMAR_DIALECTS,
  DICTIONARY_LOCALES,
  type GrammarDialect,
  type DictionaryLocale,
} from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useGithubStore } from "@/store/github";
import {
  appVersion,
  libraryRoot,
  libraryStorageSummary,
  listRecycledProjects,
  permanentlyDeleteRecycledProject,
  recycleProject,
  restoreRecycledProject,
  type LibraryStorageSummary,
  type RecycledProjectInfo,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { notifyError, toast } from "@/lib/toast";
import { cancelAutoCommit } from "@/lib/auto-commit";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { startTour } from "@/lib/tour";
import { TOUR_IDS } from "@/lib/tours/registry";
import { useTourStore } from "@/store/tours";
import { ProofreadingDictionarySection } from "@/components/settings/ProofreadingDictionarySection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import {
  SettingsSwitchIndicator,
  SettingsToggleRow,
} from "@/components/settings/SettingsToggleRow";
import { OleaflyAssistantMascot } from "@/components/branding/OleaflyAssistantMascot";
import {
  githubGetPublicRepoStats,
  type GitHubRepoStats,
} from "@/lib/github";

type Section =
  | "appearance"
  | "general"
  | "dictionary"
  | "data"
  | "ai"
  | "engine"
  | "downloads"
  | "integrations"
  | "shortcuts"
  | "experimentation"
  | "developer"
  | "help";

type DeveloperSettingsModule = typeof import("@/developer/DeveloperSettings");

const NAV: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "dictionary", label: "Dictionary", icon: BookMarked },
  { id: "data", label: "Data Storage", icon: Database },
  { id: "ai", label: "AI Assistant", icon: Sparkles },
  { id: "engine", label: "Engines", icon: Cpu },
  { id: "downloads", label: "Downloads", icon: HardDriveDownload },
  { id: "integrations", label: "Integrations", icon: Blocks },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard },
  { id: "experimentation", label: "Experimentation", icon: FlaskConical },
  { id: "help", label: "Help & About", icon: LifeBuoy },
];
const TOUR_SECTION_TARGETS: Partial<Record<Section, string>> = {
  general: "settings-general",
  appearance: "settings-appearance",
  dictionary: "settings-dictionary",
  data: "settings-data",
  ai: "settings-ai",
  engine: "settings-compiler",
  downloads: "settings-downloads",
  integrations: "settings-integrations",
  shortcuts: "settings-shortcuts",
  help: "settings-help",
};
const TOUR_LABELS = {
  home: "Home and project creation",
  workspace: "Project workspace",
  settings: "Settings",
  "ai-settings": "AI Assistant settings",
  ai: "AI Assistant",
  diagram: "Diagram Composer",
} as const;

function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: unit === 0 ? 0 : value >= 10 ? 1 : 2,
  })} ${units[unit]}`;
}

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen);
  const setOpen = useSettingsStore((s) => s.setSettingsOpen);
  const resetGeneralPreferences = useSettingsStore(
    (s) => s.resetGeneralPreferences,
  );
  const resetExperimentationPreferences = useSettingsStore(
    (s) => s.resetExperimentationPreferences,
  );
  const spellcheck = useSettingsStore((s) => s.spellcheck);
  const toggleSpellcheck = useSettingsStore((s) => s.toggleSpellcheck);
  const harper = useSettingsStore((s) => s.harper);
  const setHarper = useSettingsStore((s) => s.setHarper);
  const grammarDialect = useSettingsStore((s) => s.grammarDialect);
  const setGrammarDialect = useSettingsStore((s) => s.setGrammarDialect);
  const dictionaryLocale = useSettingsStore((s) => s.dictionaryLocale);
  const setDictionaryLocale = useSettingsStore((s) => s.setDictionaryLocale);
  const showRegionalism = useSettingsStore((s) => s.showRegionalism);
  const setShowRegionalism = useSettingsStore((s) => s.setShowRegionalism);
  const showWordChoice = useSettingsStore((s) => s.showWordChoice);
  const setShowWordChoice = useSettingsStore((s) => s.setShowWordChoice);
  const offline = useSettingsStore((s) => s.offline);
  const setOffline = useSettingsStore((s) => s.setOffline);
  const visualEditor = useSettingsStore((s) => s.visualEditor);
  const setVisualEditor = useSettingsStore((s) => s.setVisualEditor);
  const previewTyping = useSettingsStore((s) => s.previewTyping);
  const setPreviewTyping = useSettingsStore((s) => s.setPreviewTyping);
  const latexTools = useSettingsStore((s) => s.latexTools);
  const webBrowser = useSettingsStore((s) => s.webBrowser);
  const setWebBrowser = useSettingsStore((s) => s.setWebBrowser);
  const setLatexTools = useSettingsStore((s) => s.setLatexTools);

  const projectId = useFilesStore((s) => s.projectId);
  const projects = useFilesStore((s) => s.projects);
  const closeProject = useFilesStore((s) => s.closeProject);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const githubStatus = useGithubStore((s) => s.status);

  const [section, setSection] = useState<Section>("general");
  const [developerSettings, setDeveloperSettings] =
    useState<DeveloperSettingsModule | null>(null);
  const [libRoot, setLibRoot] = useState("");
  const [storageSummary, setStorageSummary] =
    useState<LibraryStorageSummary | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [storageRefreshKey, setStorageRefreshKey] = useState(0);
  const [recycledProjects, setRecycledProjects] = useState<RecycledProjectInfo[]>([]);
  const [recycleActionId, setRecycleActionId] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] =
    useState<RecycledProjectInfo | null>(null);
  const [confirmClearRecycleBin, setConfirmClearRecycleBin] = useState(false);
  const [clearingRecycleBin, setClearingRecycleBin] = useState(false);
  const [confirmDeleteAllProjects, setConfirmDeleteAllProjects] = useState(false);
  const [deletingAllProjects, setDeletingAllProjects] = useState(false);
  const [tourConfirmation, setTourConfirmation] = useState<"disable" | "dismiss-all" | null>(
    null,
  );
  const [tourGuidesOpen, setTourGuidesOpen] = useState(false);
  const toursEnabled = useTourStore((s) => s.enabled);
  const tours = useTourStore((s) => s.tours);
  const completedTours = TOUR_IDS.filter((id) => tours[id].status === "completed").length;
  const dismissedTours = TOUR_IDS.filter((id) => tours[id].status === "dismissed").length;
  const navigation = developerSettings
    ? [
        ...NAV.slice(0, -1),
        developerSettings.DEVELOPER_NAV_ITEM,
        NAV[NAV.length - 1],
      ]
    : NAV;
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

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let active = true;
    void import("@/developer/DeveloperSettings").then((module) => {
      if (active) setDeveloperSettings(module);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const next = NAV.some((item) => item.id === settingsInitialSection)
      ? (settingsInitialSection as Section)
      : "general";
    setSection(next);
    void libraryRoot().then(setLibRoot).catch(() => {});
  }, [open, settingsInitialSection]);

  useEffect(() => {
    if (!open || section !== "data" || !isTauri()) return;
    void storageRefreshKey;
    let cancelled = false;
    setStorageLoading(true);
    setStorageError("");
    void Promise.all([libraryStorageSummary(), listRecycledProjects()])
      .then(([summary, recycled]) => {
        if (!cancelled) {
          setStorageSummary(summary);
          setRecycledProjects(recycled);
        }
      })
      .catch(() => {
        if (!cancelled) setStorageError("Storage details could not be calculated.");
      })
      .finally(() => {
        if (!cancelled) setStorageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, section, storageRefreshKey]);

  const restoreProject = async (project: RecycledProjectInfo) => {
    setRecycleActionId(project.id);
    try {
      await restoreRecycledProject(project.id);
      await refreshProjects();
      toast.success(`Restored "${project.name}".`);
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      notifyError(
        "restore recycled project",
        error,
        `Couldn't restore "${project.name}".`,
      );
    } finally {
      setRecycleActionId(null);
    }
  };

  const confirmPermanentProjectDeletion = async () => {
    const project = permanentDeleteTarget;
    if (!project) return;
    setPermanentDeleteTarget(null);
    setRecycleActionId(project.id);
    try {
      await permanentlyDeleteRecycledProject(project.id);
      toast.success(`Permanently deleted "${project.name}".`);
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      notifyError(
        "permanently delete recycled project",
        error,
        `Couldn't permanently delete "${project.name}".`,
      );
    } finally {
      setRecycleActionId(null);
    }
  };

  const clearRecycleBin = async () => {
    setConfirmClearRecycleBin(false);
    setClearingRecycleBin(true);
    const projectsToDelete = [...recycledProjects];
    let deleted = 0;
    try {
      for (const project of projectsToDelete) {
        await permanentlyDeleteRecycledProject(project.id);
        deleted += 1;
      }
      toast.success(
        `Permanently deleted ${deleted.toLocaleString()} ${deleted === 1 ? "project" : "projects"}.`,
      );
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      setStorageRefreshKey((value) => value + 1);
      notifyError(
        "clear recycle bin",
        error,
        deleted > 0
          ? `Permanently deleted ${deleted.toLocaleString()} projects, but couldn't clear the entire Recycle Bin.`
          : "Couldn't clear the Recycle Bin.",
      );
    } finally {
      setClearingRecycleBin(false);
    }
  };

  const deleteAllProjects = async () => {
    setConfirmDeleteAllProjects(false);
    setDeletingAllProjects(true);
    let moved = 0;
    try {
      for (const project of projects) cancelAutoCommit(project.id);
      if (useFilesStore.getState().projectId) {
        await closeProject();
        if (useFilesStore.getState().projectId) {
          throw new Error("The open project could not be closed safely.");
        }
      }
      for (const project of projects) {
        await recycleProject(project.id);
        moved += 1;
      }
      await refreshProjects();
      toast.success(
        `Moved ${moved.toLocaleString()} ${moved === 1 ? "project" : "projects"} to the Recycle Bin.`,
      );
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      await refreshProjects().catch(() => {});
      setStorageRefreshKey((value) => value + 1);
      notifyError(
        "move all projects to recycle bin",
        error,
        moved > 0
          ? `Moved ${moved.toLocaleString()} projects, but couldn't finish the operation.`
          : "Couldn't move the projects to the Recycle Bin.",
      );
    } finally {
      setDeletingAllProjects(false);
    }
  };

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
        className="relative flex h-[min(900px,88vh)] min-h-[min(540px,88vh)] w-[min(880px,94vw)] overflow-hidden rounded-xl border bg-background shadow-2xl outline-none"
      >
        <nav
          aria-label="Settings sections"
          data-tour="settings-navigation-panel"
          className="flex min-h-0 w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-3"
        >
          <div
            data-tour="settings-navigation"
            className="mb-2 shrink-0 px-2 text-sm font-semibold"
          >
            Settings
          </div>
          <div
            data-testid="settings-section-scroll"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <div className="flex flex-col gap-0.5">
            {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              data-testid={`settings-section-${id}`}
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm transition-colors",
                section === id
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </button>
            ))}
            </div>
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
              {navigation.find((n) => n.id === section)?.label}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Close settings"
              data-testid="settings-close"
              onClick={closeSettings}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-5">
            {section === "appearance" && <AppearanceSection />}

            {section === "general" && (
              <div className="space-y-2 [&>[role=switch]]:bg-card">
                <SettingsToggleRow
                  label="Spellcheck"
                  description="Underline misspelled words with the selected offline Hunspell dictionary and offer replacement suggestions in Source and Visual editing."
                  checked={spellcheck}
                  onChange={toggleSpellcheck}
                />
                <SettingsToggleRow
                  label="Grammar & style (Harper)"
                  description="Check English grammar and style in LaTeX and Markdown Source and Visual editing, plus Typst Source, with one-click fixes."
                  checked={harper}
                  onChange={setHarper}
                />
                {harper && (
                  <>
                    <div
                      data-testid="settings-row-grammar-dialect"
                      className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3"
                    >
                      <div>
                        <div className="text-sm font-medium">
                          English dialect
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Apply the selected spelling, grammar, and regional
                          conventions.
                        </div>
                      </div>
                      <Select
                        value={grammarDialect}
                        onValueChange={(value) =>
                          setGrammarDialect(value as GrammarDialect)
                        }
                      >
                        <SelectTrigger
                          aria-label="Proofreading English dialect"
                          className="w-[176px]"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[100]">
                          {GRAMMAR_DIALECTS.map((dialect) => (
                            <SelectItem key={dialect.id} value={dialect.id}>
                              {dialect.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <SettingsToggleRow
                      label="Regionalism suggestions"
                      description="Flag terms that do not match the selected English dialect. Turn off if you use such terms as product or code names."
                      checked={showRegionalism}
                      onChange={setShowRegionalism}
                    />
                    <SettingsToggleRow
                      label="Word-choice suggestions"
                      description="Suggest alternative words (e.g. “too” vs. “to”). Turn off to keep only spelling and grammar."
                      checked={showWordChoice}
                      onChange={setShowWordChoice}
                    />
                  </>
                )}
                {spellcheck && (
                  <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
                    <div>
                      <div className="text-sm font-medium">
                        Spelling dictionary
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Exact offline Hunspell pack used by Source and Visual
                        spelling checks.
                      </div>
                    </div>
                    <Select
                      value={dictionaryLocale}
                      onValueChange={(value) =>
                        setDictionaryLocale(value as DictionaryLocale)
                      }
                    >
                      <SelectTrigger
                        aria-label="Proofreading spelling dictionary"
                        className="w-[176px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[100]">
                        {DICTIONARY_LOCALES.map((locale) => (
                          <SelectItem key={locale.id} value={locale.id}>
                            {locale.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Proofreading runs locally in a background worker. Harper
                  follows the selected English dialect; spelling always uses
                  the exact selected Hunspell pack. Math, code, comments,
                  citation syntax, metadata, and URLs are excluded.
                </div>
                <SettingsToggleRow
                  label="Offline mode"
                  description="Compile with --only-cached and never fetch packages over the network."
                  checked={offline}
                  onChange={setOffline}
                />
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
                      <SettingsSwitchIndicator checked={toursEnabled} />
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
                              <SettingsSwitchIndicator checked={checked} />
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
                <ResetToDefaults
                  sectionName="General"
                  onReset={resetGeneralPreferences}
                />
              </div>
            )}

            {section === "dictionary" && <DictionarySection />}

            {section === "data" && (
              <Tabs defaultValue="local" className="space-y-4 text-sm">
                <TabsList>
                  <TabsTrigger value="local" data-testid="data-tab-local">
                    Local store
                  </TabsTrigger>
                  <TabsTrigger value="cloud" data-testid="data-tab-cloud">
                    Cloud sync
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="local" className="space-y-3">
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
                <section
                  aria-labelledby="storage-usage-title"
                  className="overflow-hidden rounded-xl border bg-card/60"
                >
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Database aria-hidden className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 id="storage-usage-title" className="font-medium">
                          Storage usage
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {storageSummary
                            ? `${formatStorageSize(storageSummary.total_bytes)} across the Oleafly data folder`
                            : "Projects, previews, history, and app data"}
                        </p>
                      </div>
                    </div>
                    <Tooltip label="Refresh storage usage">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        disabled={storageLoading || !isTauri()}
                        aria-label="Refresh storage usage"
                        onClick={() => setStorageRefreshKey((value) => value + 1)}
                      >
                        <RefreshCw
                          aria-hidden
                          className={cn(
                            "size-4",
                            storageLoading &&
                              "animate-spin motion-reduce:animate-none",
                          )}
                        />
                      </Button>
                    </Tooltip>
                  </div>
                  {storageError ? (
                    <p role="alert" className="px-4 py-5 text-sm text-destructive">
                      {storageError}
                    </p>
                  ) : storageLoading && !storageSummary ? (
                    <div
                      role="status"
                      className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"
                    >
                      <RefreshCw
                        aria-hidden
                        className="size-4 animate-spin motion-reduce:animate-none"
                      />
                      Calculating storage usage…
                    </div>
                  ) : storageSummary ? (
                    <dl className="grid grid-cols-2 divide-x divide-y text-xs sm:grid-cols-4">
                      {[
                        {
                          label: "Projects",
                          value: storageSummary.project_count.toLocaleString(),
                          detail: formatStorageSize(storageSummary.projects_bytes),
                        },
                        {
                          label: "Files",
                          value: storageSummary.file_count.toLocaleString(),
                          detail: `${storageSummary.directory_count.toLocaleString()} folders`,
                        },
                        {
                          label: "Images",
                          value: storageSummary.image_count.toLocaleString(),
                          detail: formatStorageSize(storageSummary.image_bytes),
                        },
                        {
                          label: "PDFs",
                          value: storageSummary.pdf_count.toLocaleString(),
                          detail: formatStorageSize(storageSummary.pdf_bytes),
                        },
                        {
                          label: "Project files",
                          value: formatStorageSize(storageSummary.source_bytes),
                          detail: "Sources and metadata",
                        },
                        {
                          label: "Git history",
                          value: formatStorageSize(storageSummary.git_bytes),
                          detail: "Local versions",
                        },
                        {
                          label: "Build cache",
                          value: formatStorageSize(storageSummary.build_bytes),
                          detail: "Generated output",
                        },
                        {
                          label: "App data",
                          value: formatStorageSize(storageSummary.app_data_bytes),
                          detail: "Assets and settings",
                        },
                      ].map((item) => (
                        <div key={item.label} className="min-w-0 px-3 py-3">
                          <dt className="text-muted-foreground">{item.label}</dt>
                          <dd className="mt-1 truncate text-sm font-semibold text-foreground">
                            {item.value}
                          </dd>
                          <dd className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {item.detail}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="px-4 py-5 text-sm text-muted-foreground">
                      Storage details are available in the desktop app.
                    </p>
                  )}
                  {storageSummary && storageSummary.unreadable_entries > 0 ? (
                    <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">
                      {storageSummary.unreadable_entries.toLocaleString()} inaccessible
                      {storageSummary.unreadable_entries === 1 ? " item was" : " items were"}
                      {" "}excluded.
                    </p>
                  ) : null}
                </section>
                <section
                  aria-labelledby="recycle-bin-title"
                  className="overflow-hidden rounded-xl border bg-card/60"
                >
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Trash2 aria-hidden className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 id="recycle-bin-title" className="font-medium">
                          Recycle Bin
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {storageSummary
                            ? `${formatStorageSize(storageSummary.recycle_bin_bytes)} · no automatic cleanup`
                            : "Deleted projects stay here until you remove them"}
                        </p>
                      </div>
                    </div>
                    {recycledProjects.length > 0 ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {recycledProjects.length.toLocaleString()}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={recycleActionId !== null || clearingRecycleBin}
                          onClick={() => setConfirmClearRecycleBin(true)}
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                          {clearingRecycleBin ? "Clearing…" : "Clear all"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {storageLoading && !storageSummary ? (
                    <div
                      role="status"
                      className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"
                    >
                      <RefreshCw
                        aria-hidden
                        className="size-4 animate-spin motion-reduce:animate-none"
                      />
                      Loading Recycle Bin…
                    </div>
                  ) : recycledProjects.length === 0 ? (
                    <p className="px-4 py-5 text-sm text-muted-foreground">
                      The Recycle Bin is empty.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {recycledProjects.map((project) => {
                        const busy = recycleActionId === project.id;
                        return (
                          <li
                            key={project.id}
                            className="flex items-center justify-between gap-3 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {project.name}
                              </p>
                              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                Deleted {new Date(project.deleted_at * 1000).toLocaleString()} ·{" "}
                                {formatStorageSize(project.size_bytes)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={recycleActionId !== null || clearingRecycleBin}
                                onClick={() => void restoreProject(project)}
                              >
                                <RotateCcw
                                  aria-hidden
                                  className={cn(
                                    "size-3.5",
                                    busy && "animate-spin motion-reduce:animate-none",
                                  )}
                                />
                                Restore
                              </Button>
                              <Tooltip label={`Permanently delete ${project.name}`}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-muted-foreground hover:text-destructive"
                                  disabled={recycleActionId !== null || clearingRecycleBin}
                                  aria-label={`Permanently delete ${project.name}`}
                                  onClick={() => setPermanentDeleteTarget(project)}
                                >
                                  <Trash2 aria-hidden className="size-3.5" />
                                </Button>
                              </Tooltip>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                {githubStatus === "disconnected" ? (
                <div className="flex items-start gap-2 rounded-lg border border-dashed bg-card p-3 text-xs text-muted-foreground">
                  <Github className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Back up or sync a project across devices: connect GitHub, then use{" "}
                    <strong className="font-medium text-foreground">Push</strong> /{" "}
                    <strong className="font-medium text-foreground">Pull</strong> in Source Control.{" "}
                    <button type="button"
                      onClick={() => setSection("integrations")}
                      className="font-medium text-primary hover:underline"
                    >
                      Set up GitHub →
                    </button>
                  </span>
                </div>
                ) : null}
                <section
                  aria-labelledby="data-danger-zone-title"
                  className="overflow-hidden rounded-xl border border-destructive/40"
                >
                  <div className="border-b border-destructive/25 px-4 py-3">
                    <h3
                      id="data-danger-zone-title"
                      className="font-medium text-destructive"
                    >
                      Danger zone
                    </h3>
                  </div>
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Delete all projects
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Moves every project to the Recycle Bin. Nothing is permanently deleted.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      disabled={projects.length === 0 || deletingAllProjects}
                      onClick={() => setConfirmDeleteAllProjects(true)}
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                      {deletingAllProjects ? "Deleting…" : "Delete all"}
                    </Button>
                  </div>
                </section>
                </TabsContent>
                <TabsContent value="cloud">
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
                      remote. Every transfer will be end-to-end encrypted, so your work stays
                      private in transit. Your local project folders will remain the source of
                      truth.
                    </p>
                  </div>
                </div>
                </TabsContent>
              </Tabs>
            )}

            {section === "ai" && <AISection />}

            {section === "engine" && <EngineSection />}
            {section === "downloads" && <DownloadsSection />}

            {section === "integrations" && <IntegrationsSection />}

            {section === "shortcuts" && <ShortcutsSection />}

            {section === "experimentation" && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs text-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    These features are experimental and still in beta. They are
                    not fully tested yet and may change, break, or be removed in a
                    future release. Turn them on only if you want to try work in
                    progress.
                  </span>
                </div>
                <SettingsToggleRow
                  label="Visual editor"
                  description="Show the Visual/Code toggle in the document editor. Off by default, so documents open in the code editor only. Diagrams always keep their own canvas toggle."
                  checked={visualEditor}
                  onChange={setVisualEditor}
                />
                <SettingsToggleRow
                  label="Type in the preview"
                  description="Click text in the compiled PDF to put the cursor at that spot in your source, then keep typing. Keystrokes go into the source file and show up at the click point until the next compile redraws the page. Needs a compiler with source sync."
                  checked={previewTyping}
                  onChange={setPreviewTyping}
                />
                <SettingsToggleRow
                  label="LaTeX tools"
                  description="Show the Oleafly Tools gallery and the individual tools (PDF import, equations, tables, BibTeX, lab and literature search, deadlines) plus their slash commands. Off by default while still in beta."
                  checked={latexTools}
                  onChange={setLatexTools}
                />
                <SettingsToggleRow
                  label="Web browser"
                  description="Show the in-app web browser (its dock toggle and shortcut) and let the AI drive it with computer use. Off by default while still in beta; when off, there is no browser button and the AI has no browser tool."
                  checked={webBrowser}
                  onChange={setWebBrowser}
                />
                <ResetToDefaults
                  sectionName="Experimentation"
                  onReset={resetExperimentationPreferences}
                />
              </div>
            )}

            {section === "developer" && developerSettings ? (
              <developerSettings.DeveloperSettings />
            ) : null}

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
      <ConfirmationDialog
        open={permanentDeleteTarget !== null}
        title={`Permanently delete “${permanentDeleteTarget?.name ?? "project"}”?`}
        description="This removes the project, its files, and its Git history from the Recycle Bin. This action cannot be undone."
        confirmLabel="Delete permanently"
        destructive
        onCancel={() => setPermanentDeleteTarget(null)}
        onConfirm={() => void confirmPermanentProjectDeletion()}
      />
      <ConfirmationDialog
        open={confirmClearRecycleBin}
        title={`Clear ${recycledProjects.length.toLocaleString()} ${recycledProjects.length === 1 ? "project" : "projects"} from the Recycle Bin?`}
        description="This permanently deletes every project currently in the Recycle Bin, including its files and Git history. This action cannot be undone."
        confirmLabel="Clear Recycle Bin"
        destructive
        onCancel={() => setConfirmClearRecycleBin(false)}
        onConfirm={() => void clearRecycleBin()}
      />
      <ConfirmationDialog
        open={confirmDeleteAllProjects}
        title={`Delete all ${projects.length.toLocaleString()} ${projects.length === 1 ? "project" : "projects"}?`}
        description="Every current project will move to the Recycle Bin, including its files and Git history. You can restore projects individually afterward."
        confirmLabel="Delete all projects"
        destructive
        onCancel={() => setConfirmDeleteAllProjects(false)}
        onConfirm={() => void deleteAllProjects()}
      />
    </div>
  );
}

function DictionarySection() {
  return <ProofreadingDictionarySection />;
}



const REPO_URL = "https://github.com/Oleafly/Oleafly";
// const AUTHOR_URL = "https://prajwal.me";
const DOCS_URL = "https://oleafly.com/docs/";
const LEARN_URL = "https://oleafly.com/learn/";
const ISSUES_URL = `${REPO_URL}/issues`;
const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
const X_URL = "https://x.com/OleaflyHQ";
const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

function HelpSection() {
  const [version, setVersion] = useState("");
  const [copied, setCopied] = useState(false);
  const [repoStats, setRepoStats] = useState<GitHubRepoStats | null>(null);
  useEffect(() => {
    void appVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
  useEffect(() => {
    let active = true;
    void githubGetPublicRepoStats("Oleafly/Oleafly")
      .then((stats) => {
        if (active) setRepoStats(stats);
      })
      .catch(() => {
        /* Keep the project link useful when offline or rate-limited. */
      });
    return () => {
      active = false;
    };
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
    { icon: GraduationCap, label: "Learn", onClick: ext(LEARN_URL), external: true },
    {
      icon: TriangleAlert,
      label: "Report a crash (attach logs)",
      onClick: () => void reportCrashToGithub(),
      external: true,
    },
    { icon: ScrollText, label: "What's new", onClick: ext(CHANGELOG_URL), external: true },
    { icon: Scale, label: "License", onClick: ext(LICENSE_URL), external: true },
  ];

  const community = [
    {
      icon: MessageCircle,
      label: "Discussions",
      description: "Ask questions and share ideas",
      onClick: ext(DISCUSSIONS_URL),
    },
    {
      icon: Bug,
      label: "Issues",
      description: "Report a bug or request a feature",
      onClick: ext(ISSUES_URL),
    },
    {
      icon: AtSign,
      label: "@OleaflyHQ",
      description: "Follow releases and development",
      onClick: ext(X_URL),
    },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 px-1">
        <OleaflyAssistantMascot className="size-20" />
        <div
          role="note"
          aria-label="Support Oleafly"
          className="relative mt-1 min-w-0 flex-1 rounded-xl border border-border bg-[color-mix(in_srgb,var(--accent)_35%,var(--background))] px-3 py-2.5 text-left text-[11px] leading-relaxed text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className="absolute -left-1.5 top-5 z-10 size-3 rotate-45 border-b border-l border-border bg-[color-mix(in_srgb,var(--accent)_35%,var(--background))]"
          />
          <span
            aria-hidden="true"
            className="absolute -left-px top-[18px] z-20 h-4 w-1 bg-[color-mix(in_srgb,var(--accent)_35%,var(--background))]"
          />
          <span className="relative z-30">
            If Oleafly helps your work, please{" "}
            <button
              type="button"
              onClick={ext(REPO_URL)}
              className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:text-primary"
            >
              star the project on GitHub
            </button>
            . That small click helps more researchers find it and supports continued development.
          </span>
        </div>
      </div>

      <div
        data-testid="about-oleafly-section"
        className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-3 rounded-md border p-4"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-sm font-semibold">Oleafly</h3>
            {version && (
              <span className="text-[11px] text-muted-foreground">v{version}</span>
            )}
          </div>
          <p className="mt-1 max-w-[42rem] text-xs leading-relaxed text-muted-foreground">
            Write, compile, proofread, manage citations, review PDFs, track changes in Git,
            and use the AI models you choose. All in one open-source workspace.
          </p>
        </div>
        <img
          data-testid="about-oleafly-logo"
          src="/oleafly-tile-gradient.png"
          alt="Oleafly"
          className="size-14 shrink-0 rounded-xl"
        />
        <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <UpdateChecker />
          <button
            type="button"
            onClick={copyDiagnostics}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy Info"}
          </button>
        </div>
      </div>

      {/* Author row removed for now; will re-add later.
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
      </div>
      */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project</p>
        <button type="button"
          onClick={ext(REPO_URL)}
          className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <Github className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">Star and explore on GitHub</span>
          {repoStats && (
            <span className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
              <span
                role="img"
                className="inline-flex items-center gap-1"
                aria-label={`${repoStats.stars.toLocaleString()} GitHub stars`}
                title="GitHub stars"
              >
                <Star aria-hidden="true" className="size-3.5" />
                {repoStats.stars.toLocaleString()}
              </span>
              <span
                role="img"
                className="inline-flex items-center gap-1"
                aria-label={`${repoStats.forks.toLocaleString()} GitHub forks`}
                title="GitHub forks"
              >
                <GitFork aria-hidden="true" className="size-3.5" />
                {repoStats.forks.toLocaleString()}
              </span>
            </span>
          )}
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Community
        </p>
        {community.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className="group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left hover:bg-accent"
          >
            <item.icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{item.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {item.description}
              </span>
            </span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ))}
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

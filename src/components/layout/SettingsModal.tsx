import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { isLocalePreference, LOCALE_INFO, SUPPORTED_LOCALES } from "@oleafly/i18n-contract";
import { CiteOleaflyCard } from "@/components/settings/CiteOleaflyCard";
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
import { i18n } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime, formatNumber } from "@/lib/intl";
import { notifyError, toast } from "@/lib/toast";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { startTour } from "@/lib/tour";
import { resolveTourText, TOUR_IDS, tourRegistry } from "@/lib/tours/registry";
import { useTourStore } from "@/store/tours";
import { ProofreadingDictionarySection } from "@/components/settings/ProofreadingDictionarySection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { CheckpointToggles } from "@/components/settings/CheckpointToggles";
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
  {
    id: "general",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.general);
    },
    icon: Settings,
  },
  {
    id: "appearance",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.appearance);
    },
    icon: Palette,
  },
  {
    id: "dictionary",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.dictionary);
    },
    icon: BookMarked,
  },
  {
    id: "data",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.data);
    },
    icon: Database,
  },
  {
    id: "ai",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.ai);
    },
    icon: Sparkles,
  },
  {
    id: "engine",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.engine);
    },
    icon: Cpu,
  },
  {
    id: "downloads",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.downloads);
    },
    icon: HardDriveDownload,
  },
  {
    id: "integrations",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.integrations);
    },
    icon: Blocks,
  },
  {
    id: "shortcuts",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.shortcuts);
    },
    icon: Keyboard,
  },
  {
    id: "experimentation",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.experimentation);
    },
    icon: FlaskConical,
  },
  {
    id: "help",
    get label() {
      return i18n.t(($) => $.shell.settings.nav.help);
    },
    icon: LifeBuoy,
  },
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
  const uiLocalePreference = useSettingsStore((s) => s.uiLocalePreference);
  const setUiLocalePreference = useSettingsStore((s) => s.setUiLocalePreference);
  const { t } = useTranslation(["common", "settings", "shell"]);
  const showRegionalism = useSettingsStore((s) => s.showRegionalism);
  const setShowRegionalism = useSettingsStore((s) => s.setShowRegionalism);
  const showWordChoice = useSettingsStore((s) => s.showWordChoice);
  const setShowWordChoice = useSettingsStore((s) => s.setShowWordChoice);
  const offline = useSettingsStore((s) => s.offline);
  const setOffline = useSettingsStore((s) => s.setOffline);
  const visualEditor = useSettingsStore((s) => s.visualEditor);
  const setVisualEditor = useSettingsStore((s) => s.setVisualEditor);
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
        ...NAV.slice(-1),
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
    import("@/developer/DeveloperSettings").then((module) => {
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
    libraryRoot().then(setLibRoot).catch(() => {});
  }, [open, settingsInitialSection]);

  useEffect(() => {
    if (!open || section !== "data" || !isTauri()) return;
    void storageRefreshKey;
    let cancelled = false;
    setStorageLoading(true);
    setStorageError("");
    Promise.all([libraryStorageSummary(), listRecycledProjects()])
      .then(([summary, recycled]) => {
        if (!cancelled) {
          setStorageSummary(summary);
          setRecycledProjects(recycled);
        }
      })
      .catch(() => {
        if (!cancelled) setStorageError(i18n.t(($) => $.shell.settings.data.storage.error));
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
      toast.success(i18n.t(($) => $.shell.settings.data.recycleBin.restored, { name: project.name }));
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      notifyError(
        "restore recycled project",
        error,
        i18n.t(($) => $.shell.settings.data.recycleBin.restoreFailed, { name: project.name }),
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
      toast.success(
        i18n.t(($) => $.shell.settings.data.recycleBin.deleted, { name: project.name }),
      );
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      notifyError(
        "permanently delete recycled project",
        error,
        i18n.t(($) => $.shell.settings.data.recycleBin.deleteFailed, { name: project.name }),
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
        i18n.t(($) => $.shell.settings.data.recycleBin.clearedCount, { count: deleted }),
      );
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      setStorageRefreshKey((value) => value + 1);
      notifyError(
        "clear recycle bin",
        error,
        deleted > 0
          ? i18n.t(($) => $.shell.settings.data.recycleBin.clearPartial, { count: deleted })
          : i18n.t(($) => $.shell.settings.data.recycleBin.clearFailed),
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
      if (useFilesStore.getState().projectId) {
        await closeProject();
        if (useFilesStore.getState().projectId) {
          throw new Error(i18n.t(($) => $.shell.settings.data.danger.closeFailed));
        }
      }
      for (const project of projects) {
        await recycleProject(project.id);
        moved += 1;
      }
      await refreshProjects();
      toast.success(
        i18n.t(($) => $.shell.settings.data.danger.movedCount, { count: moved }),
      );
      setStorageRefreshKey((value) => value + 1);
    } catch (error) {
      await refreshProjects().catch(() => {});
      setStorageRefreshKey((value) => value + 1);
      notifyError(
        "move all projects to recycle bin",
        error,
        moved > 0
          ? i18n.t(($) => $.shell.settings.data.danger.movePartial, { count: moved })
          : i18n.t(($) => $.shell.settings.data.danger.moveFailed),
      );
    } finally {
      setDeletingAllProjects(false);
    }
  };

  if (!open) return null;

  const renderStorageSummary = () => {
    if (storageError) {
      return (
        <p role="alert" className="px-4 py-5 text-sm text-destructive">
          {storageError}
        </p>
      );
    }
    if (storageLoading && !storageSummary) {
      return (
        <output
          className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"
        >
          <RefreshCw
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          {t(($) => $.shell.settings.data.storage.calculating)}
        </output>
      );
    }
    if (storageSummary) {
      return (
        <dl className="grid grid-cols-2 gap-px border-t bg-border text-xs sm:grid-cols-4">
          {[
            {
              id: "projects",
              label: t(($) => $.shell.settings.data.storage.stats.projects),
              value: formatNumber(storageSummary.project_count),
              detail: formatBytes(storageSummary.projects_bytes),
            },
            {
              id: "files",
              label: t(($) => $.shell.settings.data.storage.stats.files),
              value: formatNumber(storageSummary.file_count),
              detail: t(($) => $.shell.settings.data.storage.stats.folders, {
                count: storageSummary.directory_count,
              }),
            },
            {
              id: "images",
              label: t(($) => $.shell.settings.data.storage.stats.images),
              value: formatNumber(storageSummary.image_count),
              detail: formatBytes(storageSummary.image_bytes),
            },
            {
              id: "pdfs",
              label: t(($) => $.shell.settings.data.storage.stats.pdfs),
              value: formatNumber(storageSummary.pdf_count),
              detail: formatBytes(storageSummary.pdf_bytes),
            },
            {
              id: "sources",
              label: t(($) => $.shell.settings.data.storage.stats.projectFiles),
              value: formatBytes(storageSummary.source_bytes),
              detail: t(($) => $.shell.settings.data.storage.stats.projectFilesDetail),
            },
            {
              id: "git",
              label: t(($) => $.shell.settings.data.storage.stats.gitHistory),
              value: formatBytes(storageSummary.git_bytes),
              detail: t(($) => $.shell.settings.data.storage.stats.gitHistoryDetail),
            },
            {
              id: "build",
              label: t(($) => $.shell.settings.data.storage.stats.buildCache),
              value: formatBytes(storageSummary.build_bytes),
              detail: t(($) => $.shell.settings.data.storage.stats.buildCacheDetail),
            },
            {
              id: "appData",
              label: t(($) => $.shell.settings.data.storage.stats.appData),
              value: formatBytes(storageSummary.app_data_bytes),
              detail: t(($) => $.shell.settings.data.storage.stats.appDataDetail),
            },
          ].map((item) => (
            <div key={item.id} className="min-w-0 bg-card px-3 py-3">
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
      );
    }
    return (
      <p className="px-4 py-5 text-sm text-muted-foreground">
        {t(($) => $.shell.settings.data.storage.desktopOnly)}
      </p>
    );
  };

  const renderRecycleBin = () => {
    if (storageLoading && !storageSummary) {
      return (
        <output
          className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"
        >
          <RefreshCw
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          {t(($) => $.shell.settings.data.recycleBin.loading)}
        </output>
      );
    }
    if (recycledProjects.length === 0) {
      return (
        <p className="px-4 py-5 text-sm text-muted-foreground">
          {t(($) => $.shell.settings.data.recycleBin.empty)}
        </p>
      );
    }
    return (
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
                  {t(($) => $.shell.settings.data.recycleBin.deletedAt, {
                    date: formatDateTime(project.deleted_at * 1000),
                    size: formatBytes(project.size_bytes),
                  })}
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
                  {t(($) => $.shell.settings.data.recycleBin.restore)}
                </Button>
                <Tooltip
                  label={t(($) => $.shell.settings.data.recycleBin.deleteOne, {
                    name: project.name,
                  })}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    disabled={recycleActionId !== null || clearingRecycleBin}
                    aria-label={t(($) => $.shell.settings.data.recycleBin.deleteOne, {
                      name: project.name,
                    })}
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
    );
  };

  const renderExperimentationSection = () => (
    section === "experimentation" && (
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{t(($) => $.shell.settings.experimentation.warning)}</span>
        </div>
        <SettingsToggleRow
          label={t(($) => $.shell.settings.experimentation.visualEditor.label)}
          description={t(($) => $.shell.settings.experimentation.visualEditor.description)}
          checked={visualEditor}
          onChange={setVisualEditor}
        />
        <SettingsToggleRow
          label={t(($) => $.shell.settings.experimentation.latexTools.label)}
          description={t(($) => $.shell.settings.experimentation.latexTools.description)}
          checked={latexTools}
          onChange={setLatexTools}
        />
        <SettingsToggleRow
          label={t(($) => $.shell.settings.experimentation.webBrowser.label)}
          description={t(($) => $.shell.settings.experimentation.webBrowser.description)}
          checked={webBrowser}
          onChange={setWebBrowser}
        />
        <ResetToDefaults
          sectionName={t(($) => $.shell.settings.nav.experimentation)}
          onReset={resetExperimentationPreferences}
        />
      </div>
    )
  );

  const renderSettingsBody = () => (
    <div className="flex-1 overflow-auto p-5">
      {section === "appearance" && <AppearanceSection />}

      {renderGeneralSection()}

      {section === "dictionary" && <DictionarySection />}

      {renderDataSection()}

      {section === "ai" && <AISection />}

      {section === "engine" && <EngineSection />}
      {section === "downloads" && <DownloadsSection />}

      {section === "integrations" && <IntegrationsSection />}

      {section === "shortcuts" && <ShortcutsSection />}

      {renderExperimentationSection()}

      {section === "developer" && developerSettings ? (
        <developerSettings.DeveloperSettings />
      ) : null}

      {section === "help" && <HelpSection />}
    </div>
  );

  const renderStorageUsageCard = () => (
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
              {t(($) => $.shell.settings.data.storage.title)}
            </h3>
            <p className="text-xs text-muted-foreground">
              {storageSummary
                ? t(($) => $.shell.settings.data.storage.total, {
                    size: formatBytes(storageSummary.total_bytes),
                  })
                : t(($) => $.shell.settings.data.storage.subtitle)}
            </p>
          </div>
        </div>
        <Tooltip label={t(($) => $.shell.settings.data.storage.refresh)}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            disabled={storageLoading || !isTauri()}
            aria-label={t(($) => $.shell.settings.data.storage.refresh)}
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
      {renderStorageSummary()}
      {storageSummary && storageSummary.unreadable_entries > 0 ? (
        <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">
          {t(($) => $.shell.settings.data.storage.unreadable, {
            count: storageSummary.unreadable_entries,
          })}
        </p>
      ) : null}
    </section>
  );

  const renderDataSection = () => (
    section === "data" && (
      <Tabs defaultValue="local" className="space-y-4 text-sm">
        <TabsList>
          <TabsTrigger value="local" data-testid="data-tab-local">
            {t(($) => $.shell.settings.data.tabs.local)}
          </TabsTrigger>
          <TabsTrigger value="cloud" data-testid="data-tab-cloud">
            {t(($) => $.shell.settings.data.tabs.cloud)}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="local" className="space-y-3">
        <p className="text-muted-foreground">
          {t(($) => $.shell.settings.data.localFirst)}
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border bg-background p-3 text-xs">
            {libRoot || "~/.oleafly/projects"}
          </code>
          {import.meta.env.DEV && isTauri() && libRoot ? (
            <Tooltip label={t(($) => $.shell.settings.data.reveal)}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t(($) => $.shell.settings.data.reveal)}
                onClick={() => void openExternal(libRoot)}
              >
                <FolderOpen className="size-4" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.shell.settings.data.plainFolders)}
        </p>
        {renderStorageUsageCard()}
        <CheckpointToggles />
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
                  {t(($) => $.shell.settings.data.recycleBin.title)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {storageSummary
                    ? t(($) => $.shell.settings.data.recycleBin.size, {
                        size: formatBytes(storageSummary.recycle_bin_bytes),
                      })
                    : t(($) => $.shell.settings.data.recycleBin.subtitle)}
                </p>
              </div>
            </div>
            {recycledProjects.length > 0 ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {formatNumber(recycledProjects.length)}
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
                  {clearingRecycleBin
                    ? t(($) => $.shell.settings.data.recycleBin.clearing)
                    : t(($) => $.shell.settings.data.recycleBin.clearAll)}
                </Button>
              </div>
            ) : null}
          </div>
          {renderRecycleBin()}
        </section>
        {githubStatus === "disconnected" ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-card p-3 text-xs text-muted-foreground">
          <Github className="mt-0.5 size-4 shrink-0" />
          <span>
            <Trans
              ns="shell"
              i18nKey={($) => $.shell.settings.data.githubHint}
              components={{
                push: <strong className="font-medium text-foreground" />,
                pull: <strong className="font-medium text-foreground" />,
                setup: (
                  <button
                    type="button"
                    onClick={() => setSection("integrations")}
                    className="font-medium text-primary hover:underline"
                  />
                ),
              }}
            />
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
              {t(($) => $.shell.settings.data.danger.title)}
            </h3>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t(($) => $.shell.settings.data.danger.deleteAll)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(($) => $.shell.settings.data.danger.deleteAllDescription)}
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
              {deletingAllProjects
                ? t(($) => $.shell.settings.data.danger.deleting)
                : t(($) => $.shell.settings.data.danger.deleteAllAction)}
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
              <h3 className="font-semibold text-foreground">
                {t(($) => $.shell.settings.data.cloud.title)}
              </h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(($) => $.shell.settings.data.cloud.comingSoon)}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(($) => $.shell.settings.data.cloud.description)}
            </p>
          </div>
        </div>
        </TabsContent>
      </Tabs>
    )
  );

  const renderGeneralSection = () => (
    section === "general" && (
      <div className="space-y-2 [&>[role=switch]]:bg-card">
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
          <div>
            <div className="text-sm font-medium">{t(($) => $.settings.language.label)}</div>
            <div className="text-xs text-muted-foreground">
              {t(($) => $.settings.language.description)}
            </div>
          </div>
          <Select
            value={uiLocalePreference}
            onValueChange={(value) => {
              if (isLocalePreference(value)) setUiLocalePreference(value);
            }}
          >
            <SelectTrigger
              aria-label={t(($) => $.settings.language.ariaLabel)}
              className="w-[176px]"
              data-testid="settings-language"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              <SelectItem value="system">{t(($) => $.settings.language.system)}</SelectItem>
              {SUPPORTED_LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {LOCALE_INFO[locale].nativeName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t(($) => $.settings.language.note)}
        </div>
        <SettingsToggleRow
          label={t(($) => $.shell.settings.general.spellcheck.label)}
          description={t(($) => $.shell.settings.general.spellcheck.description)}
          checked={spellcheck}
          onChange={toggleSpellcheck}
        />
        <SettingsToggleRow
          label={t(($) => $.shell.settings.general.harper.label)}
          description={t(($) => $.shell.settings.general.harper.description)}
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
                  {t(($) => $.shell.settings.general.dialect.label)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(($) => $.shell.settings.general.dialect.description)}
                </div>
              </div>
              <Select
                value={grammarDialect}
                onValueChange={(value) =>
                  setGrammarDialect(value as GrammarDialect)
                }
              >
                <SelectTrigger
                  aria-label={t(($) => $.shell.settings.general.dialect.ariaLabel)}
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
              label={t(($) => $.shell.settings.general.regionalism.label)}
              description={t(($) => $.shell.settings.general.regionalism.description)}
              checked={showRegionalism}
              onChange={setShowRegionalism}
            />
            <SettingsToggleRow
              label={t(($) => $.shell.settings.general.wordChoice.label)}
              description={t(($) => $.shell.settings.general.wordChoice.description)}
              checked={showWordChoice}
              onChange={setShowWordChoice}
            />
          </>
        )}
        {spellcheck && (
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
            <div>
              <div className="text-sm font-medium">
                {t(($) => $.shell.settings.general.dictionary.label)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(($) => $.shell.settings.general.dictionary.description)}
              </div>
            </div>
            <Select
              value={dictionaryLocale}
              onValueChange={(value) =>
                setDictionaryLocale(value as DictionaryLocale)
              }
            >
              <SelectTrigger
                aria-label={t(($) => $.shell.settings.general.dictionary.ariaLabel)}
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
          {t(($) => $.shell.settings.general.proofreadingNote)}
        </div>
        <SettingsToggleRow
          label={t(($) => $.shell.settings.general.offline.label)}
          description={t(($) => $.shell.settings.general.offline.description)}
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
                <span className="block text-sm font-medium">
                  {t(($) => $.shell.settings.tours.enable)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(($) => $.shell.settings.tours.summary, {
                    completed: completedTours,
                    dismissed: dismissedTours,
                    total: TOUR_IDS.length,
                  })}
                </span>
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={toursEnabled}
              aria-label={t(($) => $.shell.settings.tours.enableAll)}
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
                      <p className="text-sm font-medium">
                        {resolveTourText(tourRegistry[id].label)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(($) => $.shell.settings.tours.status[status])}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={t(($) => $.shell.settings.tours.enableOne, {
                        name: resolveTourText(tourRegistry[id].label),
                      })}
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
                  <p className="text-sm font-medium">
                    {t(($) => $.shell.settings.tours.progress)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(($) => $.shell.settings.tours.progressDetail, {
                      completed: completedTours,
                      dismissed: dismissedTours,
                    })}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!toursEnabled && dismissedTours === TOUR_IDS.length}
                  onClick={() => setTourConfirmation("dismiss-all")}
                >
                  {t(($) => $.shell.settings.tours.dismissAll)}
                </Button>
              </div>
            </div>
          )}
        </div>
        <ResetToDefaults
          sectionName={t(($) => $.shell.settings.nav.general)}
          onReset={resetGeneralPreferences}
        />
      </div>
    )
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label={t(($) => $.shell.settings.close)}
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        data-modal-initial-focus
        aria-modal="true"
        aria-label={t(($) => $.shell.settings.title)}
        className="relative flex h-[min(900px,88vh)] min-h-[min(540px,88vh)] w-[min(880px,94vw)] overflow-hidden rounded-xl border bg-background shadow-2xl outline-none"
      >
        <nav
          aria-label={t(($) => $.shell.settings.sectionsNav)}
          data-tour="settings-navigation-panel"
          className="flex min-h-0 w-52 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-3"
        >
          <div
            data-tour="settings-navigation"
            className="mb-2 shrink-0 px-2 text-sm font-semibold"
          >
            {t(($) => $.shell.settings.title)}
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
              aria-label={t(($) => $.shell.settings.close)}
              data-testid="settings-close"
              onClick={closeSettings}
            >
              <X className="size-4" />
            </Button>
          </div>
          {renderSettingsBody()}
        </div>
      </div>
      <ConfirmationDialog
        open={tourConfirmation !== null}
        title={
          tourConfirmation === "disable"
            ? t(($) => $.shell.settings.tours.disableTitle)
            : t(($) => $.shell.settings.tours.dismissAllTitle)
        }
        description={t(($) => $.shell.settings.tours.confirmDescription)}
        confirmLabel={
          tourConfirmation === "disable"
            ? t(($) => $.shell.settings.tours.disableConfirm)
            : t(($) => $.shell.settings.tours.dismissAllConfirm)
        }
        destructive
        onCancel={() => setTourConfirmation(null)}
        onConfirm={() => {
          useTourStore.getState().dismissAll();
          setTourConfirmation(null);
        }}
      />
      <ConfirmationDialog
        open={permanentDeleteTarget !== null}
        title={t(($) => $.shell.settings.data.recycleBin.confirmDeleteTitle, {
          name: permanentDeleteTarget?.name ?? t(($) => $.shell.toolbar.untitledProject),
        })}
        description={t(($) => $.shell.settings.data.recycleBin.confirmDeleteDescription)}
        confirmLabel={t(($) => $.shell.settings.data.recycleBin.confirmDeleteAction)}
        destructive
        onCancel={() => setPermanentDeleteTarget(null)}
        onConfirm={() => void confirmPermanentProjectDeletion()}
      />
      <ConfirmationDialog
        open={confirmClearRecycleBin}
        title={t(($) => $.shell.settings.data.recycleBin.confirmClearTitle, {
          count: recycledProjects.length,
        })}
        description={t(($) => $.shell.settings.data.recycleBin.confirmClearDescription)}
        confirmLabel={t(($) => $.shell.settings.data.recycleBin.confirmClearAction)}
        destructive
        onCancel={() => setConfirmClearRecycleBin(false)}
        onConfirm={() => void clearRecycleBin()}
      />
      <ConfirmationDialog
        open={confirmDeleteAllProjects}
        title={t(($) => $.shell.settings.data.danger.confirmDeleteAllTitle, {
          count: projects.length,
        })}
        description={t(($) => $.shell.settings.data.danger.confirmDeleteAllDescription)}
        confirmLabel={t(($) => $.shell.settings.data.danger.confirmDeleteAllAction)}
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
  const { t } = useTranslation(["common", "shell"]);
  const [version, setVersion] = useState("");
  const [copied, setCopied] = useState(false);
  const [repoStats, setRepoStats] = useState<GitHubRepoStats | null>(null);
  useEffect(() => {
    appVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
  useEffect(() => {
    let active = true;
    githubGetPublicRepoStats("Oleafly/Oleafly")
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
    {
      icon: Compass,
      label: t(($) => $.shell.settings.help.resources.startTour),
      onClick: beginTour,
      external: false,
    },
    {
      icon: BookOpen,
      label: t(($) => $.shell.settings.help.resources.documentation),
      onClick: ext(DOCS_URL),
      external: true,
    },
    {
      icon: GraduationCap,
      label: t(($) => $.shell.settings.help.resources.learn),
      onClick: ext(LEARN_URL),
      external: true,
    },
    {
      icon: TriangleAlert,
      label: t(($) => $.shell.settings.help.resources.reportCrash),
      onClick: () => void reportCrashToGithub(),
      external: true,
    },
    {
      icon: ScrollText,
      label: t(($) => $.shell.settings.help.resources.whatsNew),
      onClick: ext(CHANGELOG_URL),
      external: true,
    },
    {
      icon: Scale,
      label: t(($) => $.shell.settings.help.resources.license),
      onClick: ext(LICENSE_URL),
      external: true,
    },
  ];

  const community = [
    {
      id: "discussions",
      icon: MessageCircle,
      label: t(($) => $.shell.about.links.discussions.label),
      description: t(($) => $.shell.about.links.discussions.description),
      onClick: ext(DISCUSSIONS_URL),
    },
    {
      id: "issues",
      icon: Bug,
      label: t(($) => $.shell.about.links.issues.label),
      description: t(($) => $.shell.about.links.issues.description),
      onClick: ext(ISSUES_URL),
    },
    {
      id: "social",
      icon: AtSign,
      label: t(($) => $.shell.about.links.social.label),
      description: t(($) => $.shell.about.links.social.description),
      onClick: ext(X_URL),
    },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 px-1">
        <OleaflyAssistantMascot className="size-20" />
        <div
          role="note"
          aria-label={t(($) => $.shell.settings.help.supportAriaLabel)}
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
            <Trans
              ns="shell"
              i18nKey={($) => $.shell.settings.help.support}
              components={{
                star: (
                  <button
                    type="button"
                    onClick={ext(REPO_URL)}
                    className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:text-primary"
                  />
                ),
              }}
            />
          </span>
        </div>
      </div>

      <div
        data-testid="about-oleafly-section"
        className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-3 rounded-md border p-4"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-sm font-semibold">{"Oleafly"}</h3>
            {version && (
              <span className="text-[11px] text-muted-foreground">
                {t(($) => $.shell.settings.help.versionShort, { version })}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-[42rem] text-xs leading-relaxed text-muted-foreground">
            {t(($) => $.shell.settings.help.tagline)}
          </p>
        </div>
        <img
          data-testid="about-oleafly-logo"
          src="/oleafly-tile-gradient.png"
          alt={t(($) => $.shell.settings.help.logoAlt)}
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
            {copied
              ? t(($) => $.common.actions.copied)
              : t(($) => $.shell.settings.help.copyInfo)}
          </button>
        </div>
      </div>

      <CiteOleaflyCard version={version} />

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
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t(($) => $.shell.settings.help.project)}
        </p>
        <button type="button"
          onClick={ext(REPO_URL)}
          className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <Github className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{t(($) => $.shell.settings.help.starRepo)}</span>
          {repoStats && (
            <span className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
              <span
                role="img"
                className="inline-flex items-center gap-1"
                aria-label={t(($) => $.shell.settings.help.stars, {
                  count: repoStats.stars,
                })}
                title={t(($) => $.shell.settings.help.starsTitle)}
              >
                <Star aria-hidden="true" className="size-3.5" />
                {formatNumber(repoStats.stars)}
              </span>
              <span
                role="img"
                className="inline-flex items-center gap-1"
                aria-label={t(($) => $.shell.settings.help.forks, {
                  count: repoStats.forks,
                })}
                title={t(($) => $.shell.settings.help.forksTitle)}
              >
                <GitFork aria-hidden="true" className="size-3.5" />
                {formatNumber(repoStats.forks)}
              </span>
            </span>
          )}
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t(($) => $.shell.settings.help.community)}
        </p>
        {community.map((item) => (
          <button
            key={item.id}
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
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t(($) => $.shell.settings.help.resourcesTitle)}
        </p>
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

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DatabaseZap,
  FolderPlus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  libraryRoot,
  listProjects,
  recycleProject,
} from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { LEGACY_TOUR_KEYS, useTourStore } from "@/store/tours";
import { RESEARCH_SEED_PROJECTS } from "@/developer/research-seed-catalog";
import {
  researchSeedRoot,
  seedResearchProjects,
  type ResearchSeedResult,
} from "@/developer/seed-research-projects";

export const DEVELOPER_SETTINGS_SENTINEL = "oleafly-developer-settings-v1";

export const DEVELOPER_NAV_ITEM = {
  id: "developer" as const,
  get label() {
    return i18n.t(($) => $.core.developer.nav);
  },
  icon: Wrench,
};

type ConfirmAction = "clear-projects" | "reset-browser" | "reset-and-seed";

export function isDevelopmentLibraryRoot(path: string): boolean {
  const normalized = path.trim().replaceAll("\\", "/").replace(/(?<!\/)\/+$/, "").toLowerCase();
  return normalized.endsWith("/.oleafly-dev/projects");
}

function SettingAction({
  title,
  description,
  icon: Icon,
  action,
  buttonLabel,
  disabled,
  destructive = false,
}: Readonly<{
  title: string;
  description: string;
  icon: typeof Wrench;
  action: () => void;
  buttonLabel?: string;
  disabled?: boolean;
  destructive?: boolean;
}>) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button
        type="button"
        variant={destructive ? "destructive" : "secondary"}
        size="sm"
        className="shrink-0"
        disabled={disabled}
        onClick={action}
      >
        {buttonLabel ?? title}
      </Button>
    </div>
  );
}

export function DeveloperSettings() {
  const { t } = useTranslation(["common", "core"]);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [seedProgress, setSeedProgress] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const safeSandbox = isDevelopmentLibraryRoot(root);

  useEffect(() => {
    void libraryRoot().then(setRoot).catch(() => setRoot(""));
  }, []);

  const closeOpenProject = async () => {
    const store = useFilesStore.getState();
    if (!store.projectId) return;
    await store.closeProject();
    if (useFilesStore.getState().projectId) {
      throw new Error(i18n.t(($) => $.core.developer.closeProjectFailed));
    }
  };

  const moveAllProjectsToRecycleBin = async () => {
    await closeOpenProject();
    const projects = await listProjects();
    for (const project of projects) {
      await recycleProject(project.id);
    }
    await useFilesStore.getState().refreshProjects();
    return projects.length;
  };

  const seedSampleProjects = async () => {
    const result = await seedResearchProjects(researchSeedRoot(root), ({ current, total, name }) => {
      setSeedProgress(`${current}/${total} · ${name}`);
    });
    await useFilesStore.getState().refreshProjects();
    setSeedProgress("");
    return result;
  };

  const reportSeedResult = (result: ResearchSeedResult, removed: number | null = null) => {
    const summary =
      removed === null
        ? t(($) => $.core.developer.seedSummary, {
            created: result.created,
            skipped: result.skipped,
          })
        : t(($) => $.core.developer.resetAndSeedSummary, {
            removed,
            created: result.created,
            skipped: result.skipped,
          });
    if (result.failed.length > 0) {
      const first = result.failed[0];
      toast.error(
        t(($) => $.core.developer.seedFailures, {
          summary,
          count: result.failed.length,
          name: first.name,
          message: first.message,
        }),
        undefined,
        true,
      );
      return;
    }
    toast.success(summary);
  };

  const replayFirstRun = async () => {
    setBusy(true);
    try {
      useTourStore.getState().resetAll();
      for (const key of Object.values(LEGACY_TOUR_KEYS)) {
        if (key) localStorage.removeItem(key);
      }
      await closeOpenProject();
      useSettingsStore.getState().setSettingsOpen(false);
      window.location.reload();
    } catch (error) {
      notifyError("replay first run", error, t(($) => $.core.developer.replayFailed));
      setBusy(false);
    }
  };

  const confirm = async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;
    setBusy(true);
    try {
      if (action === "reset-browser") {
        await closeOpenProject();
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
          const key = localStorage.key(index);
          if (key?.startsWith("oleafly.") || key?.startsWith("ol-")) {
            localStorage.removeItem(key);
          }
        }
        window.location.reload();
        return;
      }

      const removed = await moveAllProjectsToRecycleBin();
      if (action === "reset-and-seed") {
        const result = await seedSampleProjects();
        reportSeedResult(result, removed);
      } else {
        toast.success(t(($) => $.core.developer.projectsRecycled, { count: removed }));
      }
    } catch (error) {
      notifyError("reset development data", error, t(($) => $.core.developer.resetFailed));
    } finally {
      setSeedProgress("");
      setBusy(false);
    }
  };

  const confirmation = {
    "clear-projects": {
      title: t(($) => $.core.developer.confirm.clearProjects.title),
      description: t(($) => $.core.developer.confirm.clearProjects.description),
      label: t(($) => $.core.developer.confirm.clearProjects.action),
    },
    "reset-browser": {
      title: t(($) => $.core.developer.confirm.resetBrowser.title),
      description: t(($) => $.core.developer.confirm.resetBrowser.description),
      label: t(($) => $.core.developer.confirm.resetBrowser.action),
    },
    "reset-and-seed": {
      title: t(($) => $.core.developer.confirm.resetAndSeed.title),
      description: t(($) => $.core.developer.confirm.resetAndSeed.description, {
        count: RESEARCH_SEED_PROJECTS.length,
      }),
      label: t(($) => $.core.developer.confirm.resetAndSeed.action),
    },
  } as const;

  return (
    <div className="space-y-4" data-build-sentinel={DEVELOPER_SETTINGS_SENTINEL}>
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-3">
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{t(($) => $.core.developer.debugOnly.title)}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t(($) => $.core.developer.debugOnly.description)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <p className="text-xs font-medium">{t(($) => $.core.developer.library.label)}</p>
        <code className="mt-1 block break-all text-[11px] text-muted-foreground">
          {root || t(($) => $.core.developer.library.checking)}
        </code>
        {!safeSandbox && root ? (
          <p className="mt-2 text-xs font-medium text-destructive">
            {t(($) => $.core.developer.library.locked)}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <SettingAction
          title={t(($) => $.core.developer.actions.replayFirstRun.title)}
          description={t(($) => $.core.developer.actions.replayFirstRun.description)}
          icon={RotateCcw}
          action={() => void replayFirstRun()}
          disabled={busy}
        />
        <SettingAction
          title={t(($) => $.core.developer.actions.resetUiState.title)}
          description={t(($) => $.core.developer.actions.resetUiState.description)}
          icon={DatabaseZap}
          action={() => setConfirmAction("reset-browser")}
          disabled={busy}
        />
        <SettingAction
          title={t(($) => $.core.developer.actions.seedCorpus.title)}
          description={t(($) => $.core.developer.actions.seedCorpus.description, {
            count: RESEARCH_SEED_PROJECTS.length,
          })}
          icon={FolderPlus}
          buttonLabel={seedProgress || t(($) => $.core.developer.actions.seedCorpus.action)}
          action={() => {
            setBusy(true);
            void seedSampleProjects()
              .then((result) => reportSeedResult(result))
              .catch((error) =>
                notifyError(
                  "seed development projects",
                  error,
                  t(($) => $.core.developer.seedFailed),
                ),
              )
              .finally(() => {
                setSeedProgress("");
                setBusy(false);
              });
          }}
          disabled={busy || !safeSandbox}
        />
        <SettingAction
          title={t(($) => $.core.developer.actions.clearProjects.title)}
          description={t(($) => $.core.developer.actions.clearProjects.description)}
          icon={Trash2}
          action={() => setConfirmAction("clear-projects")}
          disabled={busy || !safeSandbox}
          destructive
        />
        <SettingAction
          title={t(($) => $.core.developer.actions.resetAndSeed.title)}
          description={t(($) => $.core.developer.actions.resetAndSeed.description, {
            count: RESEARCH_SEED_PROJECTS.length,
          })}
          icon={Wrench}
          action={() => setConfirmAction("reset-and-seed")}
          disabled={busy || !safeSandbox}
        />
      </div>

      <ConfirmationDialog
        open={confirmAction !== null}
        title={
          confirmAction
            ? confirmation[confirmAction].title
            : t(($) => $.core.developer.confirm.fallbackTitle)
        }
        description={confirmAction ? confirmation[confirmAction].description : ""}
        confirmLabel={
          confirmAction ? confirmation[confirmAction].label : t(($) => $.common.actions.confirm)
        }
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}

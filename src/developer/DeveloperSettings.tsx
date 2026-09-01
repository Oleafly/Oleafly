import { useEffect, useState } from "react";
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
import { cancelAutoCommit } from "@/lib/auto-commit";
import { notifyError, toast } from "@/lib/toast";
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
  label: "Developer",
  icon: Wrench,
};

type ConfirmAction = "clear-projects" | "reset-browser" | "reset-and-seed";

export function isDevelopmentLibraryRoot(path: string): boolean {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
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
}: {
  title: string;
  description: string;
  icon: typeof Wrench;
  action: () => void;
  buttonLabel?: string;
  disabled?: boolean;
  destructive?: boolean;
}) {
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
    cancelAutoCommit(store.projectId);
    await store.closeProject();
    if (useFilesStore.getState().projectId) {
      throw new Error("The open project could not be closed safely.");
    }
  };

  const moveAllProjectsToRecycleBin = async () => {
    await closeOpenProject();
    const projects = await listProjects();
    for (const project of projects) {
      cancelAutoCommit(project.id);
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

  const reportSeedResult = (result: ResearchSeedResult, prefix = "Seeded the research corpus") => {
    const summary = `${prefix}: ${result.created} created, ${result.skipped} already present`;
    if (result.failed.length > 0) {
      const first = result.failed[0];
      toast.error(`${summary}, ${result.failed.length} failed. First failure: ${first.name}: ${first.message}`, undefined, true);
      return;
    }
    toast.success(`${summary}.`);
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
      notifyError("replay first run", error, "Couldn't reset the first-run tour.");
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
        reportSeedResult(result, `Moved ${removed} projects to the Recycle Bin and seeded the research corpus`);
      } else {
        toast.success(`Moved ${removed} ${removed === 1 ? "project" : "projects"} to the Recycle Bin.`);
      }
    } catch (error) {
      notifyError("reset development data", error, "Couldn't reset the development sandbox.");
    } finally {
      setSeedProgress("");
      setBusy(false);
    }
  };

  const confirmation = {
    "clear-projects": {
      title: "Clear all development projects?",
      description: "Every project in the isolated development library moves to its Recycle Bin. Your production Oleafly library is not touched.",
      label: "Clear projects",
    },
    "reset-browser": {
      title: "Reset development UI state?",
      description: "This clears Oleafly settings, tours, and other browser state for this development origin, then reloads the app. Project files stay on disk.",
      label: "Reset UI state",
    },
    "reset-and-seed": {
      title: "Reset and seed the development library?",
      description: `Every current development project moves to the Recycle Bin, then Oleafly copies ${RESEARCH_SEED_PROJECTS.length} research fixtures from the local oleafly-seed cache.`,
      label: "Reset and seed",
    },
  } as const;

  return (
    <div className="space-y-4" data-build-sentinel={DEVELOPER_SETTINGS_SENTINEL}>
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-3">
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Debug build only</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              These controls are loaded only by the Vite development build. Production builds
              reject this module if its sentinel appears in any emitted asset.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <p className="text-xs font-medium">Development library</p>
        <code className="mt-1 block break-all text-[11px] text-muted-foreground">
          {root || "Checking library path…"}
        </code>
        {!safeSandbox && root ? (
          <p className="mt-2 text-xs font-medium text-destructive">
            Project controls are locked because this is not the .oleafly-dev sandbox.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <SettingAction
          title="Replay first run"
          description="Reset every tour, close the current project, and return to the welcome flow."
          icon={RotateCcw}
          action={() => void replayFirstRun()}
          disabled={busy}
        />
        <SettingAction
          title="Reset UI state"
          description="Clear Oleafly local settings and persisted UI state without deleting projects."
          icon={DatabaseZap}
          action={() => setConfirmAction("reset-browser")}
          disabled={busy}
        />
        <SettingAction
          title="Seed research corpus"
          description={`Copy ${RESEARCH_SEED_PROJECTS.length} research projects from ~/Codespace/Oleafly/oleafly-seed. Papers, theses, books, talks, posters, and figures across LaTeX and Typst, every one verified to compile with the bundled engines. Existing fixtures are kept.`}
          icon={FolderPlus}
          buttonLabel={seedProgress || "Seed corpus"}
          action={() => {
            setBusy(true);
            void seedSampleProjects()
              .then((result) => reportSeedResult(result))
              .catch((error) => notifyError("seed development projects", error, "Couldn't seed the research corpus."))
              .finally(() => {
                setSeedProgress("");
                setBusy(false);
              });
          }}
          disabled={busy || !safeSandbox}
        />
        <SettingAction
          title="Clear projects"
          description="Move every development project to the Recycle Bin. Nothing is permanently deleted."
          icon={Trash2}
          action={() => setConfirmAction("clear-projects")}
          disabled={busy || !safeSandbox}
          destructive
        />
        <SettingAction
          title="Reset and seed"
          description={`Move current projects to the Recycle Bin, then copy all ${RESEARCH_SEED_PROJECTS.length} pinned real-world fixtures from the local cache.`}
          icon={Wrench}
          action={() => setConfirmAction("reset-and-seed")}
          disabled={busy || !safeSandbox}
        />
      </div>

      <ConfirmationDialog
        open={confirmAction !== null}
        title={confirmAction ? confirmation[confirmAction].title : "Confirm development action"}
        description={confirmAction ? confirmation[confirmAction].description : ""}
        confirmLabel={confirmAction ? confirmation[confirmAction].label : "Continue"}
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}

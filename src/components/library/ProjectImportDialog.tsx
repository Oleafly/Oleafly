import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  ChevronLeft,
  ExternalLink,
  FileText,
  FileType2,
  Github,
  Loader2,
  Lock,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { githubListRepos, type GitHubRepo } from "@/lib/github";
import {
  importGitHubRepository,
  importSelectedFile,
  type ProjectImportFileKind,
} from "@/features/project-import";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";

function pickerOptions(kind: ProjectImportFileKind) {
  switch (kind) {
    case "project":
      return {
        multiple: false as const,
        filters: [
          { name: i18n.t(($) => $.library.import.picker.projectFilter), extensions: ["zip"] },
        ],
        title: i18n.t(($) => $.library.import.picker.projectTitle),
      };
    case "word":
      return {
        multiple: false as const,
        filters: [
          { name: i18n.t(($) => $.library.import.picker.wordFilter), extensions: ["docx"] },
        ],
        title: i18n.t(($) => $.library.import.picker.wordTitle),
      };
    case "markdown":
      return {
        multiple: false as const,
        filters: [
          {
            name: i18n.t(($) => $.library.import.picker.markdownFilter),
            extensions: ["md", "markdown"],
          },
        ],
        title: i18n.t(($) => $.library.import.picker.markdownTitle),
      };
  }
}

const LOCAL_SOURCES: {
  kind: ProjectImportFileKind;
  icon: typeof Package;
}[] = [
  { kind: "project", icon: Package },
  { kind: "word", icon: FileType2 },
  { kind: "markdown", icon: FileText },
];

export function ProjectImportDialog({
  open,
  onClose,
  onImportStarted,
}: {
  open: boolean;
  onClose: () => void;
  onImportStarted?: () => void;
}) {
  const { t } = useTranslation(["library"]);
  const sourceCopy: Record<ProjectImportFileKind, { title: string; description: string }> = {
    project: {
      title: t(($) => $.library.import.sources.project.title),
      description: t(($) => $.library.import.sources.project.description),
    },
    word: {
      title: t(($) => $.library.import.sources.word.title),
      description: t(($) => $.library.import.sources.word.description),
    },
    markdown: {
      title: t(($) => $.library.import.sources.markdown.title),
      description: t(($) => $.library.import.sources.markdown.description),
    },
  };
  const githubStatus = useGithubStore((state) => state.status);
  const refreshGithub = useGithubStore((state) => state.refresh);
  const [view, setView] = useState<"sources" | "github">("sources");
  const [busy, setBusy] = useState(false);
  const [repositories, setRepositories] = useState<GitHubRepo[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [repositoryLoadFailed, setRepositoryLoadFailed] = useState(false);

  useEffect(() => {
    if (!open) setView("sources");
  }, [open]);

  useEffect(() => {
    if (view !== "github") return;
    if (githubStatus === "unknown") {
      void refreshGithub();
      return;
    }
    if (githubStatus !== "connected" || repositories.length > 0) return;
    let cancelled = false;
    setLoadingRepositories(true);
    setRepositoryLoadFailed(false);
    githubListRepos()
      .then((items) => {
        if (!cancelled) setRepositories(items);
      })
      .catch((error) => {
        void logError("github import repositories", error);
        if (!cancelled) setRepositoryLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingRepositories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, githubStatus, refreshGithub, repositories.length]);

  const importFile = async (kind: ProjectImportFileKind) => {
    const selection = await pickOpenPath(pickerOptions(kind));
    if (typeof selection !== "string") return;
    setBusy(true);
    onImportStarted?.();
    try {
      await importSelectedFile(selection);
    } catch (error) {
      notifyError("import", error);
    } finally {
      setBusy(false);
    }
  };

  const importRepository = async (repository: GitHubRepo) => {
    setBusy(true);
    onImportStarted?.();
    try {
      await importGitHubRepository(repository);
    } catch (error) {
      notifyError("import GitHub repository", error);
    } finally {
      setBusy(false);
    }
  };

  const openGithubSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("github");
    settings.setSettingsOpen(true);
    onImportStarted?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent data-testid="project-import-dialog" className="max-w-xl gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view === "github" ? (
              <button
                type="button"
                aria-label={t(($) => $.library.import.back)}
                data-testid="project-import-back"
                onClick={() => setView("sources")}
                className="rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {view === "github"
              ? t(($) => $.library.import.githubTitle)
              : t(($) => $.library.import.title)}
          </DialogTitle>
          <DialogDescription>
            {view === "github"
              ? t(($) => $.library.import.githubDescription)
              : t(($) => $.library.import.description)}
          </DialogDescription>
        </DialogHeader>

        {view === "sources" ? (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(($) => $.library.import.localHeading)}
              </h3>
              <div className="grid gap-2">
                {LOCAL_SOURCES.map((source) => (
                  <button
                    key={source.kind}
                    type="button"
                    disabled={busy}
                    data-testid={`project-import-${source.kind}`}
                    onClick={() => void importFile(source.kind)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
                      "hover:border-primary/40 hover:bg-accent disabled:opacity-60",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <source.icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {sourceCopy[source.kind].title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {sourceCopy[source.kind].description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(($) => $.library.import.cloudHeading)}
              </h3>
              <button
                type="button"
                disabled={busy}
                data-testid="project-import-github"
                onClick={() => setView("github")}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
                  "hover:border-primary/40 hover:bg-accent disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Github aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">GitHub</span>
                  <span className="block text-xs text-muted-foreground">
                    {githubStatus === "connected"
                      ? t(($) => $.library.import.githubConnected)
                      : t(($) => $.library.import.githubDisconnected)}
                  </span>
                </span>
                {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              </button>
            </section>
          </div>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {githubStatus === "disconnected" ? (
              <div className="space-y-3 rounded-lg border bg-card p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {t(($) => $.library.import.connectPrompt)}
                </p>
                <Button type="button" size="sm" onClick={openGithubSettings}>
                  <Github aria-hidden="true" className="size-3.5" />
                  {t(($) => $.library.import.connect)}
                </Button>
              </div>
            ) : githubStatus === "unknown" || loadingRepositories ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                {t(($) => $.library.import.loadingRepositories)}
              </p>
            ) : repositoryLoadFailed ? (
              <p className="p-3 text-sm text-muted-foreground">
                {t(($) => $.library.import.repositoriesFailed)}
              </p>
            ) : repositories.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {t(($) => $.library.import.noRepositories)}
              </p>
            ) : (
              repositories.map((repository) => (
                <div
                  key={repository.full_name}
                  className="group flex items-center gap-2 rounded-lg px-1 transition-colors hover:bg-accent"
                >
                  <button
                    type="button"
                    disabled={busy}
                    data-testid={`project-import-repository-${repository.full_name}`}
                    onClick={() => void importRepository(repository)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <Github aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{repository.full_name}</span>
                    {repository.private ? (
                      <Tooltip label={t(($) => $.library.import.privateRepository)} side="top">
                        <span
                          role="img"
                          aria-label={t(($) => $.library.import.privateRepository)}
                          className="inline-flex shrink-0"
                        >
                          <Lock aria-hidden="true" className="size-3 text-muted-foreground" />
                        </span>
                      </Tooltip>
                    ) : null}
                  </button>
                  <Tooltip label={t(($) => $.library.import.openOnGitHub)} side="top">
                    <button
                      type="button"
                      aria-label={t(($) => $.library.import.openRepository, {
                        name: repository.full_name,
                      })}
                      onClick={() => {
                        openExternal(repository.html_url).catch((error) => {
                          notifyError("open repository", error);
                        });
                      }}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </button>
                  </Tooltip>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

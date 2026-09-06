import { useEffect, useState } from "react";
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
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";

function pickerOptions(kind: ProjectImportFileKind) {
  switch (kind) {
    case "project":
      return {
        multiple: false as const,
        filters: [{ name: "ZIP archive", extensions: ["zip"] }],
        title: "Import a project archive",
      };
    case "word":
      return {
        multiple: false as const,
        filters: [{ name: "Word document", extensions: ["docx"] }],
        title: "Import a Word document",
      };
    case "markdown":
      return {
        multiple: false as const,
        filters: [{ name: "Markdown document", extensions: ["md", "markdown"] }],
        title: "Import a Markdown document",
      };
  }
}

const LOCAL_SOURCES: {
  kind: ProjectImportFileKind;
  title: string;
  description: string;
  icon: typeof Package;
}[] = [
  {
    kind: "project",
    title: "Existing project",
    description: "A .zip archive of a project folder.",
    icon: Package,
  },
  {
    kind: "word",
    title: "Word document",
    description: "A .docx file, converted on the way in.",
    icon: FileType2,
  },
  {
    kind: "markdown",
    title: "Markdown document",
    description: "A .md file, kept as Markdown.",
    icon: FileText,
  },
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
                aria-label="Back to import sources"
                data-testid="project-import-back"
                onClick={() => setView("sources")}
                className="rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {view === "github" ? "Import from GitHub" : "Import a project"}
          </DialogTitle>
          <DialogDescription>
            {view === "github"
              ? "Choose a repository to copy into your library."
              : "Oleafly copies what you choose into a new project. The original is left alone."}
          </DialogDescription>
        </DialogHeader>

        {view === "sources" ? (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                On this computer
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
                        {source.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {source.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                From the cloud
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
                      ? "Pick from the repositories you can reach."
                      : "Connect your account to list repositories."}
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
                  Connect GitHub in Settings to list your repositories here.
                </p>
                <Button type="button" size="sm" onClick={openGithubSettings}>
                  <Github aria-hidden="true" className="size-3.5" />
                  Connect GitHub
                </Button>
              </div>
            ) : githubStatus === "unknown" || loadingRepositories ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                Loading repositories…
              </p>
            ) : repositoryLoadFailed ? (
              <p className="p-3 text-sm text-muted-foreground">
                The repositories could not be loaded.
              </p>
            ) : repositories.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No repositories found.</p>
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
                      <Tooltip label="Private repository" side="top">
                        <span
                          role="img"
                          aria-label="Private repository"
                          className="inline-flex shrink-0"
                        >
                          <Lock aria-hidden="true" className="size-3 text-muted-foreground" />
                        </span>
                      </Tooltip>
                    ) : null}
                  </button>
                  <Tooltip label="Open on GitHub" side="top">
                    <button
                      type="button"
                      aria-label={`Open ${repository.full_name} on GitHub`}
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

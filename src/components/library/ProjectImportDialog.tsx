import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  ChevronLeft,
  ExternalLink,
  FileText,
  FileType2,
  Github,
  Globe,
  Loader2,
  Lock,
  Package,
  Sigma,
} from "lucide-react";
import { Input } from "@/components/ui/input";
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
  IMPORT_FILE_SOURCES,
  importPickerOptions,
  importArxivPaper,
  importFileKind,
  importGitHubRepository,
  importSelectedFile,
  importTargetsForKind,
  type ProjectImportFileKind,
} from "@/features/project-import";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const SOURCE_ICONS = { project: Package, word: FileType2, markdown: FileText, html: Globe, typst: Sigma };

export function ProjectImportDialog({
  open,
  onClose,
  onImported,
  initialView = "sources",
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  initialView?: "sources" | "arxiv";
}) {
  const { t } = useTranslation(["library"]);
  const sourceCopy: Partial<
    Record<ProjectImportFileKind, { title: string; description: string }>
  > = {
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
  const [view, setView] = useState<"sources" | "github" | "target" | "arxiv">(
    initialView,
  );
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [arxivId, setArxivId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sessionRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repositoryAttempt, setRepositoryAttempt] = useState(0);
  const [repositories, setRepositories] = useState<GitHubRepo[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [repositoryLoadFailed, setRepositoryLoadFailed] = useState(false);

  useEffect(() => {
    sessionRef.current += 1;
    setView(initialView);
    setPendingPath(null);
    setErrorMessage(null);
    if (!open) setArxivId("");
    return () => { sessionRef.current += 1; };
  }, [open, initialView]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry counter explicitly starts another request.
  useEffect(() => {
    if (!open || view !== "github") return;
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
  }, [open, view, githubStatus, refreshGithub, repositories.length, repositoryAttempt]);

  const reportError = (error: unknown) => {
    const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "The import could not finish. Try again.";
    setErrorMessage(detail);
    void logError("project import", error);
  };

  const runImport = async (work: () => Promise<boolean>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    try {
      const imported = await work();
      if (imported === false) {
        setErrorMessage("The document converter is unavailable. Check the download message, then try again.");
      } else {
        onImported?.();
        onClose();
      }
    } catch (error) {
      reportError(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const importFile = async (kind: ProjectImportFileKind) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    const session = sessionRef.current;
    let selection: string | null = null;
    try {
      const picked = await pickOpenPath(importPickerOptions(kind));
      if (session !== sessionRef.current || typeof picked !== "string") return;
      selection = picked;
      const fileKind = importFileKind(picked);
      if (!fileKind) throw new Error("Choose one of the supported document types.");
      if (importTargetsForKind(fileKind).length > 1) {
        setPendingPath(picked);
        setView("target");
        selection = null;
      }
    } catch (error) {
      reportError(error);
      selection = null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (selection) await runImport(() => importSelectedFile(selection));
  };

  const importWithTarget = async (target: "latex" | "markdown" | "typst") => {
    if (pendingPath) await runImport(() => importSelectedFile(pendingPath, target));
  };

  const importFromArxiv = async () => {
    if (arxivId.trim()) await runImport(() => importArxivPaper(arxivId));
  };

  const importRepository = async (repository: GitHubRepo) => {
    await runImport(async () => { await importGitHubRepository(repository); return true; });
  };

  const openGithubSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("github");
    settings.setSettingsOpen(true);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busyRef.current) onClose();
      }}
    >
      <DialogContent data-testid="project-import-dialog" className="max-w-xl gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view !== "sources" ? (
              <button
                type="button"
                aria-label={t(($) => $.library.import.back)}
                data-testid="project-import-back"
                disabled={busy}
                onClick={() => { setView("sources"); setErrorMessage(null); setPendingPath(null); }}
                className="rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {view === "github"
              ? t(($) => $.library.import.githubTitle)
              : view === "arxiv"
                ? "Import an arXiv paper"
                : view === "target"
                  ? "Choose the project type"
                  : t(($) => $.library.import.title)}
          </DialogTitle>
          <DialogDescription>
            {view === "github"
              ? t(($) => $.library.import.githubDescription)
              : view === "arxiv"
                ? "Oleafly downloads the paper's LaTeX source and unpacks it as a project."
                : view === "target"
                  ? "Choose the format you want to edit. Images or included files stored beside the original may need to be added to the new project."
                  : t(($) => $.library.import.description)}
          </DialogDescription>
        </DialogHeader>

        {errorMessage && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Importing your project…</p>}
        {view === "target" ? (
          <div className="grid gap-2">
            <p className="break-all text-xs text-muted-foreground">{pendingPath?.split(/[/\\]/).pop()}</p>
            {importTargetsForKind(importFileKind(pendingPath ?? "") ?? "word").map(
              (target) => (
                <button
                  key={target.target}
                  type="button"
                  disabled={busy}
                  data-testid={`project-import-target-${target.target}`}
                  onClick={() => void importWithTarget(target.target)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
                    "hover:border-primary/40 hover:bg-accent disabled:opacity-60",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {target.label}
                    </span>
                    {target.recommended ? (
                      <span className="block text-xs text-muted-foreground">
                        Recommended for this file type
                      </span>
                    ) : null}
                  </span>
                </button>
              ),
            )}
          </div>
        ) : view === "arxiv" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label="arXiv id or paper link"
                disabled={busy}
                data-testid="project-import-arxiv-id"
                value={arxivId}
                placeholder="arXiv id or https://arxiv.org/abs/…"
                onChange={(event) => setArxivId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void importFromArxiv();
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || arxivId.trim() === ""}
                onClick={() => void importFromArxiv()}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : null}
                Import
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Source files must be available on arXiv. For papers available only as a PDF, use the PDF import tool.
            </p>
          </div>
        ) : view === "sources" ? (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(($) => $.library.import.localHeading)}
              </h3>
              <div className="grid gap-2">
                {IMPORT_FILE_SOURCES.map((source) => {
                  const Icon = SOURCE_ICONS[source.kind];
                  const copy = sourceCopy[source.kind] ?? {
                    title: source.title,
                    description: source.description,
                  };
                  return (
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
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {copy.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {copy.description}
                      </span>
                    </span>
                  </button>
                ); })}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(($) => $.library.import.cloudHeading)}
              </h3>
              <button
                type="button"
                disabled={busy}
                data-testid="project-import-arxiv"
                onClick={() => setView("arxiv")}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
                  "hover:border-primary/40 hover:bg-accent disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sigma aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">arXiv paper</span>
                  <span className="block text-xs text-muted-foreground">
                    Download a paper's LaTeX source by its arXiv id.
                  </span>
                </span>
              </button>
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
              <div className="space-y-2 p-3">
                <p role="alert" className="text-sm text-muted-foreground">
                  {t(($) => $.library.import.repositoriesFailed)}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setRepositoryAttempt((attempt) => attempt + 1)}>Try again</Button>
              </div>
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

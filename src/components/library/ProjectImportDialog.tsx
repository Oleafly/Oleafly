import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ChevronLeft, ExternalLink, Github, Loader2, Lock } from "lucide-react";
import { ChoiceCard } from "@/components/library/ChoiceCard";
import { CHOICE_ART } from "@/components/library/choice-art";
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
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const SOURCE_ART: Record<ProjectImportFileKind, string> = {
  project: CHOICE_ART.importArchive,
  word: CHOICE_ART.importWord,
  markdown: CHOICE_ART.importMarkdown,
  html: CHOICE_ART.importHtml,
  typst: CHOICE_ART.importTypst,
};

export function ProjectImportDialog({
  open,
  onClose,
  onImported,
  initialView = "sources",
}: Readonly<{
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  initialView?: "sources" | "arxiv";
}>) {
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
    html: {
      title: t(($) => $.library.import.sources.html.title),
      description: t(($) => $.library.import.sources.html.description),
    },
    typst: {
      title: t(($) => $.library.import.sources.typst.title),
      description: t(($) => $.library.import.sources.typst.description),
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
  // The local source whose picker or import is running, so its card spins.
  const [busyKind, setBusyKind] = useState<ProjectImportFileKind | null>(null);
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
    const detail = error instanceof Error || typeof error === "string" ? describeError(error) : t(($) => $.library.import.failed);
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
        setErrorMessage(t(($) => $.library.import.converterUnavailable));
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
    setBusyKind(kind);
    setErrorMessage(null);
    const session = sessionRef.current;
    let selection: string | null = null;
    try {
      const picked = await pickOpenPath(importPickerOptions(kind));
      if (session !== sessionRef.current || typeof picked !== "string") return;
      selection = picked;
      const fileKind = importFileKind(picked);
      if (!fileKind) throw new Error(t(($) => $.library.import.supportedTypes));
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
      if (!selection) setBusyKind(null);
    }
    if (selection) {
      await runImport(() => importSelectedFile(selection));
      setBusyKind(null);
    }
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

  const renderRepositoryList = () => {
    if (githubStatus === "disconnected") {
      return (
        <div className="space-y-3 rounded-lg border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t(($) => $.library.import.connectPrompt)}
          </p>
          <Button type="button" size="sm" onClick={openGithubSettings}>
            <Github aria-hidden="true" className="size-3.5" />
            {t(($) => $.library.import.connect)}
          </Button>
        </div>
      );
    }
    if (githubStatus === "unknown" || loadingRepositories) {
      return (
        <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          {t(($) => $.library.import.loadingRepositories)}
        </p>
      );
    }
    if (repositoryLoadFailed) {
      return (
        <div className="space-y-2 p-3">
          <p role="alert" className="text-sm text-muted-foreground">
            {t(($) => $.library.import.repositoriesFailed)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRepositoryAttempt((attempt) => attempt + 1)}
          >
            {t(($) => $.library.import.tryAgain)}
          </Button>
        </div>
      );
    }
    if (repositories.length === 0) {
      return (
        <p className="p-3 text-sm text-muted-foreground">
          {t(($) => $.library.import.noRepositories)}
        </p>
      );
    }
    return (
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
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2 text-left transition-colors focus-visible:bg-accent disabled:opacity-60"
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
              className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      ))
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busyRef.current) onClose();
      }}
    >
      <DialogContent
        data-testid="project-import-dialog"
        className={cn(
          // A flex column capped at the window height: when the window is too
          // short for every card (the smallest is 900x600), the body below the
          // header scrolls and the title and close button stay in view.
          "flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden",
          // The source cards use the chooser's width so the two dialogs line
          // up; the single-purpose steps keep their narrower layout.
          view === "sources" ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {view !== "sources" ? (
              <button
                type="button"
                aria-label={t(($) => $.library.import.back)}
                data-testid="project-import-back"
                disabled={busy}
                onClick={() => { setView("sources"); setErrorMessage(null); setPendingPath(null); }}
                className="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {view === "github"
              ? t(($) => $.library.import.githubTitle)
              : view === "arxiv"
                ? t(($) => $.library.import.arxivTitle)
                : view === "target"
                  ? t(($) => $.library.import.targetTitle)
                  : t(($) => $.library.import.title)}
          </DialogTitle>
          <DialogDescription>
            {view === "github"
              ? t(($) => $.library.import.githubDescription)
              : view === "arxiv"
                ? t(($) => $.library.import.arxivDescription)
                : view === "target"
                  ? t(($) => $.library.import.targetDescription)
                  : t(($) => $.library.import.description)}
          </DialogDescription>
        </DialogHeader>

        {errorMessage && <p role="alert" className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>}
        {busy && <output className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />{t(($) => $.library.import.importing)}</output>}
        <div className="-mx-6 -mb-6 min-h-0 overflow-y-auto px-6 pb-6">
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
                      "hover:border-primary/40 hover:bg-accent focus-visible:border-primary disabled:opacity-60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {target.label}
                      </span>
                      {target.recommended ? (
                        <span className="block text-xs text-muted-foreground">
                          {t(($) => $.library.import.recommended)}
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
                  aria-label={t(($) => $.library.import.arxivInputLabel)}
                  disabled={busy}
                  data-testid="project-import-arxiv-id"
                  value={arxivId}
                  placeholder={t(($) => $.library.import.arxivPlaceholder)}
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
                  {t(($) => $.library.import.importAction)}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(($) => $.library.import.arxivHint)}
              </p>
            </div>
          ) : view === "sources" ? (
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.library.import.localHeading)}
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {IMPORT_FILE_SOURCES.map((source) => (
                    <ChoiceCard
                      key={source.kind}
                      image={SOURCE_ART[source.kind]}
                      title={sourceCopy[source.kind].title}
                      description={sourceCopy[source.kind].description}
                      testId={`project-import-${source.kind}`}
                      compact
                      disabled={busy}
                      busy={busy && busyKind === source.kind}
                      onClick={() => void importFile(source.kind)}
                    />
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.library.import.cloudHeading)}
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <ChoiceCard
                    image={CHOICE_ART.importArxiv}
                    title={t(($) => $.library.import.arxivPaper)}
                    description={t(($) => $.library.import.arxivCardDescription)}
                    testId="project-import-arxiv"
                    compact
                    disabled={busy}
                    onClick={() => setView("arxiv")}
                  />
                  <ChoiceCard
                    image={CHOICE_ART.importGithub}
                    title={t(($) => $.library.import.github)}
                    description={
                      githubStatus === "connected"
                        ? t(($) => $.library.import.githubConnected)
                        : t(($) => $.library.import.githubDisconnected)
                    }
                    testId="project-import-github"
                    compact
                    disabled={busy}
                    onClick={() => setView("github")}
                  />
                </div>
              </section>
            </div>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {renderRepositoryList()}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

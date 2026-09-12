import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ExternalLink, Github, Lock, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { githubListRepos, type GitHubRepo } from "@/lib/github";
import {
  IMPORT_FILE_SOURCES,
  importPickerOptions,
  importGitHubRepository,
  importSelectedFile,
  importTargetsForKind,
  type ProjectImportFileKind,
} from "@/features/project-import";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { ProjectImportDialog } from "./ProjectImportDialog";

export function ProjectImportMenu({
  align = "end",
  onImportSelected,
  trigger,
  triggerTooltip,
}: {
  align?: "start" | "center" | "end";
  onImportSelected?: () => void;
  trigger: (busy: boolean) => ReactElement;
  triggerTooltip?: ReactNode;
}) {
  const { t } = useTranslation(["library"]);
  const sourceLabels: Record<ProjectImportFileKind, string> = {
    project: t(($) => $.library.import.sources.project.title),
    word: t(($) => $.library.import.sources.word.title),
    markdown: t(($) => $.library.import.sources.markdown.title),
    html: t(($) => $.library.import.sources.html.title),
    typst: t(($) => $.library.import.sources.typst.title),
  };
  const githubStatus = useGithubStore((state) => state.status);
  const refreshGithub = useGithubStore((state) => state.refresh);
  const [open, setOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  // Radix decides an item is selected from its own pointer handling, and which
  // event that is has changed between versions. Rather than try to out-guess
  // it, the external-link button raises this flag and the item refuses to
  // import while it is set.
  const openingExternalRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [arxivOpen, setArxivOpen] = useState(false);
  const [repositoryAttempt, setRepositoryAttempt] = useState(0);
  const [repositories, setRepositories] = useState<GitHubRepo[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [repositoryLoadFailed, setRepositoryLoadFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry counter explicitly starts another request.
  useEffect(() => {
    if (!githubOpen) return;
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
  }, [githubOpen, githubStatus, refreshGithub, repositories.length, repositoryAttempt]);

  const importFile = async (
    kind: ProjectImportFileKind,
    target?: "latex" | "markdown" | "typst",
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const selection = await pickOpenPath(importPickerOptions(kind));
      if (typeof selection !== "string") return;
      if (await importSelectedFile(selection, target)) onImportSelected?.();
    } catch (error) {
      notifyError("import", error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const importRepository = async (repository: GitHubRepo) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await importGitHubRepository(repository);
      onImportSelected?.();
    } catch (error) {
      notifyError("import GitHub repository", error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openGithubSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("github");
    settings.setSettingsOpen(true);
    onImportSelected?.();
  };

  return (
    <>
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && busyRef.current) return;
        setOpen(nextOpen);
        if (!nextOpen) setGithubOpen(false);
      }}
    >
      {triggerTooltip ? (
        <Tooltip label={triggerTooltip}>
          <DropdownMenuTrigger asChild>{trigger(busy)}</DropdownMenuTrigger>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger(busy)}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align={align} className="min-w-56">
        <DropdownMenuLabel>{t(($) => $.library.import.menu.local)}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void importFile("project")}>
          {t(($) => $.library.import.menu.project)}
        </DropdownMenuItem>
        {IMPORT_FILE_SOURCES.filter((source) => source.kind !== "project").map(({ kind }) => {
          const targets = importTargetsForKind(kind);
          return (
            <DropdownMenuSub key={kind}>
              <DropdownMenuSubTrigger data-testid={`import-kind-${kind}`}>
                {sourceLabels[kind]}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {targets.map((target) => (
                  <DropdownMenuItem
                    key={target.target}
                    data-testid={`import-target-${kind}-${target.target}`}
                    onSelect={() => void importFile(kind, target.target)}
                  >
                    {target.recommended
                      ? t(($) => $.library.import.targetRecommended, { label: target.label })
                      : target.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        <DropdownMenuLabel>{t(($) => $.library.import.menu.cloud)}</DropdownMenuLabel>
        <DropdownMenuItem data-testid="import-arxiv" onSelect={() => setArxivOpen(true)}>{t(($) => $.library.import.arxivPaper)}</DropdownMenuItem>
        <DropdownMenuSub open={githubOpen} onOpenChange={setGithubOpen}>
          <DropdownMenuSubTrigger>GitHub</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 min-w-64 overflow-y-auto">
            {githubStatus === "disconnected" ? (
              <DropdownMenuItem onSelect={openGithubSettings}>
                <Github className="size-4 shrink-0 text-muted-foreground" />
                {t(($) => $.library.import.menu.connect)}
              </DropdownMenuItem>
            ) : githubStatus === "unknown" || loadingRepositories ? (
              <DropdownMenuItem disabled>
                <Loader2 className="size-3.5 animate-spin" />{" "}
                {t(($) => $.library.import.loadingRepositories)}
              </DropdownMenuItem>
            ) : repositoryLoadFailed ? (
              <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setRepositoryAttempt((attempt) => attempt + 1); }}>{t(($) => $.library.import.menu.repositoriesRetry)}</DropdownMenuItem>
            ) : repositories.length === 0 ? (
              <DropdownMenuItem disabled>
                {t(($) => $.library.import.noRepositories)}
              </DropdownMenuItem>
            ) : (
              repositories.map((repository) => (
                <DropdownMenuItem
                  key={repository.full_name}
                  onSelect={(event) => {
                    if (openingExternalRef.current) {
                      openingExternalRef.current = false;
                      event.preventDefault();
                      return;
                    }
                    void importRepository(repository);
                  }}
                  className="group gap-2"
                >
                  <Github className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {repository.full_name}
                  </span>
                  {repository.private ? (
                    <Tooltip label={t(($) => $.library.import.privateRepository)} side="top">
                      <span
                        role="img"
                        aria-label={t(($) => $.library.import.privateRepository)}
                        className="inline-flex shrink-0"
                      >
                        <Lock aria-hidden className="size-3 text-muted-foreground" />
                      </span>
                    </Tooltip>
                  ) : null}
                  <Tooltip label={t(($) => $.library.import.openOnGitHub)} side="top">
                    <button
                      type="button"
                      aria-label={t(($) => $.library.import.openRepository, {
                        name: repository.full_name,
                      })}
                      // The row imports the repository; this opens it in the
                      // browser. Radix selects the item on pointerdown, so
                      // both events have to stop here or the click would do
                      // one thing and then the other.
                      // Opened from pointerdown, not click: selecting the item
                      // closes the menu and unmounts this button, so a click
                      // handler is not guaranteed to run at all. That is why
                      // the first attempt imported the repository and never
                      // opened the page.
                      onPointerDown={(event) => {
                        openingExternalRef.current = true;
                        event.stopPropagation();
                        openExternal(repository.html_url).catch((error) => {
                          notifyError("open repository", error);
                        });
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        void openExternal(repository.html_url).catch((error) => {
                          notifyError("open repository", error);
                        });
                      }}
                      className="shrink-0 text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <ExternalLink className="size-3.5" />
                    </button>
                  </Tooltip>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
    <ProjectImportDialog open={arxivOpen} initialView="arxiv" onClose={() => setArxivOpen(false)} onImported={onImportSelected} />
    </>
  );
}

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
  importGitHubRepository,
  importSelectedFile,
  type ProjectImportFileKind,
} from "@/features/project-import";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";

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

export function ProjectImportMenu({
  align = "end",
  onImportSelected,
  trigger,
  triggerTooltip,
}: Readonly<{
  align?: "start" | "center" | "end";
  onImportSelected?: () => void;
  trigger: (busy: boolean) => ReactElement;
  triggerTooltip?: ReactNode;
}>) {
  const { t } = useTranslation(["library"]);
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
  const [repositories, setRepositories] = useState<GitHubRepo[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [repositoryLoadFailed, setRepositoryLoadFailed] = useState(false);

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
  }, [githubOpen, githubStatus, refreshGithub, repositories.length]);

  const importFile = async (kind: ProjectImportFileKind) => {
    const selection = await pickOpenPath(pickerOptions(kind));
    if (typeof selection !== "string") return;
    setBusy(true);
    onImportSelected?.();
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
    onImportSelected?.();
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
    onImportSelected?.();
  };

  const renderRepositoryItems = () => {
    if (githubStatus === "disconnected") {
      return (
        <DropdownMenuItem onSelect={openGithubSettings}>
          <Github className="size-4 shrink-0 text-muted-foreground" />
          {t(($) => $.library.import.menu.connect)}
        </DropdownMenuItem>
      );
    }
    if (githubStatus === "unknown" || loadingRepositories) {
      return (
        <DropdownMenuItem disabled>
          <Loader2 className="size-3.5 animate-spin" />{" "}
          {t(($) => $.library.import.loadingRepositories)}
        </DropdownMenuItem>
      );
    }
    if (repositoryLoadFailed) {
      return (
        <DropdownMenuItem disabled>
          {t(($) => $.library.import.menu.repositoriesFailed)}
        </DropdownMenuItem>
      );
    }
    if (repositories.length === 0) {
      return (
        <DropdownMenuItem disabled>
          {t(($) => $.library.import.noRepositories)}
        </DropdownMenuItem>
      );
    }
    return (
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
              className="shrink-0 text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
            >
              <ExternalLink className="size-3.5" />
            </button>
          </Tooltip>
        </DropdownMenuItem>
      ))
    );
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
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
        <DropdownMenuItem onSelect={() => void importFile("word")}>
          {t(($) => $.library.import.menu.word)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void importFile("markdown")}>
          {t(($) => $.library.import.menu.markdown)}
        </DropdownMenuItem>
        <DropdownMenuLabel>{t(($) => $.library.import.menu.cloud)}</DropdownMenuLabel>
        <DropdownMenuSub open={githubOpen} onOpenChange={setGithubOpen}>
          <DropdownMenuSubTrigger>GitHub</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 min-w-64 overflow-y-auto">
            {renderRepositoryItems()}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

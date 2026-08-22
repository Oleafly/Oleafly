import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
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
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";

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
        <DropdownMenuLabel>Local</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void importFile("project")}>
          Existing project (.zip)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void importFile("word")}>
          Word document
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void importFile("markdown")}>
          Markdown document
        </DropdownMenuItem>
        <DropdownMenuLabel>Cloud</DropdownMenuLabel>
        <DropdownMenuSub open={githubOpen} onOpenChange={setGithubOpen}>
          <DropdownMenuSubTrigger>GitHub</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 min-w-64 overflow-y-auto">
            {githubStatus === "disconnected" ? (
              <DropdownMenuItem onSelect={openGithubSettings}>
                <Github className="size-4 shrink-0 text-muted-foreground" />
                Connect GitHub in Settings
              </DropdownMenuItem>
            ) : githubStatus === "unknown" || loadingRepositories ? (
              <DropdownMenuItem disabled>
                <Loader2 className="size-3.5 animate-spin" /> Loading repositories…
              </DropdownMenuItem>
            ) : repositoryLoadFailed ? (
              <DropdownMenuItem disabled>Could not load repositories.</DropdownMenuItem>
            ) : repositories.length === 0 ? (
              <DropdownMenuItem disabled>No repositories found.</DropdownMenuItem>
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
                    <Tooltip label="Private repository" side="top">
                      <span role="img" aria-label="Private repository" className="inline-flex shrink-0">
                        <Lock aria-hidden className="size-3 text-muted-foreground" />
                      </span>
                    </Tooltip>
                  ) : null}
                  <Tooltip label="Open on GitHub" side="top">
                    <button
                      type="button"
                      aria-label={`Open ${repository.full_name} on GitHub`}
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
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

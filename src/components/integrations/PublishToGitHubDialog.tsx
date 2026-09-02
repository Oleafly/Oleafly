import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  GitBranch,
  Github,
  Loader2,
  Lock,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGithubStore } from "@/store/github";
import { gitPreparePublish, gitPush, gitSetRemote } from "@/lib/tauri";
import {
  githubCreateRepo,
  githubListRepos,
  type GitHubRepo,
} from "@/lib/github";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { useSettingsStore } from "@/store/settings";

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type PublishActionToken = {
  projectId: string;
  session: number;
  request: number;
};

export function PublishToGitHubDialog({
  open,
  onClose,
  projectId,
  projectName,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string;
  onPublished: (remoteUrl: string) => void;
}) {
  const status = useGithubStore((s) => s.status);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const [tab, setTab] = useState<"new" | "existing">("new");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [query, setQuery] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const sessionRequest = useRef(0);
  const actionRequest = useRef(0);
  const reposRequest = useRef(0);
  const closeTimer = useRef<number | null>(null);
  const renderedIdentity = useRef({ open, projectId });
  const renderIdentityChanged =
    renderedIdentity.current.open !== open ||
    renderedIdentity.current.projectId !== projectId;
  const { dialogRef, onBackdropMouseDown } =
    useModalAccessibility<HTMLDivElement>(open, onClose);

  const isCurrentSession = useCallback(
    (targetProjectId: string, session: number) =>
      session === sessionRequest.current &&
      renderedIdentity.current.open &&
      renderedIdentity.current.projectId === targetProjectId,
    [],
  );

  const beginAction = useCallback(
    (targetProjectId: string): PublishActionToken | null => {
      if (renderIdentityChanged) return null;
      return {
        projectId: targetProjectId,
        session: sessionRequest.current,
        request: ++actionRequest.current,
      };
    },
    [renderIdentityChanged],
  );

  const isCurrentAction = useCallback(
    (token: PublishActionToken) =>
      token.request === actionRequest.current &&
      isCurrentSession(token.projectId, token.session),
    [isCurrentSession],
  );

  useLayoutEffect(() => {
    renderedIdentity.current = { open, projectId };
    sessionRequest.current += 1;
    actionRequest.current += 1;
    reposRequest.current += 1;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setTab("new");
    setBusy(false);
    setMsg(null);
    setSelected(null);
    setRepoName(slug(projectName || "oleafly-project"));
    setIsPrivate(true);
    setRepos([]);
    setQuery("");
    setLoadingRepos(false);
    return () => {
      sessionRequest.current += 1;
      actionRequest.current += 1;
      reposRequest.current += 1;
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [open, projectId, projectName]);

  useEffect(() => {
    if (!open || !projectId || status !== "connected") return;
    const session = sessionRequest.current;
    const request = ++reposRequest.current;
    setLoadingRepos(true);
    githubListRepos()
      .then((nextRepos) => {
        if (
          request === reposRequest.current &&
          isCurrentSession(projectId, session)
        ) {
          setRepos(nextRepos);
        }
      })
      .catch((e) => {
        if (
          request === reposRequest.current &&
          isCurrentSession(projectId, session)
        ) {
          void logError("github list repos", e);
        }
      })
      .finally(() => {
        if (
          request === reposRequest.current &&
          isCurrentSession(projectId, session)
        ) {
          setLoadingRepos(false);
        }
      });
  }, [isCurrentSession, open, projectId, status]);

  if (!open) return null;

  const note = (token: PublishActionToken, ok: boolean, text: string) => {
    if (isCurrentAction(token)) setMsg({ ok, text });
  };

  const scheduleClose = (token: PublishActionToken) => {
    if (!isCurrentAction(token)) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      if (isCurrentAction(token)) onClose();
    }, 900);
  };

  const publishNew = async () => {
    if (!projectId) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    const name = slug(repoName.trim() || projectName || "oleafly-project");
    if (!name) return note(action, false, "Enter a repository name.");
    setBusy(true);
    try {
      const repo = await githubCreateRepo(name, isPrivate);
      // A brand-new project may have no commits yet; the remote itself stays
      // clean since auth is handled by gitPush's credential helper, not a
      // token embedded in .git/config.
      await gitPreparePublish(action.projectId, "Initial commit");
      await gitSetRemote(action.projectId, repo.clone_url);
      await gitPush(action.projectId);
      if (!isCurrentAction(action)) return;
      note(action, true, `Published to ${repo.full_name}.`);
      onPublished(repo.clone_url);
      scheduleClose(action);
    } catch (e) {
      note(action, false, String(e));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
    }
  };

  const publishExisting = async () => {
    if (!projectId || !selected) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    const remoteUrl = selected;
    setBusy(true);
    try {
      await gitPreparePublish(action.projectId, "Initial commit");
      await gitSetRemote(action.projectId, remoteUrl);
      // An existing remote may already contain commits. Let the push report
      // when its history must be pulled and reconciled first.
      try {
        await gitPush(action.projectId);
      } catch (e) {
        if (!isCurrentAction(action)) return;
        note(
          action,
          false,
          `Linked to ${remoteUrl}, but push needs a pull first: ${e}`,
        );
        onPublished(remoteUrl);
        return;
      }
      if (!isCurrentAction(action)) return;
      note(action, true, `Linked and pushed to ${remoteUrl}.`);
      onPublished(remoteUrl);
      scheduleClose(action);
    } catch (e) {
      note(action, false, String(e));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
    }
  };

  const visibleBusy = renderIdentityChanged ? false : busy;
  const visibleMessage = renderIdentityChanged ? null : msg;

  const filtered = repos
    .filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 60);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <button type="button" aria-label="Close publish dialog" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-github-title"
        tabIndex={-1}
        className="relative flex h-[min(560px,88vh)] w-[min(620px,94vw)] flex-col overflow-hidden rounded-xl border bg-sidebar text-sidebar-foreground shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Github className="size-4" />
            <h2 id="publish-github-title" className="text-sm font-semibold">Publish to GitHub</h2>
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {status !== "connected" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Connect GitHub to publish this project.
            </p>
            <Button
              onClick={() => {
                onClose();
                setSettingsInitialSection("integrations");
                setSettingsOpen(true);
              }}
            >
              <Github className="size-4" />
              Connect to GitHub
            </Button>
          </div>
        ) : (
          <>
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as "new" | "existing")}
              className="shrink-0"
            >
              <div className="flex justify-center px-4 py-2">
                <TabsList>
                  <TabsTrigger value="new">Create new repository</TabsTrigger>
                  <TabsTrigger value="existing">Link existing</TabsTrigger>
                </TabsList>
              </div>
            </Tabs>

            <div className="min-h-0 flex-1 overflow-auto px-4 pt-1 pb-4 text-sm">
              {tab === "new" ? (
                <div className="flex h-full flex-col">
                  <div className="space-y-3">
                    <label htmlFor="publish-repository-name" className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        Repository name
                      </span>
                      <Input
                        id="publish-repository-name"
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value)}
                        aria-label="Repository name"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                      />
                    </label>
                    <label htmlFor="publish-private-repository" className="flex cursor-pointer items-center justify-between rounded-md border bg-card p-3">
                      <span className="flex items-center gap-2">
                        <Lock className="size-4 text-muted-foreground" />
                        <span className="text-xs">
                          Private
                          <span className="ml-1 text-muted-foreground">
                            (recommended)
                          </span>
                        </span>
                      </span>
                      <Checkbox
                        id="publish-private-repository"
                        checked={isPrivate}
                        onCheckedChange={(checked) => setIsPrivate(checked === true)}
                      />
                    </label>
                  </div>
                  <Button
                    className="mt-auto ml-auto px-5"
                    disabled={visibleBusy || !repoName.trim()}
                    onClick={() => void publishNew()}
                  >
                    {visibleBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Github className="size-4" />
                    )}
                    Create and push
                  </Button>
                </div>
              ) : (
                <div className="flex h-full flex-col gap-2">
                  <div className="flex items-center gap-2 rounded-md border px-3 transition-colors focus-within:ring-1 focus-within:ring-ring">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search your repositories…"
                      aria-label="Search repositories"
                      className="h-10 flex-1 rounded-none border-0 bg-transparent px-0 text-xs shadow-none outline-none focus-visible:ring-0"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                    {loadingRepos ? (
                      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Loading…
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No repositories found.
                      </div>
                    ) : (
                      filtered.map((r) => (
                        <button type="button"
                          key={r.full_name}
                          onClick={() => setSelected(r.clone_url)}
                          className={cn(
                            "flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs last:border-0 hover:bg-accent/60",
                            selected === r.clone_url && "bg-accent"
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono">
                              {r.full_name}
                            </span>
                          </span>
                          {r.private && (
                            <Lock className="size-3 shrink-0 text-muted-foreground" />
                          )}
                          {selected === r.clone_url && (
                            <Check className="size-3.5 shrink-0 text-emerald-500" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <Tooltip label="Sets origin and pushes the current branch">
                    <Button
                      className="w-full"
                      disabled={visibleBusy || !selected}
                      onClick={() => void publishExisting()}
                    >
                      {visibleBusy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <GitBranch className="size-4" />
                      )}
                      Link and push
                    </Button>
                  </Tooltip>
                </div>
              )}
            </div>

            {visibleMessage && (
              <div
                className={cn(
                  "shrink-0 border-t p-3 text-xs",
                  visibleMessage.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                )}
              >
                {visibleMessage.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

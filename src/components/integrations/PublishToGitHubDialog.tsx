import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  GitBranch,
  Github,
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
import {
  gitPreparePublish,
  gitPublishPreflight,
  gitPush,
  gitSetRemote,
  type GitPublishPreflight,
} from "@/lib/tauri";
import {
  githubCreateRepo,
  githubListRepos,
  type GitHubRepo,
} from "@/lib/github";
import { describeError } from "@/lib/app-error";
import { formatNameList, formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";
import { ModalShell } from "@/components/ui/modal-shell";
import { useSettingsStore } from "@/store/settings";
import { Spinner } from "@/components/ui/spinner";

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

type PublishTarget = "new" | "existing";

/** Files in the project's Git history that look like secrets, waiting for the
 * user to cancel or publish them anyway. */
type SecretsPrompt = {
  target: PublishTarget;
  replace: boolean;
  files: string[];
};

/** Whether the history holds a secret-looking file the user has not approved. */
function needsApproval(preflight: GitPublishPreflight, approved: string[]): boolean {
  return preflight.trackedSecretFiles.some((file) => !approved.includes(file));
}

function linkRemote(projectId: string, url: string) {
  return gitSetRemote(projectId, url);
}

function replaceRemote(projectId: string, url: string) {
  return gitSetRemote(projectId, url, { replace: true });
}

export function PublishToGitHubDialog({
  open,
  onClose,
  projectId,
  projectName,
  currentRemote = null,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string;
  currentRemote?: string | null;
  onPublished: (remoteUrl: string) => void;
}) {
  const { t } = useTranslation(["common", "library"]);
  const status = useGithubStore((s) => s.status);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const [tab, setTab] = useState<PublishTarget>("new");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [query, setQuery] = useState("");
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<PublishTarget | null>(null);
  const [secretsPrompt, setSecretsPrompt] = useState<SecretsPrompt | null>(null);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const sessionRequest = useRef(0);
  const actionRequest = useRef(0);
  const reposRequest = useRef(0);
  const closeTimer = useRef<number | null>(null);
  const renderedIdentity = useRef({ open, projectId });
  const renderIdentityChanged =
    renderedIdentity.current.open !== open ||
    renderedIdentity.current.projectId !== projectId;

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
    setReplaceTarget(null);
    setSecretsPrompt(null);
    setLeftOut([]);
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

  const fileList = (files: string[]) =>
    formatNameList(files, (shown, rest) =>
      t(($) => $.library.github.moreFiles, {
        files: shown,
        more: formatNumber(rest),
        count: rest,
      }),
    );

  /** Show the history question and stop, unless the user already approved
   * every secret-looking file in the history. */
  const asksAboutSecrets = (
    token: PublishActionToken,
    preflight: GitPublishPreflight,
    prompt: Omit<SecretsPrompt, "files">,
    approved: string[],
  ) => {
    if (!needsApproval(preflight, approved)) return false;
    if (isCurrentAction(token)) {
      setMsg(null);
      setSecretsPrompt({ ...prompt, files: preflight.trackedSecretFiles });
    }
    return true;
  };

  /** Run the history check; true when publishing has to stop here. */
  const stopsForSecrets = async (
    token: PublishActionToken,
    prompt: Omit<SecretsPrompt, "files">,
    approved: string[],
  ) => {
    const preflight = await gitPublishPreflight(token.projectId);
    return !isCurrentAction(token) || asksAboutSecrets(token, preflight, prompt, approved);
  };

  /** Commit, link the remote, and report a project with nothing to push.
   * Returns the files left out, or null when there is nothing to push. */
  const commitAndLink = async (
    token: PublishActionToken,
    remoteUrl: string,
    replace: boolean,
    approved: string[],
  ) => {
    const prepared = await gitPreparePublish(token.projectId, "Initial commit", {
      allowTrackedSecrets: approved,
    });
    if (isCurrentAction(token)) setLeftOut(prepared.leftOut);
    await (replace ? replaceRemote : linkRemote)(token.projectId, remoteUrl);
    if (prepared.hasCommit) return prepared.leftOut;
    if (isCurrentAction(token)) {
      note(token, false, t(($) => $.library.github.nothingToPublish));
      onPublished(remoteUrl);
    }
    return null;
  };

  /** Report a finished publish. The dialog stays open while it names files it left out. */
  const finishPublish = (
    token: PublishActionToken,
    remoteUrl: string,
    text: string,
    skipped: string[],
  ) => {
    if (!isCurrentAction(token)) return;
    note(token, true, text);
    onPublished(remoteUrl);
    if (skipped.length === 0) scheduleClose(token);
  };

  const publishNew = async (replace = false, approved: string[] = []) => {
    if (!projectId) return;
    if (currentRemote && !replace) {
      setMsg(null);
      setReplaceTarget("new");
      return;
    }
    setReplaceTarget(null);
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setSecretsPrompt(null);
    setLeftOut([]);
    const name = slug(repoName.trim() || projectName || "oleafly-project");
    if (!name) return note(action, false, t(($) => $.library.github.nameRequired));
    setBusy(true);
    try {
      if (await stopsForSecrets(action, { target: "new", replace }, approved)) return;
      const repo = await githubCreateRepo(name, isPrivate);
      // A brand-new project may have no commits yet; the remote itself stays
      // clean since auth is handled by gitPush's credential helper, not a
      // token embedded in .git/config.
      const skipped = await commitAndLink(action, repo.clone_url, replace, approved);
      if (!skipped) return;
      await gitPush(action.projectId);
      finishPublish(
        action,
        repo.clone_url,
        t(($) => $.library.github.published, { repository: repo.full_name }),
        skipped,
      );
    } catch (e) {
      note(action, false, describeError(e));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
    }
  };

  const publishExisting = async (replace = false, approved: string[] = []) => {
    if (!projectId || !selected) return;
    const remoteUrl = selected;
    if (currentRemote && currentRemote !== remoteUrl && !replace) {
      setMsg(null);
      setReplaceTarget("existing");
      return;
    }
    setReplaceTarget(null);
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setSecretsPrompt(null);
    setLeftOut([]);
    setBusy(true);
    try {
      if (await stopsForSecrets(action, { target: "existing", replace }, approved)) return;
      const skipped = await commitAndLink(action, remoteUrl, replace, approved);
      if (!skipped) return;
      // An existing remote may already contain commits. Let the push report
      // when its history must be pulled and reconciled first.
      try {
        await gitPush(action.projectId);
      } catch (e) {
        if (!isCurrentAction(action)) return;
        note(
          action,
          false,
          t(($) => $.library.github.pushNeedsPull, {
            remote: remoteUrl,
            detail: String(e),
          }),
        );
        onPublished(remoteUrl);
        return;
      }
      finishPublish(action, remoteUrl, t(($) => $.library.github.linked, { remote: remoteUrl }), skipped);
    } catch (e) {
      note(action, false, describeError(e));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
    }
  };

  const visibleBusy = renderIdentityChanged ? false : busy;
  const visibleMessage = renderIdentityChanged ? null : msg;
  const visibleSecretsPrompt = renderIdentityChanged ? null : secretsPrompt;
  const visibleLeftOut = renderIdentityChanged ? [] : leftOut;

  const filtered = repos
    .filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 60);

  const repoList = () =>
    filtered.length === 0 ? (
      <div className="p-6 text-center text-xs text-muted-foreground">
        {t(($) => $.library.github.noRepositories)}
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
    );

  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.library.github.closeDialog)}
      portal
      labelledBy="publish-github-title"
      className="flex h-[min(560px,88vh)] w-[min(620px,94vw)] flex-col overflow-hidden"
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Github className="size-4" />
          <h2 id="publish-github-title" className="text-sm font-semibold">
            {t(($) => $.library.github.title)}
          </h2>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {status !== "connected" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t(($) => $.library.github.connectPrompt)}
          </p>
          <Button
            onClick={() => {
              onClose();
              setSettingsInitialSection("integrations");
              setSettingsOpen(true);
            }}
          >
            <Github className="size-4" />
            {t(($) => $.library.github.connect)}
          </Button>
        </div>
      ) : (
        <>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setReplaceTarget(null);
              setSecretsPrompt(null);
              setLeftOut([]);
              setTab(value as PublishTarget);
            }}
            className="shrink-0"
          >
            <div className="flex justify-center px-4 py-2">
              <TabsList>
                <TabsTrigger value="new">{t(($) => $.library.github.tabNew)}</TabsTrigger>
                <TabsTrigger value="existing">
                  {t(($) => $.library.github.tabExisting)}
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>

          <div className="min-h-0 flex-1 overflow-auto px-4 pt-1 pb-4 text-sm">
            {tab === "new" ? (
              <div className="flex h-full flex-col">
                <div className="space-y-3">
                  <label htmlFor="publish-repository-name" className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t(($) => $.library.github.repositoryName)}
                    </span>
                    <Input
                      id="publish-repository-name"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      aria-label={t(($) => $.library.github.repositoryName)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:border-ring"
                    />
                  </label>
                  <label htmlFor="publish-private-repository" className="flex cursor-pointer items-center justify-between rounded-md border bg-card p-3">
                    <span className="flex items-center gap-2">
                      <Lock className="size-4 text-muted-foreground" />
                      <span className="text-xs">
                        {t(($) => $.library.github.private)}
                        <span className="ml-1 text-muted-foreground">
                          {t(($) => $.library.github.privateHint)}
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
                    <Spinner />
                  ) : (
                    <Github className="size-4" />
                  )}
                  {t(($) => $.library.github.createAndPush)}
                </Button>
              </div>
            ) : (
              <div className="flex h-full flex-col gap-2">
                <div className="flex items-center gap-2 rounded-md border px-3 transition-colors focus-within:border-ring">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t(($) => $.library.github.searchPlaceholder)}
                    aria-label={t(($) => $.library.github.searchRepositories)}
                    className="h-10 flex-1 rounded-none border-0 bg-transparent px-0 text-xs shadow-none"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                  {loadingRepos ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                      <Spinner /> {t(($) => $.common.state.loading)}
                    </div>
                  ) : repoList()}
                </div>
                <Tooltip label={t(($) => $.library.github.linkHint)}>
                  <Button
                    className="w-full"
                    disabled={visibleBusy || !selected}
                    onClick={() => void publishExisting()}
                  >
                    {visibleBusy ? (
                      <Spinner />
                    ) : (
                      <GitBranch className="size-4" />
                    )}
                    {t(($) => $.library.github.linkAndPush)}
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>

          {replaceTarget && currentRemote && !renderIdentityChanged ? (
            <div className="shrink-0 border-t p-3 text-xs">
              <p>{t(($) => $.library.github.replaceRemotePrompt, { remote: currentRemote })}</p>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReplaceTarget(null)}>
                  {t(($) => $.common.actions.cancel)}
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    void (replaceTarget === "new" ? publishNew(true) : publishExisting(true))
                  }
                >
                  {t(($) => $.library.github.replaceRemote)}
                </Button>
              </div>
            </div>
          ) : null}
          {visibleSecretsPrompt ? (
            <div className="shrink-0 border-t p-3 text-xs">
              <p className="break-words">
                {t(($) => $.library.github.trackedSecretsPrompt, {
                  count: visibleSecretsPrompt.files.length,
                  files: fileList(visibleSecretsPrompt.files),
                })}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSecretsPrompt(null)}>
                  {t(($) => $.common.actions.cancel)}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    void (visibleSecretsPrompt.target === "new" ? publishNew : publishExisting)(
                      visibleSecretsPrompt.replace,
                      visibleSecretsPrompt.files,
                    )
                  }
                >
                  {t(($) => $.library.github.publishAnyway)}
                </Button>
              </div>
            </div>
          ) : null}
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
          {visibleLeftOut.length > 0 && (
            <output className="block shrink-0 border-t p-3 text-xs text-muted-foreground break-words">
              {t(($) => $.library.github.leftOutSecrets, {
                count: visibleLeftOut.length,
                files: fileList(visibleLeftOut),
              })}
            </output>
          )}
        </>
      )}
    </ModalShell>
  );
}

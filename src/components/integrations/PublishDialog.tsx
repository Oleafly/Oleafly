import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Github, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ForgeRepoList } from "@/components/integrations/ForgeRepoList";
import { useForgeAccountsStore } from "@/store/forge-accounts";
import {
  forgeCreateRepo,
  gitPreparePublish,
  gitPublishPreflight,
  gitPush,
  gitSetRemote,
  type ForgeAccount,
  type ForgeRepo,
  type GitPublishPreflight,
} from "@/lib/tauri";
import { hasRemotePassword, hostLabel, isAllowedRemoteUrl, matchAccount } from "@/lib/forge";
import { describeError } from "@/lib/app-error";
import { formatNameList, formatNumber } from "@/lib/intl";
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

type PublishTarget = "new" | "existing" | "url";
type LinkTarget = Exclude<PublishTarget, "new">;

/** Files in the project's Git history that look like secrets, waiting for the
 * user to cancel or publish them anyway. */
type SecretsPrompt = {
  target: PublishTarget;
  replace: boolean;
  /** The address to link, for an existing repository or a typed address. */
  remoteUrl: string | null;
  /** The server that would receive the history. */
  host: string;
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

function AccountIcon({ account }: Readonly<{ account: ForgeAccount | null }>) {
  return account?.kind === "github" ? <Github className="size-4" /> : <GitBranch className="size-4" />;
}

/** Publish a project: create a repository on a Git hosting account, link one
 * of the account's repositories, or link any address. Then push. */
export function PublishDialog({
  open,
  onClose,
  projectId,
  projectName,
  currentRemote = null,
  onPublished,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  projectName: string;
  currentRemote?: string | null;
  onPublished: (remoteUrl: string) => void;
}>) {
  const { t } = useTranslation(["common", "library", "errors"]);
  const accounts = useForgeAccountsStore((s) => s.accounts);
  const accountsStatus = useForgeAccountsStore((s) => s.status);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const setSettingsScrollTarget = useSettingsStore((s) => s.setSettingsScrollTarget);
  const [tab, setTab] = useState<PublishTarget>("new");
  const [tabChosen, setTabChosen] = useState(false);
  const [accountBase, setAccountBase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const [selected, setSelected] = useState<ForgeRepo | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<PublishTarget | null>(null);
  const [secretsPrompt, setSecretsPrompt] = useState<SecretsPrompt | null>(null);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const sessionRequest = useRef(0);
  const actionRequest = useRef(0);
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
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setTab("new");
    setTabChosen(false);
    setAccountBase(null);
    setBusy(false);
    setMsg(null);
    setSelected(null);
    setUrlInput("");
    setReplaceTarget(null);
    setSecretsPrompt(null);
    setLeftOut([]);
    setRepoName(slug(projectName || "oleafly-project"));
    setIsPrivate(true);
    return () => {
      sessionRequest.current += 1;
      actionRequest.current += 1;
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [open, projectId, projectName]);

  useEffect(() => {
    if (open) void useForgeAccountsStore.getState().ensureLoaded();
  }, [open]);

  if (!open) return null;

  const account =
    accounts.find((item) => item.base === accountBase) ??
    matchAccount(currentRemote, accounts) ??
    accounts[0] ??
    null;
  const noAccounts = (accountsStatus === "ready" || accountsStatus === "error") && accounts.length === 0;
  const shownTab: PublishTarget = noAccounts && !tabChosen ? "url" : tab;

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

  /** Run the history check; true when publishing has to stop here and ask. */
  const stopsForSecrets = async (
    token: PublishActionToken,
    prompt: Omit<SecretsPrompt, "files">,
    approved: string[],
  ) => {
    const preflight = await gitPublishPreflight(token.projectId);
    if (!isCurrentAction(token)) return true;
    if (!needsApproval(preflight, approved)) return false;
    setMsg(null);
    setSecretsPrompt({ ...prompt, files: preflight.trackedSecretFiles });
    return true;
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
    if (!projectId || !account) return;
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
    const target = account;
    setBusy(true);
    try {
      const prompt = { target: "new" as const, replace, remoteUrl: null, host: hostLabel(target.base) };
      if (await stopsForSecrets(action, prompt, approved)) return;
      const repo = await forgeCreateRepo(target.base, name, isPrivate);
      // The remote stays clean: Git signs in through the account's
      // credential helper, never a token in .git/config.
      const skipped = await commitAndLink(action, repo.cloneUrl, replace, approved);
      if (!skipped) return;
      await gitPush(action.projectId);
      finishPublish(
        action,
        repo.cloneUrl,
        t(($) => $.library.github.published, { repository: repo.fullName }),
        skipped,
      );
    } catch (error) {
      note(action, false, describeError(error));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
    }
  };

  const linkAndPush = async (
    target: LinkTarget,
    remoteUrl: string,
    replace = false,
    approved: string[] = [],
  ) => {
    if (!projectId || !remoteUrl) return;
    if (currentRemote && currentRemote !== remoteUrl && !replace) {
      setMsg(null);
      setReplaceTarget(target);
      return;
    }
    setReplaceTarget(null);
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setSecretsPrompt(null);
    setLeftOut([]);
    setBusy(true);
    try {
      const prompt = { target, replace, remoteUrl, host: hostLabel(remoteUrl) };
      if (await stopsForSecrets(action, prompt, approved)) return;
      const skipped = await commitAndLink(action, remoteUrl, replace, approved);
      if (!skipped) return;
      // An existing remote may already contain commits. Let the push report
      // when its history must be pulled and reconciled first.
      try {
        await gitPush(action.projectId);
      } catch (error) {
        if (!isCurrentAction(action)) return;
        note(
          action,
          false,
          t(($) => $.library.github.pushNeedsPull, {
            remote: remoteUrl,
            detail: describeError(error),
          }),
        );
        onPublished(remoteUrl);
        return;
      }
      finishPublish(action, remoteUrl, t(($) => $.library.github.linked, { remote: remoteUrl }), skipped);
    } catch (error) {
      note(action, false, describeError(error));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
    }
  };

  const linkTargetUrl = (target: LinkTarget) =>
    target === "existing" ? (selected?.cloneUrl ?? "") : urlInput.trim();

  const openGitHostingSettings = () => {
    onClose();
    setSettingsScrollTarget("git-hosting");
    setSettingsInitialSection("integrations");
    setSettingsOpen(true);
  };

  const visibleBusy = renderIdentityChanged ? false : busy;
  const visibleMessage = renderIdentityChanged ? null : msg;
  const visibleSecretsPrompt = renderIdentityChanged ? null : secretsPrompt;
  const visibleLeftOut = renderIdentityChanged ? [] : leftOut;
  const typedUrl = urlInput.trim();
  const typedPassword = hasRemotePassword(typedUrl);
  const title = account
    ? t(($) => $.library.github.titleHost, { host: hostLabel(account.base) })
    : t(($) => $.library.github.titleAny);

  const renderConnectPrompt = () => (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">{t(($) => $.library.github.connectPromptAny)}</p>
      <Button onClick={openGitHostingSettings}>
        <GitBranch className="size-4" />
        {t(($) => $.library.github.openSettings)}
      </Button>
    </div>
  );

  const renderNew = (target: ForgeAccount) => (
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
        {visibleBusy ? <Spinner /> : <AccountIcon account={target} />}
        {t(($) => $.library.github.createAndPush)}
      </Button>
    </div>
  );

  const renderExisting = (target: ForgeAccount) => (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <ForgeRepoList
          key={target.base}
          account={target}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          disabled={visibleBusy}
        />
      </div>
      <Tooltip label={t(($) => $.library.github.linkHint)}>
        <Button
          className="w-full"
          disabled={visibleBusy || !selected}
          onClick={() => {
            if (selected) void linkAndPush("existing", selected.cloneUrl);
          }}
        >
          {visibleBusy ? <Spinner /> : <GitBranch className="size-4" />}
          {t(($) => $.library.github.linkAndPush)}
        </Button>
      </Tooltip>
    </div>
  );

  const renderUrl = () => (
    <div className="flex h-full flex-col gap-2">
      <label htmlFor="publish-url-input" className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t(($) => $.library.github.urlLabel)}</span>
        <Input
          id="publish-url-input"
          data-testid="publish-url-input"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder={t(($) => $.library.import.clonePlaceholder)}
          spellCheck={false}
          autoComplete="off"
          className="w-full font-mono text-xs"
        />
      </label>
      {typedPassword ? (
        <p role="alert" className="text-xs text-destructive">
          {t(($) => $.errors.git.remote_has_password)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t(($) => $.library.github.urlHint)}</p>
      )}
      <Button
        className="mt-auto w-full"
        data-testid="publish-url-submit"
        disabled={visibleBusy || typedPassword || !isAllowedRemoteUrl(typedUrl)}
        onClick={() => void linkAndPush("url", typedUrl)}
      >
        {visibleBusy ? <Spinner /> : <GitBranch className="size-4" />}
        {t(($) => $.library.github.linkAndPush)}
      </Button>
    </div>
  );

  const renderBody = () => {
    if (shownTab === "url") return renderUrl();
    if (!account) {
      return accountsStatus === "ready" || accountsStatus === "error" ? (
        renderConnectPrompt()
      ) : (
        <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
          <Spinner /> {t(($) => $.common.state.loading)}
        </div>
      );
    }
    return shownTab === "new" ? renderNew(account) : renderExisting(account);
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.library.github.closeDialog)}
      portal
      labelledBy="publish-dialog-title"
      className="flex h-[min(560px,88vh)] w-[min(620px,94vw)] flex-col overflow-hidden"
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2">
          <AccountIcon account={account} />
          <h2 id="publish-dialog-title" className="truncate text-sm font-semibold">
            {title}
          </h2>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {accounts.length > 1 && account && shownTab !== "url" ? (
        <div className="flex shrink-0 items-center gap-2 px-4">
          <span className="text-xs text-muted-foreground">{t(($) => $.library.github.accountLabel)}</span>
          <Select
            value={account.base}
            onValueChange={(value) => {
              setAccountBase(value);
              setSelected(null);
              setReplaceTarget(null);
              setSecretsPrompt(null);
            }}
          >
            <SelectTrigger
              className="h-8 w-auto min-w-48 text-xs"
              data-testid="publish-account"
              aria-label={t(($) => $.library.github.accountLabel)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {accounts.map((item) => (
                <SelectItem key={item.base} value={item.base}>
                  {`${hostLabel(item.base)} · ${item.login}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <Tabs
        value={shownTab}
        onValueChange={(value) => {
          setReplaceTarget(null);
          setSecretsPrompt(null);
          setLeftOut([]);
          setTabChosen(true);
          setTab(value as PublishTarget);
        }}
        className="shrink-0"
      >
        <div className="flex justify-center px-4 py-2">
          <TabsList>
            <TabsTrigger value="new" data-testid="publish-tab-new">
              {t(($) => $.library.github.tabNew)}
            </TabsTrigger>
            <TabsTrigger value="existing" data-testid="publish-tab-existing">
              {t(($) => $.library.github.tabExisting)}
            </TabsTrigger>
            <TabsTrigger value="url" data-testid="publish-tab-url">
              {t(($) => $.library.github.tabUrl)}
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-1 pb-4 text-sm">{renderBody()}</div>

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
                void (replaceTarget === "new"
                  ? publishNew(true)
                  : linkAndPush(replaceTarget, linkTargetUrl(replaceTarget), true))
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
            {t(($) => $.library.github.trackedSecretsPromptHost, {
              count: visibleSecretsPrompt.files.length,
              files: fileList(visibleSecretsPrompt.files),
              host: visibleSecretsPrompt.host,
            })}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSecretsPrompt(null)}>
              {t(($) => $.common.actions.cancel)}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const prompt = visibleSecretsPrompt;
                if (prompt.target === "new") void publishNew(prompt.replace, prompt.files);
                else void linkAndPush(prompt.target, prompt.remoteUrl ?? "", prompt.replace, prompt.files);
              }}
            >
              {t(($) => $.library.github.publishAnyway)}
            </Button>
          </div>
        </div>
      ) : null}
      {visibleMessage && (
        <div
          className={cn(
            "shrink-0 select-text border-t p-3 text-xs",
            visibleMessage.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/30 bg-destructive/10 text-destructive",
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
    </ModalShell>
  );
}

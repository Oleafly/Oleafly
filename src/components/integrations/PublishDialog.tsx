import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { GitBranch, Lock } from "@/components/icons/pack";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ForgeAccountSelect } from "@/components/integrations/ForgeAccountSelect";
import { ForgeRepoList } from "@/components/integrations/ForgeRepoList";
import { ForgeBrandIcon } from "@/components/settings/git-hosting/ForgeBrandIcon";
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
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { Spinner } from "@/components/ui/spinner";
import { trimCharacter } from "@/lib/trim-character";

function slug(name: string): string {
  return trimCharacter(name.toLowerCase().replace(/[^\w.-]+/g, "-"), "-");
}

type PublishActionToken = {
  projectId: string;
  session: number;
  request: number;
};

type PublishTarget = "new" | "existing" | "url";
type LinkTarget = Exclude<PublishTarget, "new">;

type SecretsPrompt = {
  target: PublishTarget;
  replace: boolean;
  remoteUrl: string | null;
  host: string;
  files: string[];
};

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
  return account ? (
    <ForgeBrandIcon base={account.base} kind={account.kind} flavor={account.flavor} className="size-4" />
  ) : (
    <GitBranch className="size-4" />
  );
}

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
  const createdRepo = useRef<{ base: string; name: string; repo: ForgeRepo } | null>(null);
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
    createdRepo.current = null;
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

  const isSameProject = (token: PublishActionToken) => renderedIdentity.current.projectId === token.projectId;

  const note = (token: PublishActionToken, ok: boolean, text: string) => {
    if (isCurrentAction(token)) setMsg({ ok, text });
    else if (isSameProject(token)) (ok ? toast.success : toast.error)(text);
  };

  const reportLinked = (token: PublishActionToken, remoteUrl: string | null) => {
    if (remoteUrl && isSameProject(token)) onPublished(remoteUrl);
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

  const commitAndLink = async (
    token: PublishActionToken,
    remoteUrl: string,
    replace: boolean,
    approved: string[],
    onLinked: (remoteUrl: string) => void,
  ) => {
    const prepared = await gitPreparePublish(token.projectId, "Initial commit", {
      allowTrackedSecrets: approved,
    });
    if (isCurrentAction(token)) setLeftOut(prepared.leftOut);
    await (replace ? replaceRemote : linkRemote)(token.projectId, remoteUrl);
    onLinked(remoteUrl);
    if (prepared.hasCommit) return prepared.leftOut;
    note(token, false, t(($) => $.library.github.nothingToPublish));
    return null;
  };

  const finishPublish = (token: PublishActionToken, text: string, skipped: string[]) => {
    note(token, true, text);
    if (isCurrentAction(token) && skipped.length === 0) scheduleClose(token);
  };

  const publishNew = async (replace = false, approved: string[] = []) => {
    if (!projectId || !account) return;
    const name = slug(repoName.trim() || projectName || "oleafly-project");
    const created = createdRepo.current;
    const resumed = created?.base === account.base && created.name === name ? created.repo : null;
    if (currentRemote && !replace && currentRemote !== resumed?.cloneUrl) {
      setMsg(null);
      setReplaceTarget("new");
      return;
    }
    setReplaceTarget(null);
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setSecretsPrompt(null);
    setLeftOut([]);
    if (!name) return note(action, false, t(($) => $.library.github.nameRequired));
    const target = account;
    let linked: string | null = null;
    setBusy(true);
    try {
      const prompt = { target: "new" as const, replace, remoteUrl: null, host: hostLabel(target.base) };
      if (await stopsForSecrets(action, prompt, approved)) return;
      const repo = resumed ?? (await forgeCreateRepo(target.base, name, isPrivate));
      createdRepo.current = { base: target.base, name, repo };
      const skipped = await commitAndLink(action, repo.cloneUrl, replace, approved, (url) => {
        linked = url;
      });
      if (!skipped) return;
      await gitPush(action.projectId);
      finishPublish(
        action,
        t(($) => $.library.github.published, { repository: repo.fullName }),
        skipped,
      );
    } catch (error) {
      note(action, false, describeError(error));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
      reportLinked(action, linked);
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
    let linked: string | null = null;
    setBusy(true);
    try {
      const prompt = { target, replace, remoteUrl, host: hostLabel(remoteUrl) };
      if (await stopsForSecrets(action, prompt, approved)) return;
      const skipped = await commitAndLink(action, remoteUrl, replace, approved, (url) => {
        linked = url;
      });
      if (!skipped) return;
      try {
        await gitPush(action.projectId);
      } catch (error) {
        note(
          action,
          false,
          t(($) => $.library.github.pushNeedsPull, {
            remote: remoteUrl,
            detail: describeError(error),
          }),
        );
        return;
      }
      finishPublish(action, t(($) => $.library.github.linked, { remote: remoteUrl }), skipped);
    } catch (error) {
      note(action, false, describeError(error));
    } finally {
      if (isCurrentAction(action)) setBusy(false);
      reportLinked(action, linked);
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

  const renderAccountPicker = (target: ForgeAccount) =>
    accounts.length > 1 ? (
      <ForgeAccountSelect
        accounts={accounts}
        value={target.base}
        onValueChange={(value) => {
          setAccountBase(value);
          setSelected(null);
          setReplaceTarget(null);
          setSecretsPrompt(null);
        }}
        label={t(($) => $.library.github.accountLabel)}
        testId="publish-account"
        className="min-w-0 max-w-[60%]"
      />
    ) : null;

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
      <div className="mt-auto flex items-center gap-2 pt-3">
        {renderAccountPicker(target)}
        <Button
          className="ml-auto px-5"
          disabled={visibleBusy || !repoName.trim()}
          onClick={() => void publishNew()}
        >
          {visibleBusy ? <Spinner /> : <AccountIcon account={target} />}
          {t(($) => $.library.github.createAndPush)}
        </Button>
      </div>
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
      <div className="flex items-center gap-2">
        {renderAccountPicker(target)}
        <Tooltip label={t(($) => $.library.github.linkHint)} className="ml-auto">
          <Button
            className="px-5"
            disabled={visibleBusy || !selected}
            onClick={() => {
              if (selected) void linkAndPush("existing", selected.cloneUrl);
            }}
          >
            {visibleBusy ? <Spinner /> : <AccountIcon account={target} />}
            {t(($) => $.library.github.linkAndPush)}
          </Button>
        </Tooltip>
      </div>
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
        <LoadingState size="compact" className="justify-center p-6" label={t(($) => $.common.state.loading)} />
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
        <Tooltip label={t(($) => $.common.actions.close)}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t(($) => $.common.actions.close)}
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </Tooltip>
      </div>

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

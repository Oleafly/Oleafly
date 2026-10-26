import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, GitBranch } from "lucide-react";
import { ForgeAccountSelect } from "@/components/integrations/ForgeAccountSelect";
import { ForgeRepoList } from "@/components/integrations/ForgeRepoList";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { hasRemotePassword, hostLabel, isAllowedRemoteUrl } from "@/lib/forge";
import { logError } from "@/lib/log";
import { openInSystemBrowser } from "@/lib/system-browser";
import type { ForgeAccount, ForgeRepo } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useForgeAccountsStore } from "@/store/forge-accounts";

/** The import dialog's Git step: clone any repository by its address, or
 * pick one from a connected account. */
export function GitImportView({
  busy,
  onImport,
  onClone,
  onOpenSettings,
}: Readonly<{
  busy: boolean;
  onImport: (account: ForgeAccount, repo: ForgeRepo) => void;
  onClone: (url: string) => void;
  onOpenSettings: () => void;
}>) {
  const { t } = useTranslation(["library", "errors"]);
  const accounts = useForgeAccountsStore((s) => s.accounts);
  const status = useForgeAccountsStore((s) => s.status);
  const error = useForgeAccountsStore((s) => s.error);
  const [accountBase, setAccountBase] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const urlId = useId();

  useEffect(() => {
    void useForgeAccountsStore.getState().ensureLoaded();
  }, []);

  const account = accounts.find((item) => item.base === accountBase) ?? accounts[0] ?? null;
  const typed = url.trim();
  const password = hasRemotePassword(typed);
  const canClone = !busy && !password && isAllowedRemoteUrl(typed);

  const renderOpenButton = (target: ForgeAccount, repo: ForgeRepo) => {
    const host = hostLabel(target.base);
    return (
      <Tooltip label={t(($) => $.library.import.openOnHost, { host })} side="top">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={t(($) => $.library.import.openRepositoryOnHost, { name: repo.fullName, host })}
          onClick={() => {
            openInSystemBrowser(repo.webUrl)
              .then((opened) => {
                if (!opened) toast.error(t(($) => $.library.import.openFailed, { host }));
              })
              .catch((error: unknown) => {
                void logError("open repository", error);
                toast.error(t(($) => $.library.import.openFailed, { host }));
              });
          }}
          className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:size-3.5"
        >
          <ExternalLink aria-hidden="true" />
        </Button>
      </Tooltip>
    );
  };

  const renderAccounts = () => {
    if (account) {
      return (
        <section className="space-y-2">
          {accounts.length > 1 ? (
            <ForgeAccountSelect
              accounts={accounts}
              value={account.base}
              onValueChange={setAccountBase}
              label={t(($) => $.library.import.accountLabel)}
              testId="project-import-account"
            />
          ) : null}
          <div className="h-72">
            <ForgeRepoList
              key={account.base}
              account={account}
              disabled={busy}
              rowTestIdPrefix="project-import-repository-"
              onSelect={(repo) => onImport(account, repo)}
              renderTrailing={(repo) => renderOpenButton(account, repo)}
            />
          </div>
        </section>
      );
    }
    if (status === "error") {
      // The accounts couldn't be read, which isn't the same as having none.
      return (
        <ErrorState
          message={error ?? t(($) => $.library.import.repositoriesFailed)}
          size="compact"
          className="rounded-lg border bg-card p-4"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="project-import-accounts-retry"
            onClick={() => void useForgeAccountsStore.getState().reload()}
          >
            {t(($) => $.library.import.tryAgain)}
          </Button>
        </ErrorState>
      );
    }
    if (status === "ready") {
      return (
        <div className="space-y-3 rounded-lg border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">{t(($) => $.library.import.connectPromptGit)}</p>
          <Button type="button" size="sm" onClick={onOpenSettings}>
            <GitBranch aria-hidden="true" className="size-3.5" />
            {t(($) => $.library.import.connectGitHosting)}
          </Button>
        </div>
      );
    }
    return <LoadingState size="compact" className="p-3" label={t(($) => $.library.import.loadingRepositories)} />;
  };

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <label htmlFor={urlId} className="block text-xs font-medium text-muted-foreground">
          {t(($) => $.library.import.cloneLabel)}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={urlId}
            data-testid="project-import-clone-url"
            value={url}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            placeholder={t(($) => $.library.import.clonePlaceholder)}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canClone) onClone(typed);
            }}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            data-testid="project-import-clone"
            disabled={!canClone}
            onClick={() => onClone(typed)}
          >
            {t(($) => $.library.import.cloneAction)}
          </Button>
        </div>
        {password ? (
          <p role="alert" className="text-xs text-destructive">
            {t(($) => $.errors.git.remote_has_password)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t(($) => $.library.import.cloneHint)}</p>
        )}
      </section>
      {renderAccounts()}
    </div>
  );
}

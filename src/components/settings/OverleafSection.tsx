import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  overleafGitTokenClear,
  overleafGitTokenSet,
  overleafGitTokenStatus,
  overleafTokenPage,
} from "@/lib/overleaf-sync";
import { logError } from "@/lib/log";
import { serverHost } from "@/lib/overleaf-live";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  IntegrationCard,
  IntegrationConnected,
  IntegrationError,
} from "@/components/settings/IntegrationCard";
import type { OverleafAccount, OverleafStatus } from "@/lib/overleaf";
import { accountsOf, useOverleafImportStore } from "@/store/overleaf-import";
import { type OverleafDeletes, useSettingsStore } from "@/store/settings";
import { BrowserSignIn, BrowserSignInCopy, WindowSignIn } from "@/components/settings/BrowserSignInCopy";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { OverleafServerField } from "@/components/library/overleaf/OverleafServerField";
import { OverleafSignOutQuestion } from "@/components/library/overleaf/OverleafSignOutQuestion";

export function OverleafSection() {
  const { t } = useTranslation(["settings", "common"]);
  const status = useOverleafImportStore((state) => state.status);
  const server = useOverleafImportStore((state) => state.server);
  const refreshStatus = useOverleafImportStore((state) => state.refreshStatus);
  const signing = useOverleafImportStore((state) => state.phase === "signing-in");
  const [adding, setAdding] = useState(false);
  const accountsKey = accountsOf(status);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (accountsKey) setAdding(false);
  }, [accountsKey]);

  const signedIn = status?.signedIn === true;
  const current = status?.server ?? server;
  const host = serverHost(current);
  const accounts = accountsIn(status);

  return (
    <IntegrationCard
      testId="overleaf-section"
      title={"Overleaf"}
      description={t(($) => $.settings.integrations.overleaf.description)}
      actions={
        signedIn && !adding ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="overleaf-add-account"
            disabled={signing}
            onClick={() => setAdding(true)}
          >
            {t(($) => $.settings.integrations.overleaf.addAccount)}
          </Button>
        ) : null
      }
    >
      {accounts.map((account) => (
        <AccountRow key={account.userId || "current"} account={account} host={host} />
      ))}
      {accounts.length > 1 ? <AccountPicker accounts={accounts} current={status?.userId ?? null} /> : null}
      {signedIn && adding ? (
        <div data-testid="overleaf-add-account-options" className="mt-3 space-y-1">
          <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.overleaf.addAccountHint)}</p>
          <BrowserSignIn fallback={<WindowSignIn />} />
          <BrowserSignInCopy server={current} onSignedIn={() => void refreshStatus()} />
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAdding(false)}>
            {t(($) => $.common.actions.cancel)}
          </Button>
        </div>
      ) : null}
      {signedIn ? null : (
        <>
          <OverleafServerField
            className="mt-1"
            disabled={signing}
            onChanged={() => void refreshStatus()}
          />
          <BrowserSignIn fallback={<WindowSignIn />} />
          <BrowserSignInCopy server={current} onSignedIn={() => void refreshStatus()} />
        </>
      )}
      <GitTokenField
        server={current}
        account={signedIn ? (status?.userId ?? null) : null}
        email={accounts.length > 1 ? (status?.email ?? null) : null}
      />
      <LiveDeletesField />
      <OverleafSignOutQuestion />
    </IntegrationCard>
  );
}

function accountsIn(status: OverleafStatus | null): OverleafAccount[] {
  if (!status?.signedIn) return [];
  if (status.accounts && status.accounts.length > 0) return status.accounts;
  return [{ userId: status.userId ?? "", email: status.email }];
}

function AccountRow({ account, host }: Readonly<{ account: OverleafAccount; host: string }>) {
  const { t } = useTranslation("settings");
  const signOut = useOverleafImportStore((state) => state.signOut);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div data-testid="overleaf-account" className="flex flex-wrap items-center justify-between gap-2 py-1">
      <IntegrationConnected testId="overleaf-connected">
        {account.email
          ? t(($) => $.settings.integrations.overleaf.signedInAs, { email: account.email, server: host })
          : t(($) => $.settings.integrations.overleaf.signedIn, { server: host })}
      </IntegrationConnected>
      <Button
        variant="outline"
        size="sm"
        data-testid="overleaf-settings-sign-out"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const done = await signOut(false, account.userId || null);
          setFailed(!done);
          setBusy(false);
        }}
      >
        {t(($) => $.settings.integrations.overleaf.signOut)}
      </Button>
      {failed ? (
        <div className="basis-full">
          <IntegrationError>{t(($) => $.settings.integrations.overleaf.signOutFailed)}</IntegrationError>
        </div>
      ) : null}
    </div>
  );
}

function AccountPicker({ accounts, current }: Readonly<{ accounts: OverleafAccount[]; current: string | null }>) {
  const { t } = useTranslation("settings");
  const chooseAccount = useOverleafImportStore((state) => state.chooseAccount);
  const importing = useOverleafImportStore((state) => state.importing);
  const label = t(($) => $.settings.integrations.overleaf.accountPick);
  return (
    <SettingsRow
      testId="overleaf-account-picker"
      className="mt-3 flex-wrap gap-y-2"
      label={label}
      description={t(($) => $.settings.integrations.overleaf.accountPickDescription)}
      control={
        <Select value={current ?? undefined} onValueChange={(value) => void chooseAccount(value)} disabled={importing}>
          <SelectTrigger className="w-[220px]" aria-label={label} data-testid="overleaf-account-picker-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {accounts.map((account) => (
              <SelectItem key={account.userId} value={account.userId}>
                {account.email ?? account.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

const DELETE_CHOICES: readonly OverleafDeletes[] = ["ask", "always", "never"];

function LiveDeletesField() {
  const { t } = useTranslation("settings");
  const live = useSettingsStore((state) => state.overleafLive);
  const deletes = useSettingsStore((state) => state.overleafDeletes);
  const setDeletes = useSettingsStore((state) => state.setOverleafDeletes);
  if (!live) return null;
  const label = t(($) => $.settings.integrations.overleaf.deletes.title);
  return (
    <SettingsRow
      testId="overleaf-live-deletes"
      className="mt-4 flex-wrap gap-y-2"
      label={label}
      description={t(($) => $.settings.integrations.overleaf.deletes.description)}
      control={
        <Select value={deletes} onValueChange={(value) => setDeletes(value as OverleafDeletes)}>
          <SelectTrigger className="w-[220px]" aria-label={label} data-testid="overleaf-live-deletes-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {DELETE_CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {t(($) => $.settings.integrations.overleaf.deletes.options[choice])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

function GitTokenField({
  server,
  account,
  email,
}: Readonly<{ server: string; account: string | null; email: string | null }>) {
  const { t } = useTranslation("settings");
  const [saved, setSaved] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    overleafGitTokenStatus(server, account)
      .then((value) => {
        if (!cancelled) setSaved(value);
      })
      .catch((error) => void logError("overleaf git token status", error));
    return () => {
      cancelled = true;
    };
  }, [server, account]);

  const run = async (work: () => Promise<void>, next: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await work();
      setSaved(next);
      setDraft("");
    } catch (error) {
      void logError("overleaf git token", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="overleaf-git-token" className="mt-4 space-y-2 border-t pt-3">
      <p className="text-xs font-medium text-foreground">
        {email
          ? t(($) => $.settings.integrations.overleaf.gitTitleFor, { email })
          : t(($) => $.settings.integrations.overleaf.gitTitle)}
      </p>
      <p className="text-xs text-muted-foreground">
        {saved
          ? t(($) => $.settings.integrations.overleaf.gitSaved)
          : t(($) => $.settings.integrations.overleaf.gitMissing)}
      </p>
      <button
        type="button"
        data-testid="overleaf-git-token-page"
        onClick={() => {
          openExternal(overleafTokenPage(server)).catch((error) => void logError("open overleaf settings", error));
        }}
        className="-ml-1 inline-flex w-fit items-center gap-1 rounded px-1 text-xs font-medium text-primary hover:bg-accent focus-visible:bg-accent"
      >
        {t(($) => $.settings.integrations.overleaf.gitOpenSettings)}
        <ExternalLink aria-hidden className="size-3" />
      </button>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => overleafGitTokenSet(server, draft.trim(), account), true);
        }}
      >
        <Input
          type="password"
          data-testid="overleaf-git-token-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t(($) => $.settings.integrations.overleaf.gitLabel)}
          placeholder={t(($) => $.settings.integrations.overleaf.gitLabel)}
          autoComplete="off"
          className="h-9"
        />
        <Button type="submit" size="sm" disabled={busy || draft.trim().length === 0}>
          {t(($) => $.settings.integrations.overleaf.gitSave)}
        </Button>
        {saved ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="overleaf-git-token-clear"
            disabled={busy}
            onClick={() => void run(() => overleafGitTokenClear(server, account), false)}
          >
            {t(($) => $.settings.integrations.overleaf.gitRemove)}
          </Button>
        ) : null}
      </form>
      <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.overleaf.gitPlanNote)}</p>
      {failed ? <IntegrationError>{t(($) => $.settings.integrations.overleaf.gitFailed)}</IntegrationError> : null}
    </div>
  );
}

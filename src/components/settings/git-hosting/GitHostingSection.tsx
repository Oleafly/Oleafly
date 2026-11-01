import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { gitAutoInitEnabled } from "@/components/settings/gitAutoInit";
import { IntegrationConnected, IntegrationError } from "@/components/settings/IntegrationCard";
import { AccountRow } from "@/components/settings/git-hosting/AccountRow";
import { AddAccountPanel, CA_EXTENSIONS } from "@/components/settings/git-hosting/AddAccountPanel";
import { describeError } from "@/lib/app-error";
import { accountKey, hostLabel } from "@/lib/forge";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { getConfig, setConfig, type AppConfig, type ForgeAccount } from "@/lib/tauri";
import { useForgeAccountsStore } from "@/store/forge-accounts";

export function GitHostingSection() {
  const { t } = useTranslation(["common", "settings"]);
  const status = useForgeAccountsStore((s) => s.status);
  const accounts = useForgeAccountsStore((s) => s.accounts);
  const checks = useForgeAccountsStore((s) => s.checks);
  const loadError = useForgeAccountsStore((s) => s.error);
  const [adding, setAdding] = useState<{ base?: string; caFile?: string | null } | null>(null);
  const [busyBase, setBusyBase] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useForgeAccountsStore
      .getState()
      .ensureLoaded()
      .then(() => useForgeAccountsStore.getState().validateAll());
  }, []);

  const startAdding = (target: { base?: string; caFile?: string | null }) => {
    setNotice(null);
    setError(null);
    setAdding(target);
  };

  const signedIn = (account: ForgeAccount) => {
    setAdding(null);
    setNotice(
      t(($) => $.settings.gitHosting.notice.signedIn, {
        host: hostLabel(account.base),
        login: account.login,
      }),
    );
  };

  const signOut = async (account: ForgeAccount) => {
    setBusyBase(account.base);
    setNotice(null);
    setError(null);
    try {
      await useForgeAccountsStore.getState().signOut(account.base);
      setNotice(t(($) => $.settings.gitHosting.notice.signedOut, { host: hostLabel(account.base) }));
    } catch (error_) {
      setError(describeError(error_));
    } finally {
      setBusyBase(null);
    }
  };

  const changeCa = async (account: ForgeAccount, remove: boolean) => {
    let next: string | null = null;
    if (!remove) {
      const picked = await pickOpenPath({
        title: t(($) => $.settings.gitHosting.add.caPickerTitle),
        multiple: false,
        filters: [{ name: t(($) => $.settings.gitHosting.add.caFilter), extensions: CA_EXTENSIONS }],
      });
      if (typeof picked !== "string") return;
      next = picked;
    }
    setBusyBase(account.base);
    setError(null);
    try {
      await useForgeAccountsStore.getState().setCaFile(account.base, next);
    } catch (error_) {
      setError(describeError(error_));
    } finally {
      setBusyBase(null);
    }
  };

  return (
    <div className="space-y-3 text-sm" data-testid="git-hosting-section">
      <div>
        <h3 className="text-sm font-medium">{t(($) => $.settings.gitHosting.title)}</h3>
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.gitHosting.description)}</p>
      </div>
      <GitAutoInitToggle />
      {status === "loading" && accounts.length === 0 ? (
        <LoadingState size="compact" label={t(($) => $.common.state.loading)} />
      ) : null}
      {status === "error" && loadError ? <IntegrationError>{loadError}</IntegrationError> : null}
      {accounts.length > 0 ? (
        <div className="space-y-2">
          {accounts.map((account) => (
            <AccountRow
              key={accountKey(account.base)}
              account={account}
              check={checks[account.base]}
              busy={busyBase === account.base}
              onSignOut={() => void signOut(account)}
              onSignInAgain={() => startAdding({ base: account.base, caFile: account.caFile ?? null })}
              onChangeCa={() => void changeCa(account, false)}
              onRemoveCa={() => void changeCa(account, true)}
            />
          ))}
        </div>
      ) : null}
      {accounts.length === 0 && status === "ready" ? (
        <EmptyState
          size="compact"
          className="items-start text-left"
          testId="git-hosting-empty"
          description={t(($) => $.settings.gitHosting.empty)}
        />
      ) : null}
      {adding ? (
        <AddAccountPanel
          key={adding.base ?? "new"}
          initialBase={adding.base}
          initialCaFile={adding.caFile ?? null}
          onDone={signedIn}
          onCancel={() => setAdding(null)}
        />
      ) : (
        <Button size="sm" variant="outline" data-testid="git-hosting-add" onClick={() => startAdding({})}>
          <Plus />
          {t(($) => $.settings.gitHosting.addAccount)}
        </Button>
      )}
      {notice ? <IntegrationConnected testId="git-hosting-notice">{notice}</IntegrationConnected> : null}
      {error ? <IntegrationError>{error}</IntegrationError> : null}
    </div>
  );
}

function GitAutoInitToggle() {
  const { t } = useTranslation(["settings"]);
  const [configState, setConfigState] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<"load" | "save" | null>(null);
  const configRequest = useRef(0);
  const configWrites = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const request = ++configRequest.current;
    void getConfig()
      .then((next) => {
        if (request !== configRequest.current) return;
        setConfigState(next);
        setConfigError(null);
      })
      .catch(() => {
        if (request !== configRequest.current) return;
        setConfigError("load");
      });
    return () => {
      configRequest.current += 1;
    };
  }, []);

  const write = (value: boolean) => {
    if (!configState) return;
    const previous = gitAutoInitEnabled(configState);
    const request = ++configRequest.current;
    setConfigState({ ...configState, git_auto_init: value });
    setConfigError(null);
    configWrites.current = configWrites.current
      .then(() => getConfig())
      .then((latest) => setConfig({ ...latest, git_auto_init: value }))
      .catch(async () => {
        setConfigError("save");
        if (request !== configRequest.current) return;
        try {
          const stored = await getConfig();
          if (request === configRequest.current) setConfigState(stored);
        } catch {
          if (request === configRequest.current) {
            setConfigState((current) => (current ? { ...current, git_auto_init: previous } : current));
          }
        }
      });
  };

  return (
    <div className="space-y-2" data-testid="git-auto-init">
      <SettingsToggleRow
        label={t(($) => $.settings.github.autoInit.label)}
        description={t(($) => $.settings.github.autoInit.description)}
        checked={gitAutoInitEnabled(configState)}
        onChange={write}
      />
      {configError ? (
        <p className="text-xs text-destructive" role="alert">
          {configError === "load"
            ? t(($) => $.settings.github.config.loadFailed)
            : t(($) => $.settings.github.config.saveFailed)}
        </p>
      ) : null}
    </div>
  );
}

import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  overleafGitTokenClear,
  overleafGitTokenSet,
  overleafGitTokenStatus,
  overleafTokenPage,
} from "@/lib/overleaf-sync";
import { logError } from "@/lib/log";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  IntegrationCard,
  IntegrationConnected,
  IntegrationError,
} from "@/components/settings/IntegrationCard";
import { useOverleafImportStore } from "@/store/overleaf-import";

function serverHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

export function OverleafSection() {
  const { t } = useTranslation("settings");
  const status = useOverleafImportStore((state) => state.status);
  const server = useOverleafImportStore((state) => state.server);
  const refreshStatus = useOverleafImportStore((state) => state.refreshStatus);
  const signOut = useOverleafImportStore((state) => state.signOut);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const signedIn = status?.signedIn === true;
  const host = serverHost(status?.server ?? server);

  return (
    <IntegrationCard
      testId="overleaf-section"
      title={"Overleaf"}
      description={t(($) => $.settings.integrations.overleaf.description)}
      actions={
        signedIn ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="overleaf-settings-sign-out"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              await signOut();
              const after = useOverleafImportStore.getState().status;
              setFailed(after?.signedIn === true);
              setBusy(false);
            }}
          >
            {t(($) => $.settings.integrations.overleaf.signOut)}
          </Button>
        ) : null
      }
    >
      {signedIn ? (
        <IntegrationConnected testId="overleaf-connected">
          {status?.email
            ? t(($) => $.settings.integrations.overleaf.signedInAs, { email: status.email, server: host })
            : t(($) => $.settings.integrations.overleaf.signedIn, { server: host })}
        </IntegrationConnected>
      ) : (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.overleaf.signedOut)}</p>
      )}
      {failed ? <IntegrationError>{t(($) => $.settings.integrations.overleaf.signOutFailed)}</IntegrationError> : null}
      <GitTokenField server={status?.server ?? server} />
    </IntegrationCard>
  );
}

function GitTokenField({ server }: Readonly<{ server: string }>) {
  const { t } = useTranslation("settings");
  const [saved, setSaved] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    overleafGitTokenStatus(server)
      .then((value) => {
        if (!cancelled) setSaved(value);
      })
      .catch((error) => void logError("overleaf git token status", error));
    return () => {
      cancelled = true;
    };
  }, [server]);

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
      <p className="text-xs font-medium text-foreground">{t(($) => $.settings.integrations.overleaf.gitTitle)}</p>
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
          void run(() => overleafGitTokenSet(server, draft.trim()), true);
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
            onClick={() => void run(() => overleafGitTokenClear(server), false)}
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

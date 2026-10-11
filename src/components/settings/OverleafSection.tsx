import { useEffect, useState } from "react";
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
    </IntegrationCard>
  );
}

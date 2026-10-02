import { useEffect, useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  IntegrationCard,
  IntegrationConnected,
  IntegrationError,
  integrationLink,
} from "@/components/settings/IntegrationCard";
import { useZoteroConnectorStore } from "@/store/zotero-connector";

export function ZoteroSection() {
  const { t } = useTranslation("settings");
  const { connected, loading, username, error, connect, disconnect, refresh } =
    useZoteroConnectorStore();
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState("");
  const errorId = useId();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (await connect(userId.trim(), apiKey.trim())) {
      setApiKey("");
      setUserId("");
    }
  };

  const showConnectError = Boolean(error) && !connected;

  return (
    <IntegrationCard
      testId="zotero-section"
      title={"Zotero"}
      description={t(($) => $.settings.integrations.zotero.description)}
      hint={
        <Trans
          t={t}
          ns="settings"
          i18nKey={($) => $.settings.integrations.zotero.apiKeyHint}
          components={{
            siteLink: integrationLink("https://www.zotero.org"),
            keyLink: integrationLink("https://www.zotero.org/settings/security#applications"),
          }}
        />
      }
      actions={
        connected && (
          <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={loading}>
            {t(($) => $.settings.integrations.actions.disconnect)}
          </Button>
        )
      }
    >
      {connected ? (
        <div className="space-y-1">
          <IntegrationConnected testId="zotero-connected">
            {username
              ? t(($) => $.settings.integrations.zotero.connectedAs, { username })
              : t(($) => $.settings.integrations.zotero.connected)}
          </IntegrationConnected>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.integrations.zotero.importHint)}
          </p>
        </div>
      ) : (
        <form
          className="flex gap-2"
          aria-busy={loading}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t(($) => $.settings.integrations.zotero.userIdPlaceholder)}
            aria-label={t(($) => $.settings.integrations.zotero.userIdLabel)}
            aria-invalid={showConnectError || undefined}
            aria-describedby={showConnectError ? errorId : undefined}
            className="w-28"
          />
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t(($) => $.settings.integrations.zotero.apiKeyLabel)}
            aria-label={t(($) => $.settings.integrations.zotero.apiKeyLabel)}
            aria-invalid={showConnectError || undefined}
            aria-describedby={showConnectError ? errorId : undefined}
            className="max-w-xs"
          />
          <Button
            type="submit"
            size="sm"
            disabled={loading || !apiKey.trim() || !userId.trim()}
          >
            {loading && <Spinner />}
            {t(($) => $.settings.integrations.actions.connect)}
          </Button>
        </form>
      )}
      {error ? <IntegrationError id={errorId}>{error}</IntegrationError> : null}
    </IntegrationCard>
  );
}

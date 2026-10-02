import { useEffect, useState } from "react";
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
import { useAlphaXivConnectorStore } from "@/store/alphaxiv-connector";

const ALPHAXIV_SITE_URL = "https://www.alphaxiv.org";
const ALPHAXIV_MCP_DOCS_URL = "https://www.alphaxiv.org/docs/mcp";

export function AlphaXivSection() {
  const { t } = useTranslation("settings");
  const { connected, loading, failure, connect, disconnect, refresh } =
    useAlphaXivConnectorStore();
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (await connect(apiKey.trim())) setApiKey("");
  };

  return (
    <IntegrationCard
      testId="alphaxiv-section"
      title={"alphaXiv"}
      description={t(($) => $.settings.integrations.alphaxiv.description)}
      hint={
        <Trans
          t={t}
          ns="settings"
          i18nKey={($) => $.settings.integrations.alphaxiv.apiKeyHint}
          components={{
            siteLink: integrationLink(ALPHAXIV_SITE_URL),
            docsLink: integrationLink(ALPHAXIV_MCP_DOCS_URL),
          }}
        />
      }
      actions={
        connected && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void disconnect()}
            disabled={loading}
          >
            {t(($) => $.settings.integrations.actions.disconnect)}
          </Button>
        )
      }
    >
      {connected ? (
        <IntegrationConnected testId="alphaxiv-connected">
          {t(($) => $.settings.integrations.alphaxiv.connected)}
        </IntegrationConnected>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t(($) => $.settings.integrations.alphaxiv.apiKeyLabel)}
            aria-label={t(($) => $.settings.integrations.alphaxiv.apiKeyLabel)}
            className="max-w-xs"
          />
          <Button type="submit" size="sm" disabled={loading || !apiKey.trim()}>
            {loading && <Spinner />}
            {t(($) => $.settings.integrations.actions.connect)}
          </Button>
        </form>
      )}
      {failure ? (
        <IntegrationError>
          {failure === "connect"
            ? t(($) => $.settings.integrations.alphaxiv.connectFailed)
            : t(($) => $.settings.integrations.alphaxiv.disconnectFailed)}
        </IntegrationError>
      ) : null}
    </IntegrationCard>
  );
}

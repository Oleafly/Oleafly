import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div data-testid="alphaxiv-section" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{"alphaXiv"}</h3>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.integrations.alphaxiv.description)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Trans
              t={t}
              ns="settings"
              i18nKey={($) => $.settings.integrations.alphaxiv.apiKeyHint}
              components={{
                siteLink: (
                  <a
                    href={ALPHAXIV_SITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    <span />
                  </a>
                ),
                docsLink: (
                  <a
                    href={ALPHAXIV_MCP_DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    <span />
                  </a>
                ),
              }}
            />
          </p>
        </div>
        {connected && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void disconnect()}
            disabled={loading}
          >
            {t(($) => $.settings.integrations.actions.disconnect)}
          </Button>
        )}
      </div>
      {connected ? (
        <p
          data-testid="alphaxiv-connected"
          className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
        >
          <Check aria-hidden className="mt-px size-3.5 shrink-0" />
          {t(($) => $.settings.integrations.alphaxiv.connected)}
        </p>
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
            {loading && <Loader2 className="animate-spin" />}
            {t(($) => $.settings.integrations.actions.connect)}
          </Button>
        </form>
      )}
      {failure ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {failure === "connect"
              ? t(($) => $.settings.integrations.alphaxiv.connectFailed)
              : t(($) => $.settings.integrations.alphaxiv.disconnectFailed)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

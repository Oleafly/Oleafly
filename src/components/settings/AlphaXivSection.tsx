import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAlphaXivConnectorStore } from "@/store/alphaxiv-connector";

export function AlphaXivSection() {
  const { t } = useTranslation("settings");
  const { connected, loading, connect, disconnect, refresh } = useAlphaXivConnectorStore();
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div data-testid="alphaxiv-section" className="space-y-2">
      <div className="flex items-center justify-between">
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
                    href="https://www.alphaxiv.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    <span />
                  </a>
                ),
                keyLink: (
                  <a
                    href="https://www.alphaxiv.org/@api-key"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    <span />
                  </a>
                ),
                keyPrefix: <code className="rounded bg-muted px-1 py-0.5" />,
              }}
            />
          </p>
        </div>
        {connected && (
          <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={loading}>
            {t(($) => $.settings.integrations.actions.disconnect)}
          </Button>
        )}
      </div>
      {!connected && (
        <div className="flex gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t(($) => $.settings.integrations.alphaxiv.apiKeyLabel)}
            aria-label={t(($) => $.settings.integrations.alphaxiv.apiKeyLabel)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={loading || !apiKey.trim()}
            onClick={() => {
              void connect(apiKey.trim()).then(() => setApiKey(""));
            }}
          >
            {t(($) => $.settings.integrations.actions.connect)}
          </Button>
        </div>
      )}
    </div>
  );
}

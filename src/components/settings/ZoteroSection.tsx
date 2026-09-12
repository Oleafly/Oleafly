import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useZoteroConnectorStore } from "@/store/zotero-connector";

export function ZoteroSection() {
  const { t } = useTranslation("settings");
  const { connected, loading, connect, disconnect, refresh } = useZoteroConnectorStore();
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div data-testid="zotero-section" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{"Zotero"}</h3>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.integrations.zotero.description)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Trans
              t={t}
              ns="settings"
              i18nKey={($) => $.settings.integrations.zotero.apiKeyHint}
              components={{
                siteLink: (
                  <a
                    href="https://www.zotero.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    <span />
                  </a>
                ),
                keyLink: (
                  <a
                    href="https://www.zotero.org/settings/security#applications"
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
          <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={loading}>
            {t(($) => $.settings.integrations.actions.disconnect)}
          </Button>
        )}
      </div>
      {!connected && (
        <div className="flex gap-2">
          <Input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t(($) => $.settings.integrations.zotero.userIdPlaceholder)}
            aria-label={t(($) => $.settings.integrations.zotero.userIdLabel)}
            className="w-28"
          />
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t(($) => $.settings.integrations.zotero.apiKeyLabel)}
            aria-label={t(($) => $.settings.integrations.zotero.apiKeyLabel)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={loading || !apiKey.trim() || !userId.trim()}
            onClick={() => {
              void connect(userId.trim(), apiKey.trim()).then(() => {
                setApiKey("");
                setUserId("");
              });
            }}
          >
            {t(($) => $.settings.integrations.actions.connect)}
          </Button>
        </div>
      )}
    </div>
  );
}

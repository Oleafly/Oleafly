import { useEffect, useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div data-testid="zotero-section" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
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
      {connected ? (
        <div className="space-y-1">
          <p
            data-testid="zotero-connected"
            className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
          >
            <Check aria-hidden className="mt-px size-3.5 shrink-0" />
            {username
              ? t(($) => $.settings.integrations.zotero.connectedAs, { username })
              : t(($) => $.settings.integrations.zotero.connected)}
          </p>
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
            {loading && <Loader2 aria-hidden className="animate-spin" />}
            {t(($) => $.settings.integrations.actions.connect)}
          </Button>
        </form>
      )}
      {error ? (
        <div
          id={errorId}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

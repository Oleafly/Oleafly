import { useEffect, useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertTriangle, Check, CircleSlash } from "lucide-react";
import type { ZoteroConnectionReport, ZoteroLibraryStatus } from "@oleafly/backend-port";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  IntegrationCard,
  IntegrationConnected,
  IntegrationError,
  integrationLink,
} from "@/components/settings/IntegrationCard";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { formatNumber, formatRelativeTimeFrom, formatTime } from "@/lib/intl";
import { useZoteroConnectorStore } from "@/store/zotero-connector";
import { useZoteroLibraryStore } from "@/store/zotero-library";

type Translate = ReturnType<typeof useTranslation<"settings">>["t"];

function localLine(t: Translate, status: ZoteroLibraryStatus | null): { tone: "ok" | "warn" | "off"; text: string } {
  const local = status?.local;
  switch (local?.state) {
    case "ready":
      return {
        tone: "ok",
        text: local.zoteroVersion
          ? t(($) => $.settings.integrations.zotero.local.ready, { version: local.zoteroVersion })
          : t(($) => $.settings.integrations.zotero.local.readyNoVersion),
      };
    case "apiDisabled":
      return { tone: "warn", text: t(($) => $.settings.integrations.zotero.local.apiDisabled) };
    case "unsupported":
      return { tone: "warn", text: t(($) => $.settings.integrations.zotero.local.unsupported) };
    case "notRunning":
      return { tone: "off", text: t(($) => $.settings.integrations.zotero.local.notRunning) };
    default:
      return { tone: "off", text: t(($) => $.settings.integrations.zotero.local.unknown) };
  }
}

function syncLine(t: Translate, status: ZoteroLibraryStatus | null): string {
  if (!status) return t(($) => $.settings.integrations.zotero.sync.never);
  if (status.syncing) {
    return status.progress
      ? t(($) => $.settings.integrations.zotero.sync.progress, {
          done: formatNumber(status.progress.done),
          total: formatNumber(status.progress.total),
        })
      : t(($) => $.settings.integrations.zotero.sync.syncing);
  }
  if (status.retryAt) {
    return t(($) => $.settings.integrations.zotero.sync.rateLimited, { time: formatTime(status.retryAt) });
  }
  if (!status.lastSync) return t(($) => $.settings.integrations.zotero.sync.never);
  const line = t(($) => $.settings.integrations.zotero.sync.status, {
    count: status.itemCount,
    formatted: formatNumber(status.itemCount),
    time: formatRelativeTimeFrom(status.lastSync, Date.now(), {
      justNow: i18n.t(($) => $.researchTools.tasks.relative.justNow),
    }),
  });
  if (status.local.state !== "ready" && status.source !== "web") {
    return `${line} ${t(($) => $.settings.integrations.zotero.sync.fromCache)}`;
  }
  return line;
}

function Report({ t, report }: Readonly<{ t: Translate; report: ZoteroConnectionReport }>) {
  if (report.error) return <IntegrationError>{describeError(report.error)}</IntegrationError>;
  const facts = [
    report.local.zoteroVersion ? t(($) => $.settings.integrations.zotero.report.zotero, { version: report.local.zoteroVersion }) : null,
    report.source === "local"
      ? report.local.bbtVersion !== undefined
        ? t(($) => $.settings.integrations.zotero.report.bbt, { version: report.local.bbtVersion || "" })
        : t(($) => $.settings.integrations.zotero.report.noBbt)
      : null,
    report.source === "web"
      ? t(($) => $.settings.integrations.zotero.report.web)
      : t(($) => $.settings.integrations.zotero.report.local),
  ].filter((fact): fact is string => Boolean(fact));
  return (
    <div data-testid="zotero-report" className="rounded-md border bg-muted/30 px-3 py-2 text-xs" role="status">
      <p className="font-medium">{facts.join(" · ")}</p>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {report.libraries.map((library) => (
          <li key={library.id}>
            {t(($) => $.settings.integrations.zotero.report.library, {
              name: library.kind === "user" ? t(($) => $.settings.integrations.zotero.library.myLibrary) : library.name,
              count: library.itemCount ?? 0,
              formatted: formatNumber(library.itemCount ?? 0),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LocalPanel({ t }: Readonly<{ t: Translate }>) {
  const status = useZoteroLibraryStore((state) => state.status);
  const report = useZoteroLibraryStore((state) => state.report);
  const testing = useZoteroLibraryStore((state) => state.testing);
  const testError = useZoteroLibraryStore((state) => state.testError);
  const test = useZoteroLibraryStore((state) => state.test);
  const sync = useZoteroLibraryStore((state) => state.sync);
  const setEnabled = useZoteroLibraryStore((state) => state.setEnabled);
  const line = localLine(t, status);
  const Icon = line.tone === "ok" ? Check : line.tone === "warn" ? AlertTriangle : CircleSlash;
  const bbt =
    status?.local.state === "ready"
      ? status.local.bbtVersion !== undefined
        ? t(($) => $.settings.integrations.zotero.local.bbtFound, { version: status.local.bbtVersion || "" })
        : t(($) => $.settings.integrations.zotero.local.bbtMissing)
      : null;
  const error = status?.error && !status.syncing ? describeError(status.error) : null;
  return (
    <div className="space-y-3" data-testid="zotero-local">
      <div className="space-y-1">
        <h4 className="text-xs font-medium">{t(($) => $.settings.integrations.zotero.local.heading)}</h4>
        <p
          role="status"
          data-testid="zotero-local-status"
          className={
            line.tone === "ok"
              ? "flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
              : line.tone === "warn"
                ? "flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300"
                : "flex items-start gap-1.5 text-xs text-muted-foreground"
          }
        >
          <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{line.text}</span>
        </p>
        {bbt ? <p className="text-xs text-muted-foreground">{bbt}</p> : null}
        <p className="text-xs text-muted-foreground" data-testid="zotero-sync-status">
          {syncLine(t, status)}
        </p>
        {error ? <IntegrationError>{error}</IntegrationError> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={testing} onClick={() => void test()} data-testid="zotero-test">
          {testing && <Spinner />}
          {t(($) => $.settings.integrations.zotero.test)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={status?.syncing === true}
          onClick={() => void sync({ force: true })}
          data-testid="zotero-sync"
        >
          {status?.syncing && <Spinner />}
          {t(($) => $.settings.integrations.zotero.syncNow)}
        </Button>
      </div>
      {testError ? <IntegrationError>{testError}</IntegrationError> : null}
      {report ? <Report t={t} report={report} /> : null}
      {status && status.libraries.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium">{t(($) => $.settings.integrations.zotero.library.heading)}</legend>
          {status.libraries.map((library) => {
            const name = library.kind === "user" ? t(($) => $.settings.integrations.zotero.library.myLibrary) : library.name;
            return (
              <div key={library.id} className="flex items-center gap-2 text-xs">
                <Switch
                  checked={library.enabled}
                  onCheckedChange={(enabled) => void setEnabled(library.id, enabled)}
                  aria-label={t(($) => $.settings.integrations.zotero.library.toggle, { name })}
                />
                <span className="min-w-0 truncate">{name}</span>
                <span className="text-muted-foreground">
                  {t(($) => $.settings.integrations.zotero.library.items, {
                    count: library.itemCount,
                    formatted: formatNumber(library.itemCount),
                  })}
                </span>
              </div>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

function AccountPanel({ t }: Readonly<{ t: Translate }>) {
  const { connected, loading, username, error, connect, disconnect, refresh } = useZoteroConnectorStore();
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
    <div className="space-y-2 border-t pt-3" data-testid="zotero-account">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-xs font-medium">{t(($) => $.settings.integrations.zotero.account.heading)}</h4>
          <p className="text-xs text-muted-foreground">{t(($) => $.settings.integrations.zotero.account.description)}</p>
          <p className="text-xs text-muted-foreground">
            <Trans
              t={t}
              ns="settings"
              i18nKey={($) => $.settings.integrations.zotero.apiKeyHint}
              components={{
                siteLink: integrationLink("https://www.zotero.org"),
                keyLink: integrationLink("https://www.zotero.org/settings/security#applications"),
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
        <IntegrationConnected testId="zotero-connected">
          {username
            ? t(($) => $.settings.integrations.zotero.connectedAs, { username })
            : t(($) => $.settings.integrations.zotero.connected)}
        </IntegrationConnected>
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
          <Button type="submit" size="sm" disabled={loading || !apiKey.trim()}>
            {loading && <Spinner />}
            {t(($) => $.settings.integrations.actions.connect)}
          </Button>
        </form>
      )}
      {error ? <IntegrationError id={errorId}>{error}</IntegrationError> : null}
    </div>
  );
}

export function ZoteroSection() {
  const { t } = useTranslation("settings");
  const load = useZoteroLibraryStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <IntegrationCard
      testId="zotero-section"
      title={"Zotero"}
      description={t(($) => $.settings.integrations.zotero.citeDescription)}
    >
      <div className="space-y-3">
        <LocalPanel t={t} />
        <AccountPanel t={t} />
      </div>
    </IntegrationCard>
  );
}

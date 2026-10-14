import { CloudAccountCard } from "@/components/settings/cloud/CloudAccountCard";
import { CloudConnectPanel } from "@/components/settings/cloud/CloudConnectPanel";
import { CloudProjectsCard } from "@/components/settings/cloud/CloudProjectsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCloudStore } from "@/store/cloud";
import { useSettingsStore } from "@/store/settings";
import { DropboxBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { CloudBackup, Files, History, Settings2, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

function Placeholder() {
  const { t } = useTranslation(["shell"]);
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex max-w-xl flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
            <CloudBackup className="size-4" />
          </span>
          <h3 className="font-semibold text-foreground">{t(($) => $.shell.settings.data.cloud.title)}</h3>
          <Badge variant="muted" size="sm" className="uppercase tracking-wide">
            {t(($) => $.shell.settings.data.cloud.comingSoon)}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.shell.settings.data.cloud.placeholder)}
        </p>
      </div>
    </div>
  );
}

function ConnectCard() {
  const { t } = useTranslation(["shell"]);
  const status = useCloudStore((s) => s.status);
  const state = useCloudStore((s) => s.state);
  const connectFlow = useCloudStore((s) => s.connectFlow);
  const connectError = useCloudStore((s) => s.connectError);
  const beginConnect = useCloudStore((s) => s.beginConnect);

  const lines = [
    { icon: Files, text: t(($) => $.shell.settings.data.cloud.syncFiles) },
    { icon: History, text: t(($) => $.shell.settings.data.cloud.syncCheckpoints) },
    { icon: Settings2, text: t(($) => $.shell.settings.data.cloud.syncSettings) },
  ];

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0061FF] text-white" aria-hidden>
          <DropboxBrandIcon className="size-4" />
        </span>
        <h3 className="font-semibold text-foreground">{t(($) => $.shell.settings.data.cloud.dropbox)}</h3>
      </div>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-foreground">
        {t(($) => $.shell.settings.data.cloud.lead)}
      </p>
      <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2.5">
        <ul className="space-y-1.5">
          {lines.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
            <span>{t(($) => $.shell.settings.data.cloud.syncNever)}</span>
          </li>
        </ul>
      </div>
      <div className="mt-4">
        {status === "connecting" && connectFlow ? (
          <CloudConnectPanel />
        ) : (
          <div className="space-y-2">
            <Button type="button" onClick={() => void beginConnect(false)}>
              {t(($) => $.shell.settings.data.cloud.connectDropbox)}
            </Button>
            {connectError ? (
              <p role="alert" className="text-xs text-destructive">
                {connectError}
              </p>
            ) : null}
          </div>
        )}
      </div>
      {state?.lastEmail ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t(($) => $.shell.settings.data.cloud.lastConnected, { email: state.lastEmail })}
        </p>
      ) : null}
    </section>
  );
}

export function CloudTab() {
  const { t } = useTranslation(["shell"]);
  const cloudSync = useSettingsStore((s) => s.cloudSync);
  const status = useCloudStore((s) => s.status);
  const loadError = useCloudStore((s) => s.loadError);
  const refresh = useCloudStore((s) => s.refresh);

  useEffect(() => {
    if (cloudSync) void refresh();
  }, [cloudSync, refresh]);

  const pendingSettingsImport = useCloudStore((s) => s.pendingSettingsImport);
  const requestSettingsNav = useSettingsStore((s) => s.requestSettingsNav);
  useEffect(() => {
    if (status === "connected" && pendingSettingsImport) {
      requestSettingsNav("general");
    }
  }, [status, pendingSettingsImport, requestSettingsNav]);

  if (!cloudSync) return <Placeholder />;

  if (status === "unknown" && !loadError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-5 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t(($) => $.shell.settings.data.cloud.waiting)}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <p role="alert" className="text-sm text-foreground">
          {t(($) => $.shell.settings.data.cloud.loadFailed)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
          {t(($) => $.shell.settings.data.cloud.tryAgain)}
        </Button>
      </div>
    );
  }

  if (status === "connected") {
    return (
      <section className="overflow-hidden rounded-xl border bg-card">
        <CloudAccountCard />
        <CloudProjectsCard />
      </section>
    );
  }

  return <ConnectCard />;
}

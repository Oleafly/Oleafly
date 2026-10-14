import { DropboxProviderCard } from "@/components/settings/cloud/DropboxProviderCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCloudStore } from "@/store/cloud";
import { useSettingsStore } from "@/store/settings";
import { CloudBackup } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogUpdates } from "@/i18n/use-catalog-updates";

function Placeholder() {
  const { t } = useTranslation(["cloud"]);
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex max-w-xl flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
            <CloudBackup className="size-4" />
          </span>
          <h3 className="font-semibold text-foreground">{t(($) => $.cloud.title)}</h3>
          <Badge variant="muted" size="sm" className="uppercase tracking-wide">
            {t(($) => $.cloud.comingSoon)}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.cloud.placeholder)}
        </p>
      </div>
    </div>
  );
}

export function CloudTab() {
  const { t } = useTranslation(["cloud"]);
  useCatalogUpdates("cloud");
  const cloudSync = useSettingsStore((s) => s.cloudSync);
  const requestNav = useCloudStore((s) => s.requestNav);
  const status = useCloudStore((s) => s.status);
  const state = useCloudStore((s) => s.state);
  const loadError = useCloudStore((s) => s.loadError);
  const settingsImport = useCloudStore((s) => s.settingsImport);
  const refresh = useCloudStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (settingsImport === "resume") requestNav("general");
  }, [settingsImport, requestNav]);

  const hasAccount = status === "connected" || status === "revoked";
  if (!cloudSync && !hasAccount) return <Placeholder />;

  if (!state) {
    if (loadError) {
      return (
        <div className="space-y-3 rounded-xl border bg-card p-5">
          <p role="alert" className="text-sm text-foreground">
            {t(($) => $.cloud.loadFailed)}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            {t(($) => $.cloud.tryAgain)}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-5 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t(($) => $.cloud.loading)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DropboxProviderCard experimentOn={cloudSync} />
    </div>
  );
}

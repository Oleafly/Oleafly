import { DropboxProviderCard } from "@/components/settings/cloud/DropboxProviderCard";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCloudStore } from "@/store/cloud";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogUpdates } from "@/i18n/use-catalog-updates";

export function CloudTab() {
  const { t } = useTranslation(["cloud"]);
  useCatalogUpdates("cloud");
  const requestNav = useCloudStore((s) => s.requestNav);
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
      <DropboxProviderCard />
    </div>
  );
}

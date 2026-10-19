import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { IntegrationError } from "@/components/settings/IntegrationCard";
import { SettingsPath } from "@/components/settings/SettingsPath";
import { describeError } from "@/lib/app-error";
import { cuaDriverPickApp, type AllowedApp, type BlockReason, type InstalledApp } from "@/lib/desktop-apps";
import { cn } from "@/lib/utils";
import { filterApps, sameApp, useInstalledApps } from "./desktop-apps-queries";

export interface AppPickerDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Apps already allowed; they show but can't be picked again. */
  existing: readonly AllowedApp[];
  onPick(app: InstalledApp): void;
}

function appKey(app: InstalledApp): string {
  return app.bundleId ?? app.executable ?? app.name;
}

/** Picks an installed app agents may use. Blocked apps show why. */
export default function AppPickerDialog({ open, onOpenChange, existing, onPick }: AppPickerDialogProps) {
  const { t } = useTranslation(["common", "settings"]);
  const apps = useInstalledApps(open);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<InstalledApp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const shown = useMemo(() => filterApps(apps.data ?? [], query), [apps.data, query]);

  const blockedText = (reason: BlockReason) => t(($) => $.settings.integrations.desktopApps.apps.blocked[reason]);

  const close = () => {
    setSelected(null);
    setQuery("");
    setError(null);
    onOpenChange(false);
  };

  const pick = (app: InstalledApp) => {
    onPick(app);
    close();
  };

  const chooseAnother = async () => {
    setChoosing(true);
    setError(null);
    try {
      const app = await cuaDriverPickApp();
      if (!app) return;
      if (app.blocked) {
        setError(blockedText(app.blocked));
        return;
      }
      pick(app);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setChoosing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="z-[120] max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-lg"
        overlayClassName="z-[120]"
        data-testid="desktop-apps-picker"
      >
        <DialogHeader>
          <DialogTitle>{t(($) => $.settings.integrations.desktopApps.apps.dialog.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.settings.integrations.desktopApps.apps.dialog.description)}</DialogDescription>
        </DialogHeader>

        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(($) => $.settings.integrations.desktopApps.apps.dialog.search)}
          aria-label={t(($) => $.settings.integrations.desktopApps.apps.dialog.search)}
        />

        {apps.isPending ? (
          <LoadingState label={t(($) => $.settings.integrations.desktopApps.apps.dialog.loading)} size="compact" />
        ) : apps.isError ? (
          <IntegrationError>{describeError(apps.error)}</IntegrationError>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(($) => $.settings.integrations.desktopApps.apps.dialog.none)}</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="desktop-apps-picker-list">
            {shown.map((app) => {
              const added = existing.some((known) => sameApp(known, app));
              const unavailable = Boolean(app.blocked) || added;
              const isSelected = selected !== null && appKey(selected) === appKey(app);
              const reasonId = `desktop-app-reason-${appKey(app)}`;
              return (
                <li key={appKey(app)}>
                  <button
                    type="button"
                    disabled={unavailable}
                    aria-pressed={isSelected}
                    aria-describedby={app.blocked ? reasonId : undefined}
                    onClick={() => setSelected(app)}
                    onDoubleClick={() => !unavailable && pick(app)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                      "hover:bg-accent focus-visible:border-ring focus-visible:bg-accent",
                      "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
                      isSelected ? "border-primary bg-accent" : "border-transparent",
                    )}
                  >
                    <span className="text-sm font-medium">{app.name}</span>
                    {app.bundleId ? (
                      <span className="text-xs text-muted-foreground">{app.bundleId}</span>
                    ) : app.executable ? (
                      <span className="text-xs text-muted-foreground">
                        <SettingsPath path={app.executable} focusable={false} />
                      </span>
                    ) : null}
                    {app.blocked ? (
                      <span id={reasonId} className="text-xs text-muted-foreground">
                        {blockedText(app.blocked)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error ? <IntegrationError>{error}</IntegrationError> : null}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button type="button" variant="outline" disabled={choosing} onClick={() => void chooseAnother()}>
            {t(($) => $.settings.integrations.desktopApps.apps.dialog.choose)}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t(($) => $.common.actions.cancel)}
            </Button>
            <Button type="button" disabled={!selected} onClick={() => selected && pick(selected)}>
              {t(($) => $.settings.integrations.desktopApps.apps.dialog.add)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

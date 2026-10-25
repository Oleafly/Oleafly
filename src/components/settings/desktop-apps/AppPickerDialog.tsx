import { useId, useMemo, useState } from "react";
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
import { appRowKey, matchApps, MAX_PICKER_ROWS, sameApp, useInstalledApps } from "./desktop-apps-queries";

export interface AppPickerDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Apps already allowed; they show but can't be picked again. */
  existing: readonly AllowedApp[];
  onPick(app: InstalledApp): void;
}

/** The line under an app's name: its bundle id, or the path of its program. */
function AppSubtitle({ app }: Readonly<{ app: InstalledApp }>) {
  if (app.bundleId) return <span className="text-xs text-muted-foreground">{app.bundleId}</span>;
  if (app.executable) {
    return (
      <span className="text-xs text-muted-foreground">
        <SettingsPath path={app.executable} focusable={false} />
      </span>
    );
  }
  return null;
}

/** Picks an installed app agents may use. Blocked apps show why. */
export default function AppPickerDialog({ open, onOpenChange, existing, onPick }: Readonly<AppPickerDialogProps>) {
  const { t } = useTranslation(["common", "settings"]);
  const apps = useInstalledApps(open);
  const reasonIds = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<InstalledApp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const matches = useMemo(() => matchApps(apps.data ?? [], query), [apps.data, query]);
  const shown = useMemo(() => matches.slice(0, MAX_PICKER_ROWS), [matches]);

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
    } catch (error_) {
      setError(describeError(error_));
    } finally {
      setChoosing(false);
    }
  };

  const renderResults = () => {
    if (apps.isPending) {
      return <LoadingState label={t(($) => $.settings.integrations.desktopApps.apps.dialog.loading)} size="compact" />;
    }
    if (apps.isError) return <IntegrationError>{describeError(apps.error)}</IntegrationError>;
    if (shown.length === 0) {
      return <p className="text-sm text-muted-foreground">{t(($) => $.settings.integrations.desktopApps.apps.dialog.none)}</p>;
    }
    return (
      <>
        <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="desktop-apps-picker-list">
          {shown.map((app, index) => {
            const added = existing.some((known) => sameApp(known, app));
            const unavailable = Boolean(app.blocked) || added;
            const isSelected = selected !== null && appRowKey(selected) === appRowKey(app);
            // The row's position, not its program: several entries can
            // run the same program, and a path can hold spaces.
            const reasonId = `${reasonIds}-reason-${index}`;
            return (
              <li key={appRowKey(app)}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={unavailable}
                  aria-pressed={isSelected}
                  aria-describedby={unavailable ? reasonId : undefined}
                  onClick={() => setSelected(app)}
                  onDoubleClick={() => !unavailable && pick(app)}
                  className={cn(
                    "flex h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal border px-3 py-2 text-left font-normal",
                    "focus-visible:border-ring",
                    isSelected ? "border-primary bg-accent" : "border-transparent",
                  )}
                >
                  <span className="text-sm font-medium">{app.name}</span>
                  <AppSubtitle app={app} />
                  {unavailable ? (
                    <span id={reasonId} className="text-xs text-muted-foreground">
                      {app.blocked ? blockedText(app.blocked) : t(($) => $.settings.integrations.desktopApps.apps.dialog.added)}
                    </span>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>
        {matches.length > shown.length ? (
          <p className="text-xs text-muted-foreground" data-testid="desktop-apps-picker-more">
            {t(($) => $.settings.integrations.desktopApps.apps.dialog.more, {
              shown: shown.length,
              total: matches.length,
            })}
          </p>
        ) : null}
      </>
    );
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

        <div className="flex gap-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(($) => $.settings.integrations.desktopApps.apps.dialog.search)}
            aria-label={t(($) => $.settings.integrations.desktopApps.apps.dialog.search)}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={apps.isFetching}
            onClick={() => void apps.refetch()}
          >
            {t(($) => $.settings.integrations.desktopApps.apps.dialog.refresh)}
          </Button>
        </div>

        {renderResults()}

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

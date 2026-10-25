import { useContext, useEffect } from "react";
import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DESKTOP_APPS_STATUS_KEY,
  useDesktopAppsToolReady,
} from "@/components/settings/desktop-apps/desktop-apps-queries";
import { cuaDriverStatus, type DesktopAppsStatus } from "@/lib/desktop-apps";
import { useSettingsStore } from "@/store/settings";

/** Opens Settings, Integrations, Desktop apps, where the connector is turned on. */
function openDesktopAppsSettings() {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("integrations");
  settings.setSettingsScrollTarget("desktop-apps");
  settings.setSettingsOpen(true);
}

/** Tasks can use desktop apps when the connector is on and allows at least one app or site. */
export function desktopAppsReady(status: DesktopAppsStatus | undefined): boolean {
  if (!status?.supported) return false;
  const { enabled, apps, sites } = status.settings;
  return enabled && apps.length + sites.length > 0;
}

interface DesktopAppsBriefFieldProps {
  id: string;
  checked: boolean;
  disabled: boolean;
  /** The task starts on a schedule or keeps running after Oleafly closes. */
  unattended: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Opens Settings; the composer closes first, since Settings can't open inside it. */
  onOpenSettings?: (open: () => void) => void;
}

/** The brief's "Desktop apps" permission. */
export function DesktopAppsBriefField(props: Readonly<DesktopAppsBriefFieldProps>) {
  // Without the app's query client (tests, windows that don't load it) the
  // connector's status is unknown, so the permission stays off.
  const client = useContext(QueryClientContext);
  return client ? <WithStatus {...props} /> : <DesktopAppsCheckbox {...props} ready={false} known={false} />;
}

function WithStatus(props: Readonly<DesktopAppsBriefFieldProps>) {
  // The full status runs the driver, so this only reads it when Settings has
  // already loaded it. Otherwise the tool spec says whether agents can use
  // desktop apps, which is all the brief needs.
  const loaded = useQuery({ queryKey: DESKTOP_APPS_STATUS_KEY, queryFn: cuaDriverStatus, enabled: false });
  const spec = useDesktopAppsToolReady(loaded.data === undefined);
  const ready = loaded.data === undefined ? spec.data === true : desktopAppsReady(loaded.data);
  const known = loaded.data !== undefined || spec.data !== undefined;
  return <DesktopAppsCheckbox {...props} ready={ready} known={known} />;
}

function DesktopAppsCheckbox({
  id,
  checked,
  disabled,
  unattended,
  onCheckedChange,
  onOpenSettings,
  ready,
  known,
}: Readonly<DesktopAppsBriefFieldProps & { ready: boolean; known: boolean }>) {
  const { t } = useTranslation(["settings", "researchTools"]);
  const blocked = !ready || unattended;
  // A box shown unchecked must not save as on: a task that can't use desktop
  // apps gives the permission up (once the connector's state is known).
  const drop = checked && (unattended || (known && !ready));
  useEffect(() => {
    if (drop) onCheckedChange(false);
  }, [drop, onCheckedChange]);
  let hint = t(($) => $.settings.integrations.desktopApps.task.description);
  if (unattended) {
    hint = t(($) => $.settings.integrations.desktopApps.task.unattended);
  } else if (!ready) {
    hint = t(($) => $.settings.integrations.desktopApps.task.off);
  }
  return (
    <div className="grid gap-1" data-testid="research-brief-desktop-apps">
      <label htmlFor={id} className="flex items-start gap-2 text-xs">
        <Checkbox
          id={id}
          disabled={disabled || blocked}
          checked={checked && !blocked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        <span>
          <span className="font-medium">{t(($) => $.settings.integrations.desktopApps.task.label)}</span>
          <span className="block text-muted-foreground">{hint}</span>
        </span>
      </label>
      {!ready && !unattended ? (
        <Button
          type="button"
          size="xs"
          variant="link"
          className="justify-start px-0"
          data-testid="research-brief-desktop-apps-settings"
          onClick={() => (onOpenSettings ? onOpenSettings(openDesktopAppsSettings) : openDesktopAppsSettings())}
        >
          {t(($) => $.researchTools.compute.brief.openSettings)}
        </Button>
      ) : null}
    </div>
  );
}

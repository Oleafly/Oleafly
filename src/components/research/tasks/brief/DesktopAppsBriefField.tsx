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

function openDesktopAppsSettings() {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("integrations");
  settings.setSettingsScrollTarget("desktop-apps");
  settings.setSettingsOpen(true);
}

export function desktopAppsReady(status: DesktopAppsStatus | undefined): boolean {
  if (!status?.supported) return false;
  const { enabled, apps, sites } = status.settings;
  return enabled && apps.length + sites.length > 0;
}

interface DesktopAppsBriefFieldProps {
  id: string;
  checked: boolean;
  disabled: boolean;
  unattended: boolean;
  onCheckedChange: (checked: boolean) => void;
  onOpenSettings?: (open: () => void) => void;
}

export function DesktopAppsBriefField(props: Readonly<DesktopAppsBriefFieldProps>) {
  const client = useContext(QueryClientContext);
  return client ? <WithStatus {...props} /> : <DesktopAppsCheckbox {...props} ready={false} known={false} />;
}

function WithStatus(props: Readonly<DesktopAppsBriefFieldProps>) {
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

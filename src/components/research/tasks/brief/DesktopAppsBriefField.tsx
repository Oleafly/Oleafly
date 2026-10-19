import { useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { useDesktopAppsStatus } from "@/components/settings/desktop-apps/desktop-apps-queries";
import type { DesktopAppsStatus } from "@/lib/desktop-apps";

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
}

/** The brief's "Desktop apps" permission. */
export function DesktopAppsBriefField(props: Readonly<DesktopAppsBriefFieldProps>) {
  // Without the app's query client (tests, windows that don't load it) the
  // connector's status is unknown, so the permission stays off.
  const client = useContext(QueryClientContext);
  return client ? <WithStatus {...props} /> : <DesktopAppsCheckbox {...props} ready={false} />;
}

function WithStatus(props: Readonly<DesktopAppsBriefFieldProps>) {
  const status = useDesktopAppsStatus();
  return <DesktopAppsCheckbox {...props} ready={desktopAppsReady(status.data)} />;
}

function DesktopAppsCheckbox({
  id,
  checked,
  disabled,
  unattended,
  onCheckedChange,
  ready,
}: Readonly<DesktopAppsBriefFieldProps & { ready: boolean }>) {
  const { t } = useTranslation(["settings"]);
  const blocked = !ready || unattended;
  let hint = t(($) => $.settings.integrations.desktopApps.task.description);
  if (unattended) {
    hint = t(($) => $.settings.integrations.desktopApps.task.unattended);
  } else if (!ready) {
    hint = t(($) => $.settings.integrations.desktopApps.task.off);
  }
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-xs" data-testid="research-brief-desktop-apps">
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
  );
}

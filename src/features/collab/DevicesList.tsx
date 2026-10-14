import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Laptop, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { formatDate, formatDateTime } from "@/lib/intl";
import type { CollabDevice } from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

export type DevicesListVariant = "own" | "member";

export function DevicesList({
  variant,
  ownerName = "",
  load,
  signOut,
}: Readonly<{
  variant: DevicesListVariant;
  ownerName?: string;
  load: () => Promise<CollabDevice[]>;
  signOut: (deviceId: string) => Promise<void>;
}>) {
  const { t } = useTranslation(["collab"]);
  const titleId = useId();
  const loadRef = useRef(load);
  loadRef.current = load;
  const [devices, setDevices] = useState<CollabDevice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CollabDevice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const generation = useRef(0);
  const own = variant === "own";

  const fetchDevices = useCallback(() => {
    generation.current += 1;
    const current = generation.current;
    setLoadError(null);
    loadRef.current().then(
      (next) => {
        if (generation.current === current) setDevices(next);
      },
      (error: unknown) => {
        if (generation.current === current) setLoadError(collabErrorMessage(collabErrorCode(error)));
      },
    );
  }, []);

  useEffect(() => {
    fetchDevices();
    return () => {
      generation.current += 1;
    };
  }, [fetchDevices]);

  const signOutDevice = async (device: CollabDevice) => {
    setConfirming(null);
    setBusyId(device.device_id);
    setActionError(null);
    try {
      await signOut(device.device_id);
      setDevices((current) => current?.filter((item) => item.device_id !== device.device_id) ?? null);
    } catch (error) {
      setActionError(collabErrorMessage(collabErrorCode(error)));
    } finally {
      setBusyId(null);
    }
  };

  const renderDevices = () => {
    if (loadError) {
      return (
        <LoadFailed
          message={
            own
              ? t(($) => $.collab.section.devices.loadFailed)
              : t(($) => $.collab.admin.members.devicesLoadFailed)
          }
          reason={loadError}
          onRetry={fetchDevices}
        />
      );
    }
    if (!devices) {
      return (
        <LoadingState
          size="compact"
          label={own ? t(($) => $.collab.section.devices.loading) : t(($) => $.collab.admin.members.devicesLoading)}
        />
      );
    }
    if (devices.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="rounded-md border border-dashed px-3 py-4"
          title={t(($) => $.collab.section.devices.empty)}
        />
      );
    }
    return (
      <ul className="divide-y rounded-md border bg-background">
        {devices.map((device) => (
          <li
            key={device.device_id}
            data-testid={`collab-device-${device.device_id}`}
            className="flex items-center gap-3 px-3 py-2"
          >
            <Laptop aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{device.name}</p>
              <p className="truncate text-[0.6875rem] text-muted-foreground">
                {PLATFORM_NAMES[device.platform] ?? device.platform}
                {" · "}
                {t(($) => $.collab.section.devices.added, { date: formatDate(device.created_at) })}
                {" · "}
                {typeof device.last_seen_at === "number"
                  ? t(($) => $.collab.section.devices.lastSeen, { date: formatDateTime(device.last_seen_at) })
                  : t(($) => $.collab.section.devices.neverSeen)}
              </p>
            </div>
            {device.current ? (
              <Badge variant="primaryGhost" size="sm">
                {t(($) => $.collab.section.devices.current)}
              </Badge>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t(($) => $.collab.section.devices.signOutNamed, { name: device.name })}
                disabled={busyId === device.device_id}
                onClick={() => setConfirming(device)}
              >
                <LogOut aria-hidden />
                {t(($) => $.collab.section.devices.signOut)}
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  };

  const confirmName = confirming?.name ?? "";

  return (
    <section aria-labelledby={titleId} className="space-y-2">
      <div>
        <h4 id={titleId} className="text-xs font-medium">
          {own
            ? t(($) => $.collab.section.devices.title)
            : t(($) => $.collab.admin.members.devicesTitle, { name: ownerName })}
        </h4>
        <p className="text-[0.6875rem] text-muted-foreground">
          {own
            ? t(($) => $.collab.section.devices.description)
            : t(($) => $.collab.admin.members.devicesDescription)}
        </p>
      </div>
      {renderDevices()}
      {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
      <ConfirmationDialog
        open={confirming !== null}
        title={
          own
            ? t(($) => $.collab.section.devices.signOutConfirm.title, { name: confirmName })
            : t(($) => $.collab.admin.members.deviceSignOutConfirm.title, { name: confirmName })
        }
        description={
          own
            ? t(($) => $.collab.section.devices.signOutConfirm.description)
            : t(($) => $.collab.admin.members.deviceSignOutConfirm.description)
        }
        confirmLabel={
          own
            ? t(($) => $.collab.section.devices.signOutConfirm.confirm)
            : t(($) => $.collab.admin.members.deviceSignOutConfirm.confirm)
        }
        destructive
        onConfirm={() => {
          if (confirming) void signOutDevice(confirming);
        }}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}

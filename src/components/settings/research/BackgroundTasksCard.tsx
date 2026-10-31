import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Moon } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ErrorState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { ResearchCard } from "./ResearchCard";
import { useTauriSubscription } from "@/hooks/use-tauri-event";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import {
  getBackgroundHelperStatus,
  listenForBackgroundHelper,
  revealBackgroundHelperLog,
  setBackgroundHelperAtLogin,
  setBackgroundTasksEnabled,
  stopBackgroundHelper,
  type BackgroundHelperStatus,
} from "@/lib/background-helper";

type Busy = "enabled" | "atLogin" | "stop";

export function BackgroundTasksCard() {
  const { t } = useTranslation(["common", "settings"]);
  const [status, setStatus] = useState<BackgroundHelperStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [confirmStop, setConfirmStop] = useState<number | null>(null);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getBackgroundHelperStatus();
      if (!live.current) return;
      setStatus(next);
      setStatusFailed(false);
    } catch (error) {
      void logError("background helper status", error);
      if (live.current) setStatusFailed(true);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, [refresh]);

  const subscribe = useCallback(() => listenForBackgroundHelper(() => void refresh()), [refresh]);
  useTauriSubscription(subscribe, "listen for the background helper");

  const apply = async (kind: Busy, work: () => Promise<BackgroundHelperStatus>, failure: string) => {
    setBusy(kind);
    try {
      const next = await work();
      if (live.current) setStatus(next);
    } catch (error) {
      notifyError(`background helper ${kind}`, error, failure);
    } finally {
      if (live.current) setBusy(null);
    }
  };

  const stop = () =>
    void apply("stop", stopBackgroundHelper, t(($) => $.settings.research.background.stopFailed));

  const revealLog = async () => {
    try {
      await revealBackgroundHelperLog();
    } catch (error) {
      notifyError("background helper log", error);
    }
  };

  const toggleFailed = t(($) => $.settings.research.background.toggleFailed);
  const enabled = status?.enabled ?? true;
  const atLogin = status?.atLogin ?? null;
  let atLoginNote: string | null = null;
  if (status && !enabled) atLoginNote = t(($) => $.settings.research.background.atLogin.needsBackground);
  else if (atLogin?.state === "move_app") atLoginNote = t(($) => $.settings.research.background.atLogin.moveApp);
  else if (atLogin?.state === "unsupported") atLoginNote = atLogin.reason;

  let stateLabel = t(($) => $.settings.research.background.status.stopped);
  let stateVariant: BadgeVariant = "muted";
  if (status?.running && status.hung) {
    stateLabel = t(($) => $.settings.research.background.status.notResponding);
    stateVariant = "warning";
  } else if (status?.running) {
    stateLabel = t(($) => $.settings.research.background.status.running);
    stateVariant = "success";
  }

  return (
    <ResearchCard
      id="research-background-title"
      icon={Moon}
      title={t(($) => $.settings.research.background.title)}
      testId="research-background"
    >
      {statusFailed && !status ? (
        <ErrorState size="compact" message={t(($) => $.settings.research.background.statusFailed)}>
          <Button size="xs" variant="outline" onClick={() => void refresh()}>
            {t(($) => $.common.actions.retry)}
          </Button>
        </ErrorState>
      ) : null}
      <SettingsToggleRow
        testId="research-background-enabled"
        label={t(($) => $.settings.research.background.enabled.label)}
        description={t(($) => $.settings.research.background.enabled.description)}
        checked={enabled}
        disabled={!status || busy !== null}
        onChange={(value) =>
          void apply(
            "enabled",
            () => setBackgroundTasksEnabled(value).then(() => getBackgroundHelperStatus()),
            toggleFailed,
          )
        }
      />
      <SettingsToggleRow
        testId="research-background-at-login"
        label={t(($) => $.settings.research.background.atLogin.label)}
        description={t(($) => $.settings.research.background.atLogin.description)}
        checked={atLogin?.state === "enabled"}
        disabled={!status || busy !== null || !enabled || atLogin?.state === "unsupported"}
        onChange={(value) => void apply("atLogin", () => setBackgroundHelperAtLogin(value), toggleFailed)}
      />
      {atLoginNote ? <SettingsNote testId="research-background-at-login-note">{atLoginNote}</SettingsNote> : null}
      <SettingsRow
        testId="research-background-status"
        label={t(($) => $.settings.research.background.status.label)}
        adornment={
          <Badge size="sm" variant={stateVariant} data-testid="research-background-state">
            {stateLabel}
          </Badge>
        }
        description={
          status?.running
            ? t(($) => $.settings.research.background.status.tasks, { count: status.taskCount })
            : undefined
        }
        control={
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" disabled={!status} onClick={() => void revealLog()}>
              {t(($) => $.settings.research.background.openLog)}
            </Button>
            <Tooltip label={t(($) => $.settings.research.background.stopHint)}>
              <Button
                size="sm"
                variant="outline"
                disabled={!status?.running || busy !== null}
                onClick={() => {
                  if (status && status.taskCount > 0) setConfirmStop(status.taskCount);
                  else stop();
                }}
              >
                {busy === "stop" ? <Spinner size="sm" aria-hidden /> : null}
                {t(($) => $.settings.research.background.stop)}
              </Button>
            </Tooltip>
          </div>
        }
      />
      <ConfirmationDialog
        open={confirmStop !== null}
        title={t(($) => $.settings.research.background.stopConfirm.title)}
        description={t(($) => $.settings.research.background.stopConfirm.description, { count: confirmStop ?? 0 })}
        confirmLabel={t(($) => $.settings.research.background.stop)}
        onConfirm={() => {
          setConfirmStop(null);
          stop();
        }}
        onCancel={() => setConfirmStop(null)}
      />
    </ResearchCard>
  );
}

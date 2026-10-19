// 0.4.8 L: Settings › Research › Background tasks.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Moon } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
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

/** Whether tasks keep running after Oleafly closes, the helper's sign-in
 * start, and what the helper is doing now. */
export function BackgroundTasksCard() {
  const { t } = useTranslation(["settings"]);
  const [status, setStatus] = useState<BackgroundHelperStatus | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getBackgroundHelperStatus();
      if (live.current) setStatus(next);
    } catch (error) {
      // The card keeps what it showed; nothing the user asked for failed.
      void logError("background helper status", error);
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
    <section
      aria-labelledby="research-background-title"
      className="overflow-hidden rounded-xl border bg-card/60"
      data-testid="research-background"
    >
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Moon aria-hidden className="size-4" />
        </span>
        <h3 id="research-background-title" className="font-medium">
          {t(($) => $.settings.research.background.title)}
        </h3>
      </div>
      <div className="space-y-3 px-4 py-4">
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
                  onClick={() =>
                    void apply(
                      "stop",
                      stopBackgroundHelper,
                      t(($) => $.settings.research.background.stopFailed),
                    )
                  }
                >
                  {busy === "stop" ? <Spinner size="sm" aria-hidden /> : null}
                  {t(($) => $.settings.research.background.stop)}
                </Button>
              </Tooltip>
            </div>
          }
        />
      </div>
    </section>
  );
}

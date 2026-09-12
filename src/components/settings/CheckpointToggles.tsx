import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { getConfig, setConfig, type AppConfig } from "@/lib/tauri";

export function CheckpointToggles() {
  const { t } = useTranslation(["common", "settings"]);
  const [configState, setConfigState] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<"load" | "save" | null>(null);
  const configRequest = useRef(0);

  useEffect(() => {
    const request = ++configRequest.current;
    void getConfig()
      .then((next) => {
        if (request !== configRequest.current) return;
        setConfigState(next);
        setConfigError(null);
      })
      .catch(() => {
        if (request !== configRequest.current) return;
        setConfigError("load");
      });
    return () => {
      configRequest.current += 1;
    };
  }, []);

  const writeConfig = (next: AppConfig) => {
    setConfigState(next);
    setConfigError(null);
    void setConfig(next).catch(() => setConfigError("save"));
  };

  const checkpointsEnabled = configState ? configState.checkpoints_enabled !== false : true;
  const notificationsEnabled = configState ? configState.checkpoint_notifications !== false : true;

  return (
    <section
      aria-labelledby="checkpoint-toggles-title"
      data-testid="checkpoint-toggles"
      className="overflow-hidden rounded-xl border bg-card/60"
    >
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <History aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id="checkpoint-toggles-title" className="font-medium">
            {t(($) => $.settings.checkpoints.title)}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.checkpoints.description)}
          </p>
        </div>
      </div>
      <div className="space-y-2 px-4 py-4">
        <SettingsToggleRow
          label={t(($) => $.settings.checkpoints.afterCompile.label)}
          description={t(($) => $.settings.checkpoints.afterCompile.description)}
          checked={checkpointsEnabled}
          onChange={(value) => {
            if (!configState) return;
            writeConfig({ ...configState, checkpoints_enabled: value });
          }}
        />
        <SettingsToggleRow
          label={t(($) => $.settings.checkpoints.notifyOnFailure.label)}
          description={t(($) => $.settings.checkpoints.notifyOnFailure.description)}
          checked={notificationsEnabled}
          onChange={(value) => {
            if (!configState) return;
            writeConfig({ ...configState, checkpoint_notifications: value });
          }}
        />
        {configError ? (
          <p className="text-xs text-destructive" role="alert">
            {configError === "load"
              ? t(($) => $.settings.checkpoints.config.loadFailed)
              : t(($) => $.settings.checkpoints.config.saveFailed)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

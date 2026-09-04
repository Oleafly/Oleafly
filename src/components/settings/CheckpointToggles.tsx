import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { getConfig, setConfig, type AppConfig } from "@/lib/tauri";

export function CheckpointToggles() {
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
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
        setConfigError("Couldn't load checkpoint settings.");
      });
    return () => {
      configRequest.current += 1;
    };
  }, []);

  const writeConfig = (next: AppConfig) => {
    setConfigState(next);
    setConfigError(null);
    void setConfig(next).catch(() => setConfigError("Couldn't save checkpoint settings."));
  };

  const checkpointsEnabled = config ? config.checkpoints_enabled !== false : true;
  const notificationsEnabled = config ? config.checkpoint_notifications !== false : true;

  return (
    <section
      aria-labelledby="checkpoint-toggles-title"
      data-testid="checkpoint-toggles"
      className="overflow-hidden rounded-xl border bg-card/60"
    >
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id="checkpoint-toggles-title" className="font-medium">
            Checkpoints
          </h3>
          <p className="text-xs text-muted-foreground">
            A checkpoint records the source files a successful compile used.
          </p>
        </div>
      </div>
      <div className="space-y-2 px-4 py-4">
        <SettingsToggleRow
          label="Save a checkpoint after each successful compile"
          description="Oleafly saves it in the background and only when the source changed."
          checked={checkpointsEnabled}
          onChange={(value) => {
            if (!config) return;
            writeConfig({ ...config, checkpoints_enabled: value });
          }}
        />
        <SettingsToggleRow
          label="Show a notice when a checkpoint cannot be saved"
          description="Oleafly tells you when checkpoint storage is full or not writable."
          checked={notificationsEnabled}
          onChange={(value) => {
            if (!config) return;
            writeConfig({ ...config, checkpoint_notifications: value });
          }}
        />
        {configError ? (
          <p className="text-xs text-destructive" role="alert">
            {configError}
          </p>
        ) : null}
      </div>
    </section>
  );
}

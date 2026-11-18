import { useTranslation } from "react-i18next";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { useLiveBackend } from "@/lib/collab-live-bridge";
import { useSettingsStore } from "@/store/settings";
import { PauseLiveDialog } from "./PauseLiveDialog";
import { usePauseLive } from "./use-pause-live";

export function OverleafLiveSetting() {
  const { t } = useTranslation(["shell"]);
  const enabled = useSettingsStore((s) => s.overleafLive);
  const setEnabled = useSettingsStore((s) => s.setOverleafLive);
  const { unsent, busy, pause, keepLive } = usePauseLive(() => setEnabled(false));
  const liveProject = () => {
    const live = useLiveBackend.getState();
    return live.backend === "overleaf" ? live.projectId : null;
  };
  const change = (next: boolean) => {
    const projectId = next ? null : liveProject();
    if (projectId) void pause(projectId);
    else setEnabled(next);
  };
  return (
    <>
      <SettingsToggleRow
        testId="settings-overleaf-live"
        label={t(($) => $.shell.settings.experimentation.overleafLive.label)}
        description={t(($) => $.shell.settings.experimentation.overleafLive.description)}
        checked={enabled}
        disabled={busy}
        onChange={change}
      />
      <PauseLiveDialog
        unsent={unsent}
        busy={busy}
        onKeepLive={keepLive}
        onPauseAnyway={() => {
          const projectId = liveProject();
          if (projectId) void pause(projectId, true);
        }}
      />
    </>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { SettingsPath } from "@/components/settings/SettingsPath";
import { useEngineStore } from "@/store/engine";
import { logError } from "@/lib/log";

export function PhitexSetting() {
  const { t } = useTranslation(["shell"]);
  const info = useEngineStore((s) => s.info);
  const ensureLoaded = useEngineStore((s) => s.ensureLoaded);
  const setPhitex = useEngineStore((s) => s.setPhitex);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const enabled = info?.phitex_enabled === true;
  const change = (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    void setPhitex(next)
      .catch((error: unknown) => {
        void logError("save the PhiTeX switch", error);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };

  const status = () => {
    if (!enabled) return undefined;
    if (info?.phitex) {
      return (
        <p className="mt-1 truncate font-mono text-[0.625rem] text-muted-foreground/70">
          <SettingsPath focusable={false} path={info.phitex} />
        </p>
      );
    }
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {t(($) => $.shell.settings.experimentation.phitex.notFound)}
      </p>
    );
  };

  return (
    <>
      <SettingsToggleRow
        testId="settings-phitex"
        label={t(($) => $.shell.settings.experimentation.phitex.label)}
        description={t(($) => $.shell.settings.experimentation.phitex.description)}
        checked={enabled}
        disabled={busy || !info}
        onChange={change}
        details={status()}
      />
      {failed ? <InlineAlert>{t(($) => $.shell.settings.experimentation.phitex.saveFailed)}</InlineAlert> : null}
    </>
  );
}

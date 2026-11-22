import { useTranslation } from "react-i18next";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { CodeBlock } from "@/components/ui/code-block";
import { nativeAccelerator } from "@/lib/native-dock-shortcuts";
import type { QuickCaptureStatus } from "@/lib/tauri";
import { isMac } from "@/lib/utils";
import { useQuickCaptureStore } from "@/store/quick-capture";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";

function SignInNote({ status }: Readonly<{ status: QuickCaptureStatus | null }>) {
  const { t } = useTranslation(["settings"]);
  const atLogin = status?.atLogin;
  if (atLogin?.state === "move_app") {
    return <SettingsNote testId="settings-quick-capture-move-app">{t(($) => $.settings.research.background.atLogin.moveApp)}</SettingsNote>;
  }
  if (atLogin?.state === "unsupported") return <SettingsNote testId="settings-quick-capture-sign-in">{atLogin.reason}</SettingsNote>;
  return null;
}

function StatusLine({
  status,
  shortcut,
  usable,
}: Readonly<{ status: QuickCaptureStatus | null; shortcut: string; usable: boolean }>) {
  const { t } = useTranslation(["settings"]);
  const failure = usable ? status?.failure : "invalid";
  if (failure) {
    return (
      <p role="alert" className="mt-1 text-xs text-destructive">
        {t(($) => $.settings.shortcuts.quickCapture[failure], { shortcut })}
      </p>
    );
  }
  if (!status?.registered) return null;
  return <p className="mt-1 text-xs text-muted-foreground">{t(($) => $.settings.shortcuts.quickCapture.ready, { shortcut })}</p>;
}

export function QuickCaptureSettings() {
  const { t } = useTranslation(["settings"]);
  const enabled = useQuickCaptureStore((state) => state.enabled);
  const setEnabled = useQuickCaptureStore((state) => state.setEnabled);
  const background = useQuickCaptureStore((state) => state.background);
  const setBackground = useQuickCaptureStore((state) => state.setBackground);
  const status = useQuickCaptureStore((state) => state.status);
  const binding = useShortcutStore((state) => state.bindings.notesQuickCapture);
  const shortcut = shortcutLabel(binding);
  const usable = nativeAccelerator(binding) !== null;
  const unsupported = status?.supported === false;
  return (
    <div className="flex flex-col gap-2" data-testid="settings-quick-capture">
      <SettingsToggleRow
        testId="settings-row-quick-capture"
        label={t(($) => $.settings.shortcuts.quickCapture.label)}
        description={t(($) => $.settings.shortcuts.quickCapture.description)}
        checked={enabled && !unsupported}
        disabled={unsupported}
        onChange={setEnabled}
        details={enabled && !unsupported ? <StatusLine status={status} shortcut={shortcut} usable={usable} /> : null}
      />
      <SettingsToggleRow
        testId="settings-row-quick-capture-background"
        label={t(($) => $.settings.shortcuts.quickCapture.background.label)}
        description={
          isMac
            ? t(($) => $.settings.shortcuts.quickCapture.background.descriptionMac)
            : t(($) => $.settings.shortcuts.quickCapture.background.description)
        }
        checked={enabled && background}
        disabled={!enabled}
        onChange={setBackground}
      />
      {enabled && background ? <SignInNote status={status} /> : null}
      {unsupported ? (
        <SettingsNote testId="settings-quick-capture-wayland">
          {t(($) => $.settings.shortcuts.quickCapture.wayland)}
        </SettingsNote>
      ) : null}
      {unsupported && status?.command ? <CodeBlock code={status.command} preClassName="text-xs" /> : null}
    </div>
  );
}

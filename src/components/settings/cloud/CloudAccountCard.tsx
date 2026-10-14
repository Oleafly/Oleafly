import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeError } from "@/lib/app-error";
import { formatBytes } from "@/lib/format-bytes";
import { useCloudStore } from "@/store/cloud";
import { DropboxBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function CloudAccountCard() {
  const { t } = useTranslation(["common", "shell"]);
  const state = useCloudStore((s) => s.state);
  const disconnect = useCloudStore((s) => s.disconnect);
  const setEnabled = useCloudStore((s) => s.setEnabled);
  const setDeviceName = useCloudStore((s) => s.setDeviceName);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);

  if (state?.status !== "connected") return null;

  const finishRename = () => {
    setRenaming(false);
    setNameError(null);
    renameButton.current?.focus();
  };

  const saveName = async () => {
    try {
      await setDeviceName(name);
      finishRename();
    } catch (e) {
      setNameError(describeError(e));
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0061FF] text-white" aria-hidden>
          <DropboxBrandIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-foreground">
            {t(($) => $.shell.settings.data.cloud.accountLabel, { email: state.email ?? "" })}
          </h3>
          {state.displayName ? <p className="truncate text-xs text-muted-foreground">{state.displayName}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => void disconnect()}>
          {t(($) => $.shell.settings.data.cloud.disconnect)}
        </Button>
      </div>
      <div className="mt-4 space-y-1">
        {renaming ? (
          <div className="flex items-center gap-2">
            <Input
              aria-label={t(($) => $.shell.settings.data.cloud.thisComputer, { name: state.deviceName })}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") finishRename();
              }}
              className="max-w-xs"
            />
            <Button size="sm" onClick={() => void saveName()}>
              {t(($) => $.common.actions.save)}
            </Button>
            <Button size="sm" variant="ghost" onClick={finishRename}>
              {t(($) => $.common.actions.cancel)}
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t(($) => $.shell.settings.data.cloud.thisComputer, { name: state.deviceName })}</span>
            <button
              ref={renameButton}
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setName(state.deviceName);
                setRenaming(true);
              }}
            >
              {t(($) => $.shell.settings.data.cloud.rename)}
            </button>
          </p>
        )}
        {nameError ? (
          <p role="alert" className="text-xs text-destructive">
            {nameError}
          </p>
        ) : null}
        {state.space && state.space.allocated > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.shell.settings.data.cloud.storageLine, {
              used: formatBytes(state.space.used),
              free: formatBytes(Math.max(0, state.space.allocated - state.space.used)),
              total: formatBytes(state.space.allocated),
            })}
          </p>
        ) : null}
      </div>
      <div className="mt-3">
        <SettingsToggleRow
          label={t(($) => $.shell.settings.data.cloud.syncOnThisComputer)}
          description={t(($) => $.shell.settings.data.cloud.syncOnHelp)}
          checked={state.enabled}
          onChange={(v) => void setEnabled(v)}
        />
      </div>
    </div>
  );
}

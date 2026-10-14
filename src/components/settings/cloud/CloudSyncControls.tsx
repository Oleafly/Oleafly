import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { CLOUD_SYNC_INTERVALS, isSyncInterval, useCloudStore } from "@/store/cloud";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";


function ComputerNameRow({ deviceName }: Readonly<{ deviceName: string }>) {
  const { t } = useTranslation(["common", "cloud"]);
  const setDeviceName = useCloudStore((s) => s.setDeviceName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      renameRef.current?.focus();
    }
  }, [editing]);

  const finish = () => {
    returnFocus.current = true;
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (saving || !draft.trim()) return;
    setSaving(true);
    const failure = await setDeviceName(draft);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    finish();
  };

  return (
    <SettingsRow
      testId="cloud-computer-name"
      label={t(($) => $.cloud.computer.label)}
      description={t(($) => $.cloud.computer.description)}
      details={
        error ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {describeError(error)}
          </p>
        ) : null
      }
      control={
        editing ? (
          <form
            data-modal-escape-inner
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              ref={inputRef}
              aria-label={t(($) => $.cloud.computer.inputLabel)}
              value={draft}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  finish();
                }
              }}
              className="h-8 w-44"
            />
            <Button type="submit" size="sm" disabled={saving || !draft.trim()}>
              {saving ? <Spinner /> : null}
              {t(($) => $.common.actions.save)}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={finish}>
              {t(($) => $.common.actions.cancel)}
            </Button>
          </form>
        ) : (
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <span className="max-w-40 truncate text-sm text-foreground" title={deviceName}>
              {deviceName}
            </span>
            <Button
              ref={renameRef}
              type="button"
              size="sm"
              variant="outline"
              data-testid="cloud-computer-rename"
              onClick={() => {
                setDraft(deviceName);
                setError(null);
                setEditing(true);
              }}
            >
              {t(($) => $.common.actions.rename)}
            </Button>
          </div>
        )
      }
    />
  );
}

export function CloudSyncControls() {
  const { t } = useTranslation(["cloud"]);
  const state = useCloudStore((s) => s.state);
  const setEnabled = useCloudStore((s) => s.setEnabled);
  const interval = useCloudStore((s) => s.syncInterval);
  const setSyncInterval = useCloudStore((s) => s.setSyncInterval);

  if (!state) return null;

  return (
    <div className="space-y-2">
      <SettingsToggleRow
        testId="cloud-sync-enabled"
        label={t(($) => $.cloud.syncOnThisComputer)}
        description={t(($) => $.cloud.syncOnHelp)}
        checked={state.enabled}
        onChange={(on) => void setEnabled(on)}
      />
      <SettingsRow
        testId="cloud-sync-interval"
        label={t(($) => $.cloud.interval.label)}
        description={t(($) => $.cloud.interval.description)}
        control={
          <Select
            value={interval}
            disabled={!state.enabled}
            onValueChange={(value) => {
              if (isSyncInterval(value)) setSyncInterval(value);
            }}
          >
            <SelectTrigger
              className="w-56 shrink-0"
              aria-label={t(($) => $.cloud.interval.label)}
              data-testid="cloud-sync-interval-trigger"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[100]">
              {CLOUD_SYNC_INTERVALS.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {t(($) => $.cloud.interval[choice])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <ComputerNameRow deviceName={state.deviceName} />
    </div>
  );
}

import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useDismiss } from "@/components/ui/use-dismiss";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { describeError } from "@/lib/app-error";
import { CLOUD_SYNC_INTERVALS, isSyncInterval, useCloudStore } from "@/store/cloud";
import { Check, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function ComputerNameRow({ deviceName }: Readonly<{ deviceName: string }>) {
  const { t } = useTranslation(["common", "cloud"]);
  const setDeviceName = useCloudStore((s) => s.setDeviceName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLSpanElement>(null);
  const inputRef = useInitialFocus<HTMLInputElement>(editing);

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  useDismiss(editing && !saving, [editRef], cancel, { pointerEvent: "mousedown" });

  const save = async () => {
    if (saving) return;
    const next = draft.trim();
    if (!next || next === deviceName) {
      cancel();
      return;
    }
    setSaving(true);
    const failure = await setDeviceName(next);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setEditing(false);
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
          <span ref={editRef} data-modal-escape-inner className="flex shrink-0 items-center gap-1">
            <Input
              ref={inputRef}
              aria-label={t(($) => $.cloud.computer.inputLabel)}
              value={draft}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              disabled={saving}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
              }}
              className="h-7 w-48 rounded border bg-muted px-1.5 text-sm focus:border-primary"
            />
            <Tooltip label={t(($) => $.common.actions.save)}>
              <button
                type="button"
                data-testid="cloud-computer-save"
                aria-label={t(($) => $.common.actions.save)}
                disabled={saving}
                onClick={() => void save()}
                className="flex size-7 items-center justify-center rounded text-emerald-600 hover:bg-accent focus-visible:bg-accent dark:text-emerald-400"
              >
                {saving ? <Spinner size="sm" /> : <Check aria-hidden className="size-3.5" />}
              </button>
            </Tooltip>
            <Tooltip label={t(($) => $.common.actions.cancel)}>
              <button
                type="button"
                aria-label={t(($) => $.common.actions.cancel)}
                disabled={saving}
                onClick={cancel}
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </Tooltip>
          </span>
        ) : (
          <Tooltip label={t(($) => $.common.actions.rename)}>
            <button
              type="button"
              data-testid="cloud-computer-rename"
              aria-label={`${t(($) => $.common.actions.rename)}: ${deviceName}`}
              onClick={() => {
                setDraft(deviceName);
                setError(null);
                setEditing(true);
              }}
              className="flex min-w-0 max-w-56 shrink-0 items-center rounded px-1.5 py-0.5 text-sm text-foreground hover:bg-accent focus-visible:bg-accent"
            >
              <span className="min-w-0 truncate">{deviceName}</span>
            </button>
          </Tooltip>
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

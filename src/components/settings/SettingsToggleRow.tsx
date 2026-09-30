import { useId } from "react";
import { cn } from "@/lib/utils";
import { useChangedSettings } from "./changed-settings";
import { ChangedMarker, ResetSettingButton, SETTING_ROW_HIGHLIGHT } from "./SettingRow";

export function SettingsSwitchIndicator({ checked }: Readonly<{ checked: boolean }>) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-zinc-300 dark:bg-zinc-600",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-1",
        )}
      />
    </span>
  );
}

export function SettingsToggleRow({
  label,
  description,
  checked,
  onChange,
  settingId,
}: Readonly<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Schema id, for the changed marker, its reset and the Changed settings jump. */
  settingId?: string;
}>) {
  const changedSettings = useChangedSettings();
  const markerId = useId();
  const tracked = settingId !== undefined && changedSettings !== null;
  const changed = settingId !== undefined && (changedSettings?.isChanged(settingId) ?? false);

  // The reset button sits beside the switch, never inside it. While the row is
  // tracked the switch keeps a free slot before its indicator, and Reset
  // overlays that slot, so the indicator never moves under the pointer.
  return (
    <div
      data-setting-id={settingId}
      className={cn("relative rounded-lg border bg-card hover:bg-accent", SETTING_ROW_HIGHLIGHT)}
    >
      <div
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={changed ? markerId : undefined}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onChange(!checked);
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-4 p-3"
      >
        <div>
          <div className="text-sm font-medium">
            {label}
            {changed ? <ChangedMarker id={markerId} /> : null}
          </div>
          {description ? (
            <div className="text-xs text-muted-foreground">{description}</div>
          ) : null}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {tracked ? <span aria-hidden className="size-7" /> : null}
          <SettingsSwitchIndicator checked={checked} />
        </span>
      </div>
      {settingId && changed ? (
        // p-3 + the w-9 indicator + gap-1 puts Reset over the slot. The
        // overlay spans the row's height, so only the button takes the pointer
        // and clicks above or below it still reach the switch.
        <span className="pointer-events-none absolute inset-y-0 right-13 flex items-center">
          <ResetSettingButton id={settingId} label={label} className="pointer-events-auto" />
        </span>
      ) : null}
    </div>
  );
}

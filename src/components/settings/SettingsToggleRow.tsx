import type { ReactNode } from "react";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { cn } from "@/lib/utils";

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
  ariaLabel,
  testId,
  adornment,
  disabled = false,
}: Readonly<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
  testId?: string;
  adornment?: ReactNode;
  disabled?: boolean;
}>) {
  return (
    <SettingsRow
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel ?? label}
      tabIndex={disabled ? -1 : 0}
      testId={testId}
      onClick={disabled ? undefined : () => onChange(!checked)}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChange(!checked);
        }
      }}
      className={cn(
        "transition-colors",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:bg-accent focus-visible:border-ring focus-visible:bg-accent",
      )}
      label={label}
      description={description}
      adornment={adornment}
      control={<SettingsSwitchIndicator checked={checked} />}
    />
  );
}

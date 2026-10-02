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
}: Readonly<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
  testId?: string;
}>) {
  return (
    <SettingsRow
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      tabIndex={0}
      testId={testId}
      onClick={() => onChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChange(!checked);
        }
      }}
      className="cursor-pointer transition-colors hover:bg-accent focus-visible:border-ring focus-visible:bg-accent"
      label={label}
      description={description}
      control={<SettingsSwitchIndicator checked={checked} />}
    />
  );
}

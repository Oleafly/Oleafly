import { cn } from "@/lib/utils";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function ColorPicker({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}>) {
  return (
    <span
      className={cn(
        "relative block size-4 shrink-0 overflow-hidden rounded-full border border-input transition-colors",
        disabled
          ? "opacity-40"
          : "focus-within:border-foreground/60 hover:border-foreground/40",
        !value &&
          "bg-[length:4px_4px] bg-[linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%,#ccc),linear-gradient(45deg,#ccc_25%,#fff_25%,#fff_75%,#ccc_75%,#ccc)] bg-[position:0_0,2px_2px]",
      )}
      style={value ? { backgroundColor: value } : undefined}
    >
      <input
        type="color"
        aria-label={ariaLabel}
        disabled={disabled}
        value={HEX_COLOR.test(value) ? value : "#ffffff"}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  );
}

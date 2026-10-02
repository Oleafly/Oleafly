import { cn } from "@/lib/utils";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function ColorPicker({
  value,
  onChange,
  ariaLabel,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}>) {
  return (
    <span
      className={cn(
        "relative block size-7 shrink-0 overflow-hidden rounded-full border border-input transition-colors focus-within:border-ring hover:border-ring",
        !value &&
          "bg-[length:8px_8px] bg-[linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%,#ccc),linear-gradient(45deg,#ccc_25%,#fff_25%,#fff_75%,#ccc_75%,#ccc)] bg-[position:0_0,4px_4px]",
      )}
      style={value ? { backgroundColor: value } : undefined}
    >
      <input
        type="color"
        aria-label={ariaLabel}
        value={HEX_COLOR.test(value) ? value : "#ffffff"}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}

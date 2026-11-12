import type { ButtonHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SWATCH_SIZE = { sm: "size-5", md: "size-7", lg: "size-8" } as const;
const DOT_SIZE = { xs: "size-2", sm: "size-3", md: "size-3.5" } as const;

export function ColorSwatch({
  color,
  name,
  label = name,
  pressed,
  size = "lg",
  checkClassName,
  className,
  style,
  ...button
}: Readonly<
  {
    color: string;
    name: string;
    label?: string;
    pressed: boolean;
    size?: keyof typeof SWATCH_SIZE;
    checkClassName?: string;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-pressed" | "type" | "children" | "color">
>) {
  return (
    <Tooltip label={name} side="top">
      <button
        {...button}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        style={{ backgroundColor: color, ...style }}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border transition-transform hover:scale-110 focus-visible:scale-110 motion-reduce:transition-none",
          pressed ? "border-foreground" : "border-border",
          SWATCH_SIZE[size],
          className,
        )}
      >
        {pressed ? (
          <Check aria-hidden className={cn(size === "sm" ? "size-3" : "size-3.5", "text-white drop-shadow", checkClassName)} />
        ) : null}
      </button>
    </Tooltip>
  );
}

export function ColorDot({
  color,
  size = "sm",
  className,
}: Readonly<{ color: string; size?: keyof typeof DOT_SIZE; className?: string }>) {
  return (
    <span
      aria-hidden
      style={{ background: color }}
      className={cn("shrink-0 rounded-full border border-black/10 dark:border-white/15", DOT_SIZE[size], className)}
    />
  );
}

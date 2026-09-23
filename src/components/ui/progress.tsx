import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  indicatorClassName,
}: Readonly<{
  value: number;
  className?: string;
  indicatorClassName?: string;
}>) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div
        className={cn("h-full rounded-full bg-[#4285F4] transition-[width] duration-200", indicatorClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

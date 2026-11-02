import { cn } from "@/lib/utils";

// A pulsing placeholder for text that hasn't loaded yet. Inline-block, so it
// sits inside the same line box as the text it stands in for and the line keeps
// its height when the real value arrives.
export function Skeleton({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden
      className={cn("inline-block rounded bg-muted align-middle motion-safe:animate-pulse", className)}
    />
  );
}

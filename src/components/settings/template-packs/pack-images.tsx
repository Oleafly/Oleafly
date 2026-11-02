import { memo, useState, type ReactNode } from "react";
import { FileText } from "@/components/icons/pack";
import { cn } from "@/lib/utils";

export const PAGE_ASPECT = "aspect-[1/1.294]";

export function LazyImage({
  src,
  alt = "",
  className,
  onLoad,
  fallback = null,
}: Readonly<{
  src: string;
  alt?: string;
  className?: string;
  onLoad?: () => void;
  fallback?: ReactNode;
}>) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  if (state === "failed") return fallback;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => {
        setState("ready");
        onLoad?.();
      }}
      onError={() => setState("failed")}
      className={cn(
        "absolute inset-0 size-full object-contain transition-opacity duration-200 motion-reduce:transition-none",
        state === "ready" ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}

export function PagePlaceholder({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden
      className={cn("absolute inset-0 flex items-center justify-center text-muted-foreground/40", className)}
    >
      <FileText className="size-5" />
    </span>
  );
}

export const PackCollage = memo(function PackCollage({
  covers,
}: Readonly<{ covers: readonly string[] }>) {
  return (
    <span
      aria-hidden
      className="grid w-22 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-md border bg-muted p-0.5"
    >
      {[0, 1, 2, 3].map((slot) => {
        const cover = covers[slot];
        return (
          <span
            key={slot}
            className={cn("relative block overflow-hidden rounded-sm bg-background", PAGE_ASPECT)}
          >
            {cover ? <LazyImage key={cover} src={cover} /> : null}
          </span>
        );
      })}
    </span>
  );
});

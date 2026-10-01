import { useId } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** The illustrations under public/project-kind/ are all 720x406. */
const IMAGE_WIDTH = 720;
const IMAGE_HEIGHT = 406;

/**
 * A large starting-point card: illustration on top, title with an arrow, and
 * a one-line description. Shared by the "Start a new piece of work" chooser
 * and the empty library's welcome screen so the two can't drift apart.
 */
export function ChoiceCard({
  image,
  title,
  description,
  onClick,
  testId,
  tour,
  disabled = false,
  busy = false,
}: Readonly<{
  image: string;
  title: string;
  description: string;
  onClick: () => void;
  testId: string;
  tour?: string;
  disabled?: boolean;
  /** Swaps the arrow for a spinner while the choice is being carried out. */
  busy?: boolean;
}>) {
  const descriptionId = useId();
  const TrailingIcon = busy ? Loader2 : ArrowRight;
  return (
    <button
      type="button"
      data-testid={testId}
      data-tour={tour}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-describedby={descriptionId}
      onClick={onClick}
      className={cn(
        "group flex h-full select-none flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all",
        "enabled:hover:-translate-y-0.5 enabled:hover:border-primary/50 enabled:hover:shadow-md",
        "focus-visible:border-primary disabled:cursor-default disabled:opacity-60",
      )}
    >
      <img
        src={image}
        alt=""
        aria-hidden="true"
        width={IMAGE_WIDTH}
        height={IMAGE_HEIGHT}
        draggable={false}
        loading="lazy"
        decoding="async"
        className="pointer-events-none aspect-[16/9] w-full select-none object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{title}</span>
          <TrailingIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0",
              busy
                ? "animate-spin text-muted-foreground"
                : "text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground",
            )}
          />
        </span>
        <span id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
